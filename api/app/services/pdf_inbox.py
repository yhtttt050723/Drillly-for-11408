"""Watch PDF inbox folder under Study 学习资料."""

from __future__ import annotations

import asyncio
import shutil
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models import PdfImportBatch, PdfImportTask, Question, Tag
from app.services.import_cancel import is_cancelled
from app.services.import_batch_failures import (
    mark_batch_resolved,
    record_batch_failure,
)
from app.services.import_job import append_log, finish_job, start_job, update_progress
from app.services.inbox_ledger import (
    get_import_record,
    is_imported,
    mark_imported,
    should_move_after_import,
)
from app.services.llm import parse_pdf_batch_resilient
from app.services.question_tags import attach_tags, merge_task_pdf_tag, tag_ids_for_question
from app.services.settings_store import get_pdf_inbox_dir
from app.tools.split_pdf import split_pdf


class ImportCancelledError(Exception):
    pass


async def list_inbox_pdfs(db: Session | None = None) -> list[dict]:
    inbox = get_pdf_inbox_dir()
    inbox.mkdir(parents=True, exist_ok=True)
    files = sorted(inbox.glob("*.pdf"), key=lambda p: p.stat().st_mtime, reverse=True)
    db_counts: dict[str, int] = {}
    if db is not None:
        from sqlalchemy import func

        for name, cnt in (
            db.query(Question.source_pdf, func.count(Question.id))
            .filter(Question.source_pdf != "")
            .group_by(Question.source_pdf)
            .all()
        ):
            if name:
                db_counts[name] = int(cnt)

    out: list[dict] = []
    for f in files:
        rec = get_import_record(f)
        item = {
            "name": f.name,
            "path": str(f),
            "size_mb": round(f.stat().st_size / (1024 * 1024), 2),
            "modified": f.stat().st_mtime,
            "imported": rec is not None,
            "questions_in_db": db_counts.get(f.name, 0),
        }
        if rec:
            item["imported_at"] = rec.get("imported_at")
            item["task_id"] = rec.get("task_id")
            item["question_count"] = rec.get("question_count")
        out.append(item)
    return out


async def iter_inbox_pdf(
    db: Session,
    pdf_path: Path,
    *,
    provider: str,
    model: str | None,
    tags: list[str],
    pages_per_batch: int,
    auto_confirm: bool,
) -> AsyncIterator[dict[str, Any]]:
    """Yield progress events; final event is file_done with result."""
    if not pdf_path.exists():
        raise FileNotFoundError(str(pdf_path))

    yield {"type": "splitting", "file": pdf_path.name}

    batch_size = max(1, min(20, pages_per_batch))
    dest_dir = settings.media_dir / "imports"
    dest_dir.mkdir(parents=True, exist_ok=True)
    safe_name = f"{uuid.uuid4().hex}_{pdf_path.name}"
    dest_path = dest_dir / safe_name
    shutil.copy2(pdf_path, dest_path)

    chunks_dir = settings.media_dir / "imports" / "chunks" / dest_path.stem
    chunk_list = split_pdf(dest_path, chunks_dir, batch_size)
    total_pages = chunk_list[-1][1] if chunk_list else 0

    yield {
        "type": "split_done",
        "file": pdf_path.name,
        "batches": len(chunk_list),
        "total_pages": total_pages,
    }

    source_inbox_path = str(pdf_path.resolve())
    task = PdfImportTask(
        original_name=pdf_path.name,
        file_path=source_inbox_path,
        total_pages=total_pages,
        pages_per_batch=batch_size,
        status="processing",
    )
    tag_objs: list[Tag] = []
    for name in tags:
        t = db.query(Tag).filter(Tag.name == name).first()
        if not t:
            t = Tag(name=name)
            db.add(t)
            db.flush()
        tag_objs.append(t)
    task.tags = tag_objs
    db.add(task)
    db.commit()
    db.refresh(task)

    created_ids: list[int] = []
    parsed_count = 0
    batch_total = len(chunk_list)
    batch_errors = 0

    for batch_index, (page_start, page_end, chunk_path) in enumerate(chunk_list, start=1):
        if is_cancelled():
            raise ImportCancelledError("用户已取消导入")

        yield {
            "type": "batch_start",
            "file": pdf_path.name,
            "batch_index": batch_index,
            "batch_total": batch_total,
            "page_start": page_start,
            "page_end": page_end,
        }

        try:
            result = await parse_pdf_batch_resilient(
                provider,
                model,
                str(chunk_path),
                page_start,
                page_end,
                source_filename=pdf_path.name,
                source_path=source_inbox_path,
                user_tags=tags,
            )
            questions = result["questions"]
            merge_task_pdf_tag(
                db, task, result.get("pdf_tag"), source_pdf=pdf_path.name
            )

            batch = PdfImportBatch(
                task_id=task.id,
                page_start=page_start,
                page_end=page_end,
                chunk_path=str(chunk_path),
                status="parsed",
                parsed_json=questions,
            )
            db.add(batch)
            db.flush()
            parsed_count += len(questions)

            if auto_confirm and questions:
                for item in questions:
                    q_type = item.get("type", "single_choice")
                    q = Question(type=q_type, content=item)
                    attach_tags(
                        db, q, tag_ids_for_question(db, item, list(task.tags))
                    )
                    db.add(q)
                    db.flush()
                    created_ids.append(q.id)
                batch.status = "confirmed"

            db.commit()
            mark_batch_resolved(pdf_path.name, batch_index)

            yield {
                "type": "batch_done",
                "file": pdf_path.name,
                "batch_index": batch_index,
                "batch_total": batch_total,
                "questions": len(questions),
                "pdf_tag": result.get("pdf_tag"),
                "extract_mode": result.get("extract_mode"),
                "text_chars": result.get("text_chars"),
                "zero_hint": result.get("zero_hint"),
                "json_salvaged": result.get("json_salvaged"),
                "questions_in_db": len(created_ids),
            }
        except Exception as e:
            db.rollback()
            batch_errors += 1
            err_msg = str(e).strip() or f"{type(e).__name__}: {e!r}"
            record_batch_failure(
                file=pdf_path.name,
                batch_index=batch_index,
                batch_total=batch_total,
                page_start=page_start,
                page_end=page_end,
                chunk_path=str(chunk_path),
                task_id=task.id,
                source_path=source_inbox_path,
                provider=provider,
                model=model,
                tags=list(tags),
                exc=e,
                pages_per_batch=batch_size,
            )
            yield {
                "type": "batch_error",
                "file": pdf_path.name,
                "batch_index": batch_index,
                "batch_total": batch_total,
                "page_start": page_start,
                "page_end": page_end,
                "error": err_msg[:2000],
            }
            await asyncio.sleep(1)

    task.status = "partial" if batch_errors else "done"
    db.commit()

    pdf_tag = task.tags[0].name if task.tags else None
    if created_ids:
        mark_imported(
            pdf_path,
            task_id=task.id,
            question_count=len(created_ids),
            pdf_tag=pdf_tag,
        )

    moved_to: str | None = None
    if should_move_after_import() and pdf_path.exists():
        done_dir = get_pdf_inbox_dir() / "已处理"
        done_dir.mkdir(parents=True, exist_ok=True)
        target = done_dir / pdf_path.name
        if target.exists():
            target = done_dir / f"{uuid.uuid4().hex[:8]}_{pdf_path.name}"
        shutil.move(str(pdf_path), str(target))
        moved_to = str(target)

    yield {
        "type": "file_done",
        "file": pdf_path.name,
        "result": {
            "file": pdf_path.name,
            "source_path": source_inbox_path,
            "pdf_tag": pdf_tag,
            "task_id": task.id,
            "batches": batch_total,
            "batch_errors": batch_errors,
            "partial": batch_errors > 0,
            "parsed_questions": parsed_count,
            "created_question_ids": created_ids,
            "questions_in_db": len(created_ids),
            "moved_to": moved_to,
            "kept_in_inbox": moved_to is None,
        },
    }


async def process_inbox_pdf(
    db: Session,
    pdf_path: Path,
    *,
    provider: str,
    model: str | None,
    tags: list[str],
    pages_per_batch: int,
    auto_confirm: bool,
) -> dict:
    result: dict | None = None
    async for event in iter_inbox_pdf(
        db,
        pdf_path,
        provider=provider,
        model=model,
        tags=tags,
        pages_per_batch=pages_per_batch,
        auto_confirm=auto_confirm,
    ):
        if event.get("type") == "file_done":
            result = event["result"]
    if result is None:
        raise RuntimeError("import finished without result")
    return result


async def iter_inbox_process_all(
    *,
    provider: str,
    model: str | None,
    tags: list[str],
    pages_per_batch: int,
    auto_confirm: bool,
) -> AsyncIterator[dict[str, Any]]:
    inbox = get_pdf_inbox_dir()
    pdfs = sorted(inbox.glob("*.pdf"))
    pending: list[Path] = []
    skipped_files: list[dict] = []

    for pdf in pdfs:
        if is_imported(pdf):
            rec = get_import_record(pdf) or {}
            skipped_files.append(
                {
                    "file": pdf.name,
                    "reason": "已导入过，跳过（内容未变）",
                    "task_id": rec.get("task_id"),
                    "imported_at": rec.get("imported_at"),
                }
            )
        else:
            pending.append(pdf)

    from app.services.import_cancel import clear_cancel

    clear_cancel()
    start_job(file_total=len(pdfs), pending_files=len(pending))

    yield {
        "type": "plan",
        "total_files": len(pdfs),
        "pending_files": len(pending),
        "skipped_files": len(skipped_files),
    }

    for item in skipped_files:
        yield {"type": "skip", **item}

    results: list[dict] = []
    errors: list[dict] = []

    for file_index, pdf in enumerate(pending, start=1):
        if is_cancelled():
            append_log("用户取消，停止后续文件")
            break

        yield {
            "type": "file_start",
            "file": pdf.name,
            "file_index": file_index,
            "file_total": len(pending),
        }
        update_progress(file_index=file_index, file_name=pdf.name)
        db = SessionLocal()
        try:
            async for event in iter_inbox_pdf(
                db,
                pdf,
                provider=provider,
                model=model,
                tags=tags,
                pages_per_batch=pages_per_batch,
                auto_confirm=auto_confirm,
            ):
                if event.get("type") == "file_done":
                    results.append(event["result"])
                _mirror_event_to_job(event, file_index, len(pending))
                yield event
        except ImportCancelledError as e:
            err = {"file": pdf.name, "error": str(e)}
            errors.append(err)
            yield {"type": "file_error", **err}
            break
        except Exception as e:
            err = {"file": pdf.name, "error": str(e)}
            errors.append(err)
            yield {"type": "file_error", **err}
        finally:
            db.close()

    summary = {
        "processed": len(results),
        "skipped": len(skipped_files),
        "results": results,
        "skipped_files": skipped_files,
        "errors": errors,
        "cancelled": is_cancelled(),
    }
    finish_job(summary=summary)
    clear_cancel()

    yield {"type": "complete", **summary}


def _mirror_event_to_job(event: dict[str, Any], file_index: int, file_total: int) -> None:
    t = event.get("type")
    if t == "batch_done":
        bi = event.get("batch_index", 0)
        bt = event.get("batch_total", 1)
        pct = int(((file_index - 1) + bi / max(bt, 1)) / max(file_total, 1) * 100)
        line = (
            f"{event.get('file')} 第 {bi}/{bt} 批 -> {event.get('questions', 0)} 题"
        )
        append_log(line)
        update_progress(
            percent=min(99, pct),
            batch_index=bi,
            batch_total=bt,
            file_index=file_index,
        )
    elif t == "batch_error":
        ps, pe = event.get("page_start"), event.get("page_end")
        page_hint = f" p{ps}-{pe}" if ps and pe else ""
        err = (event.get("error") or "（无错误文本，多为超时/限流）")[:200]
        append_log(
            f"{event.get('file')} 第 {event.get('batch_index')}/{event.get('batch_total')} 批 失败{page_hint}: {err}"
        )
    elif t == "file_done":
        r = event.get("result") or {}
        append_log(
            f"完成: {event.get('file')}，入库 {r.get('questions_in_db', 0)} 题"
            + ("（部分批次失败）" if r.get("partial") else "")
        )
    elif t == "file_error":
        append_log(f"失败: {event.get('file')} — {event.get('error', '')[:200]}")
    elif t == "retry_plan":
        append_log(
            f"【重导失败批】{event.get('file')}：共 {event.get('batches', 0)} 批 "
            f"（{event.get('batch_indices', [])}）"
        )
    elif t == "retry_done":
        append_log(
            f"重导完成: {event.get('file')}，本次新增 {event.get('questions_added', 0)} 题"
        )


async def iter_inbox_process_one(
    filename: str,
    *,
    provider: str,
    model: str | None,
    tags: list[str],
    pages_per_batch: int,
    auto_confirm: bool,
) -> AsyncIterator[dict[str, Any]]:
    from app.services.import_cancel import clear_cancel

    inbox = get_pdf_inbox_dir()
    pdf = inbox / filename
    if not pdf.is_file():
        raise FileNotFoundError(filename)

    clear_cancel()
    start_job(file_total=1, pending_files=1)
    yield {"type": "plan", "total_files": 1, "pending_files": 1, "skipped_files": 0}
    yield {"type": "file_start", "file": pdf.name, "file_index": 1, "file_total": 1}

    db = SessionLocal()
    result: dict | None = None
    try:
        async for event in iter_inbox_pdf(
            db,
            pdf,
            provider=provider,
            model=model,
            tags=tags,
            pages_per_batch=pages_per_batch,
            auto_confirm=auto_confirm,
        ):
            if event.get("type") == "file_done":
                result = event["result"]
            _mirror_event_to_job(event, 1, 1)
            yield event
    finally:
        db.close()

    summary = {
        "processed": 1 if result else 0,
        "skipped": 0,
        "results": [result] if result else [],
        "skipped_files": [],
        "errors": [],
        "cancelled": is_cancelled(),
    }
    finish_job(summary=summary)
    clear_cancel()
    yield {"type": "complete", **summary}


def _resolve_retry_task(
    db: Session,
    filename: str,
    item: dict[str, Any],
    user_tags: list[str],
) -> tuple[PdfImportTask, list[Tag]]:
    """重导时必须有 task_id；种子数据常为 null，则查库或新建任务。"""
    task_id = item.get("task_id")
    if task_id:
        task = db.get(PdfImportTask, task_id)
        if task:
            return task, list(task.tags or [])

    task = (
        db.query(PdfImportTask)
        .filter(PdfImportTask.original_name == filename)
        .order_by(PdfImportTask.id.desc())
        .first()
    )
    if not task:
        inbox_path = get_pdf_inbox_dir() / filename
        total_pages = int(item.get("page_end") or 0)
        bps = int(item.get("pages_per_batch") or 3)
        bt = int(item.get("batch_total") or 0)
        if bt and bps:
            total_pages = max(total_pages, min(bt * bps, total_pages + bps * 5))
        task = PdfImportTask(
            original_name=filename,
            file_path=item.get("source_path")
            or (str(inbox_path.resolve()) if inbox_path.is_file() else filename),
            total_pages=total_pages,
            pages_per_batch=int(item.get("pages_per_batch") or 3),
            status="partial",
        )
        db.add(task)
        db.flush()

    tag_objs: list[Tag] = list(task.tags or [])
    if not tag_objs and user_tags:
        for name in user_tags:
            t = db.query(Tag).filter(Tag.name == name).first()
            if not t:
                t = Tag(name=name)
                db.add(t)
                db.flush()
            tag_objs.append(t)
        task.tags = tag_objs
        db.add(task)
        db.flush()
    return task, tag_objs


async def iter_retry_failed_batches(
    db: Session,
    filename: str,
    *,
    provider: str | None = None,
    model: str | None = None,
    tags: list[str] | None = None,
    auto_confirm: bool = True,
) -> AsyncIterator[dict[str, Any]]:
    """Re-parse only batches recorded in import_batch_failures (no full re-import)."""
    from app.services.import_batch_failures import list_pending_for_file

    pending = list_pending_for_file(filename)
    if not pending:
        yield {"type": "retry_plan", "file": filename, "batches": 0}
        return

    yield {
        "type": "retry_plan",
        "file": filename,
        "batches": len(pending),
        "batch_indices": [p["batch_index"] for p in pending],
    }

    use_tags = list(tags or pending[0].get("tags") or [])
    task, tag_objs = _resolve_retry_task(db, filename, pending[0], use_tags)
    task_id = task.id

    created_ids: list[int] = []
    for item in pending:
        if is_cancelled():
            raise ImportCancelledError("用户已取消导入")

        batch_index = item["batch_index"]
        batch_total = item.get("batch_total") or len(pending)
        page_start = item["page_start"]
        page_end = item["page_end"]
        chunk_path = Path(item["chunk_path"])
        use_provider = provider or item.get("provider") or "tongyi"
        use_model = model if model is not None else item.get("model")
        use_tags = list(tags or item.get("tags") or use_tags)
        source_path = item.get("source_path") or task.file_path

        yield {
            "type": "batch_start",
            "file": filename,
            "batch_index": batch_index,
            "batch_total": batch_total,
            "page_start": page_start,
            "page_end": page_end,
            "retry": True,
        }

        if not chunk_path.is_file():
            err = f"分片文件不存在: {chunk_path}"
            record_batch_failure(
                file=filename,
                batch_index=batch_index,
                batch_total=batch_total,
                page_start=page_start,
                page_end=page_end,
                chunk_path=str(chunk_path),
                task_id=task_id,
                source_path=source_path,
                provider=use_provider,
                model=use_model,
                tags=use_tags,
                exc=FileNotFoundError(err),
                pages_per_batch=item.get("pages_per_batch") or 3,
            )
            yield {
                "type": "batch_error",
                "file": filename,
                "batch_index": batch_index,
                "batch_total": batch_total,
                "page_start": page_start,
                "page_end": page_end,
                "error": err,
                "retry": True,
            }
            continue

        try:
            result = await parse_pdf_batch_resilient(
                use_provider,
                use_model,
                str(chunk_path),
                page_start,
                page_end,
                source_filename=filename,
                source_path=source_path,
                user_tags=use_tags,
            )
            questions = result["questions"]
            merge_task_pdf_tag(
                db, task, result.get("pdf_tag"), source_pdf=filename
            )

            batch = PdfImportBatch(
                task_id=task_id,
                page_start=page_start,
                page_end=page_end,
                chunk_path=str(chunk_path),
                status="parsed",
                parsed_json=questions,
            )
            db.add(batch)
            db.flush()

            if auto_confirm and questions:
                for qitem in questions:
                    q_type = qitem.get("type", "single_choice")
                    q = Question(type=q_type, content=qitem)
                    attach_tags(
                        db, q, tag_ids_for_question(db, qitem, tag_objs)
                    )
                    db.add(q)
                    db.flush()
                    created_ids.append(q.id)
                batch.status = "confirmed"

            db.commit()
            mark_batch_resolved(filename, batch_index)

            yield {
                "type": "batch_done",
                "file": filename,
                "batch_index": batch_index,
                "batch_total": batch_total,
                "questions": len(questions),
                "extract_mode": result.get("extract_mode"),
                "zero_hint": result.get("zero_hint"),
                "json_salvaged": result.get("json_salvaged"),
                "questions_in_db": len(created_ids),
                "retry": True,
            }
        except Exception as e:
            db.rollback()
            err_msg = str(e).strip() or f"{type(e).__name__}: {e!r}"
            record_batch_failure(
                file=filename,
                batch_index=batch_index,
                batch_total=batch_total,
                page_start=page_start,
                page_end=page_end,
                chunk_path=str(chunk_path),
                task_id=task_id,
                source_path=source_path,
                provider=use_provider,
                model=use_model,
                tags=use_tags,
                exc=e,
                pages_per_batch=item.get("pages_per_batch") or 3,
            )
            yield {
                "type": "batch_error",
                "file": filename,
                "batch_index": batch_index,
                "batch_total": batch_total,
                "page_start": page_start,
                "page_end": page_end,
                "error": err_msg[:2000],
                "retry": True,
            }
            await asyncio.sleep(2)

    yield {
        "type": "retry_done",
        "file": filename,
        "questions_added": len(created_ids),
        "created_question_ids": created_ids,
    }


async def process_all_inbox(
    db: Session,
    *,
    provider: str,
    model: str | None,
    tags: list[str],
    pages_per_batch: int,
    auto_confirm: bool,
) -> dict:
    summary: dict | None = None
    async for event in iter_inbox_process_all(
        provider=provider,
        model=model,
        tags=tags,
        pages_per_batch=pages_per_batch,
        auto_confirm=auto_confirm,
    ):
        if event.get("type") == "complete":
            summary = event
    return summary or {
        "processed": 0,
        "skipped": 0,
        "results": [],
        "skipped_files": [],
        "errors": [],
    }
