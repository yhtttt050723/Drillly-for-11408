import json
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.database import get_db
from app.models import PdfImportBatch, PdfImportTask, Question, Tag
from app.schemas.api_models import ParseBatchBody, ProviderOut
from app.services.llm import list_providers, parse_pdf_batch
from app.services.import_cancel import clear_cancel, request_cancel
from app.services.import_job import clear_job, get_job_state
from app.services.inbox_reset import reset_inbox_pdf
from app.services.import_batch_failures import count_pending_by_file, list_all_pending
from app.services.import_job import finish_job, start_job
from app.services.english_pdf_import import import_english_pdf, preview_english_pdf
from app.services.english_vocab_inbox import (
    list_english_vocab_inbox,
    process_all_english_vocab_inbox,
    process_one_english_vocab_pdf,
    reset_english_vocab_inbox_file,
)
from app.services.settings_store import get_english_vocab_inbox_dir
from app.services.pdf_inbox import (
    ImportCancelledError,
    _mirror_event_to_job,
    iter_inbox_process_all,
    iter_inbox_process_one,
    iter_retry_failed_batches,
    list_inbox_pdfs,
    process_all_inbox,
)
from app.database import SessionLocal
from app.services.question_tags import attach_tags, merge_task_pdf_tag, tag_ids_for_question
from app.tools.split_pdf import split_pdf
from pydantic import BaseModel

router = APIRouter(prefix="/api/import", tags=["import"])


class InboxProcessBody(BaseModel):
    provider: str = "tongyi"
    model: str | None = None
    tags: str = ""
    pages_per_batch: int = 5
    auto_confirm: bool = True


class InboxFileBody(BaseModel):
    filename: str


class InboxProcessOneBody(InboxProcessBody):
    filename: str


class EnglishVocabInboxProcessBody(BaseModel):
    provider: str = "deepseek"
    model: str | None = None
    pages_per_batch: int = 3
    skip_imported: bool = True
    default_book: str = ""


class EnglishVocabInboxOneBody(EnglishVocabInboxProcessBody):
    filename: str
    book: str = ""
    unit: str = ""
    force: bool = False


@router.get("/providers/", response_model=list[ProviderOut])
def get_providers():
    return [ProviderOut(**p) for p in list_providers()]


@router.post("/pdf/")
async def upload_pdf(
    file: UploadFile = File(...),
    tags: str = Form(""),
    pages_per_batch: int = Form(None),
    db: Session = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "仅支持 PDF")

    content = await file.read()
    max_bytes = settings.pdf_max_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(400, f"PDF 超过 {settings.pdf_max_mb}MB")

    batch_size = pages_per_batch or settings.pdf_default_pages_per_batch
    batch_size = max(1, min(20, batch_size))

    safe_name = f"{uuid.uuid4().hex}_{Path(file.filename).name}"
    dest_dir = settings.media_dir / "imports"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / safe_name
    dest_path.write_bytes(content)

    chunks_dir = settings.media_dir / "imports" / "chunks" / dest_path.stem
    chunk_list = split_pdf(dest_path, chunks_dir, batch_size)

    task = PdfImportTask(
        original_name=file.filename,
        file_path=str(dest_path),
        total_pages=chunk_list[-1][1] if chunk_list else 0,
        pages_per_batch=batch_size,
        status="split",
    )
    tag_names = [t.strip() for t in tags.split(",") if t.strip()]
    if tag_names:
        existing = {t.name: t for t in db.query(Tag).filter(Tag.name.in_(tag_names)).all()}
        task.tags = []
        for name in tag_names:
            if name not in existing:
                tag = Tag(name=name)
                db.add(tag)
                db.flush()
                existing[name] = tag
            task.tags.append(existing[name])

    db.add(task)
    db.flush()

    for page_start, page_end, chunk_path in chunk_list:
        batch = PdfImportBatch(
            task_id=task.id,
            page_start=page_start,
            page_end=page_end,
            chunk_path=str(chunk_path),
            status="pending",
        )
        db.add(batch)

    db.commit()
    return {"task_id": task.id, "batches": len(chunk_list)}


@router.post("/english-pdf-words/")
async def upload_english_pdf_words(
    file: UploadFile = File(...),
    auto_import: bool = Form(True),
    provider: str = Form("deepseek"),
    model: str = Form(""),
    pages_per_batch: int = Form(3),
    unit: str = Form(""),
    book: str = Form(""),
    tag_group: str = Form("英语"),
    source_label: str = Form(""),
    allow_reimport: bool = Form(False),
    replace_pdf_source: bool = Form(False),
    db: Session = Depends(get_db),
):
    """上传英文词汇 PDF → AI（默认 DeepSeek）按批解析 → 写入默写词库。"""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "仅支持 PDF")
    content = await file.read()
    try:
        return await import_english_pdf(
            db,
            content,
            filename=file.filename or "",
            provider=provider.strip() or "deepseek",
            model=model.strip() or None,
            pages_per_batch=max(1, min(10, pages_per_batch)),
            unit=unit.strip(),
            book=book.strip(),
            tag_group=tag_group.strip(),
            source_label=source_label.strip() or (file.filename or ""),
            auto_import=auto_import,
            allow_reimport=allow_reimport,
            replace_pdf_source=replace_pdf_source,
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.get("/english-vocab-inbox/")
async def get_english_vocab_inbox(db: Session = Depends(get_db)):
    return {
        "inbox_dir": str(get_english_vocab_inbox_dir()),
        "files": list_english_vocab_inbox(db),
        "naming_hint": "文件名请含「基础词」或「必考词」+ Unit 编号，如：基础词 Unit15.pdf",
    }


@router.post("/english-vocab-inbox/process-all/")
async def english_vocab_inbox_process_all(
    body: EnglishVocabInboxProcessBody, db: Session = Depends(get_db)
):
    try:
        return await process_all_english_vocab_inbox(
            db,
            provider=body.provider.strip() or "deepseek",
            model=body.model.strip() if body.model else None,
            pages_per_batch=body.pages_per_batch,
            skip_imported=body.skip_imported,
            default_book=body.default_book.strip(),
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/english-vocab-inbox/process-one/")
async def english_vocab_inbox_process_one(
    body: EnglishVocabInboxOneBody, db: Session = Depends(get_db)
):
    try:
        return await process_one_english_vocab_pdf(
            db,
            body.filename,
            provider=body.provider.strip() or "deepseek",
            model=body.model.strip() if body.model else None,
            pages_per_batch=body.pages_per_batch,
            book=body.book.strip(),
            unit=body.unit.strip(),
            force=body.force,
        )
    except FileNotFoundError as e:
        raise HTTPException(404, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/english-vocab-inbox/reset/")
def english_vocab_inbox_reset(body: InboxFileBody):
    try:
        return reset_english_vocab_inbox_file(body.filename)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e)) from e


@router.post("/english-pdf-words/preview/")
async def preview_english_pdf_words(
    file: UploadFile = File(...),
    provider: str = Form("deepseek"),
    model: str = Form(""),
    pages_per_batch: int = Form(3),
    unit: str = Form(""),
):
    """预览：仅解析第一批 PDF 页，不入库。"""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "仅支持 PDF")
    content = await file.read()
    try:
        return await preview_english_pdf(
            content,
            filename=file.filename or "",
            provider=provider.strip() or "deepseek",
            model=model.strip() or None,
            pages_per_batch=max(1, min(10, pages_per_batch)),
            unit=unit.strip(),
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


def _task_detail(db: Session, task_id: int) -> PdfImportTask:
    task = (
        db.query(PdfImportTask)
        .options(joinedload(PdfImportTask.tags), joinedload(PdfImportTask.batches))
        .filter(PdfImportTask.id == task_id)
        .first()
    )
    if not task:
        raise HTTPException(404, "任务不存在")
    return task


@router.get("/tasks/{task_id}/")
def get_task(task_id: int, db: Session = Depends(get_db)):
    task = _task_detail(db, task_id)
    return {
        "id": task.id,
        "original_name": task.original_name,
        "total_pages": task.total_pages,
        "pages_per_batch": task.pages_per_batch,
        "status": task.status,
        "tags": [{"id": t.id, "name": t.name} for t in task.tags],
        "batches": [
            {
                "id": b.id,
                "page_start": b.page_start,
                "page_end": b.page_end,
                "status": b.status,
            }
            for b in sorted(task.batches, key=lambda x: x.page_start)
        ],
    }


@router.get("/tasks/{task_id}/batches/{bid}/")
def get_batch(task_id: int, bid: int, db: Session = Depends(get_db)):
    batch = (
        db.query(PdfImportBatch)
        .filter(PdfImportBatch.id == bid, PdfImportBatch.task_id == task_id)
        .first()
    )
    if not batch:
        raise HTTPException(404, "批次不存在")
    return {
        "id": batch.id,
        "page_start": batch.page_start,
        "page_end": batch.page_end,
        "status": batch.status,
        "parsed_json": batch.parsed_json,
        "raw_response": batch.raw_response,
    }


@router.post("/tasks/{task_id}/batches/{bid}/parse/")
async def parse_batch(
    task_id: int,
    bid: int,
    body: ParseBatchBody,
    db: Session = Depends(get_db),
):
    batch = (
        db.query(PdfImportBatch)
        .filter(PdfImportBatch.id == bid, PdfImportBatch.task_id == task_id)
        .first()
    )
    if not batch:
        raise HTTPException(404, "批次不存在")

    task = _task_detail(db, task_id)
    user_tags = [t.name for t in task.tags]

    try:
        result = await parse_pdf_batch(
            body.provider,
            body.model,
            batch.chunk_path,
            batch.page_start,
            batch.page_end,
            source_filename=task.original_name,
            source_path=task.file_path,
            user_tags=user_tags,
        )
        questions = result["questions"]
        merge_task_pdf_tag(
            db, task, result.get("pdf_tag"), source_pdf=task.original_name
        )
        batch.parsed_json = questions
        batch.raw_response = json.dumps(
            {"pdf_tag": result.get("pdf_tag"), "questions": questions},
            ensure_ascii=False,
        )
        batch.status = "parsed"
        db.commit()
        return {
            "questions": questions,
            "count": len(questions),
            "pdf_tag": result.get("pdf_tag"),
            "source_pdf": task.original_name,
            "source_path": task.file_path,
        }
    except Exception as e:
        batch.status = "error"
        batch.raw_response = str(e)
        db.commit()
        raise HTTPException(500, str(e)) from e


@router.post("/tasks/{task_id}/batches/{bid}/confirm/")
def confirm_batch(task_id: int, bid: int, db: Session = Depends(get_db)):
    task = _task_detail(db, task_id)
    batch = next((b for b in task.batches if b.id == bid), None)
    if not batch or not batch.parsed_json:
        raise HTTPException(400, "请先解析该批次")

    created = []
    for item in batch.parsed_json:
        q_type = item.get("type", "single_choice")
        tag_ids = tag_ids_for_question(db, item, list(task.tags))
        q = Question(type=q_type, content=item)
        attach_tags(db, q, tag_ids)
        db.add(q)
        db.flush()
        created.append(q.id)

    batch.status = "confirmed"
    task.status = "partial"
    db.commit()
    return {"created_question_ids": created}


@router.get("/inbox/")
async def get_inbox(db: Session = Depends(get_db)):
    pdfs = await list_inbox_pdfs(db)
    from app.services.settings_store import get_pdf_inbox_dir

    return {"inbox_dir": str(get_pdf_inbox_dir()), "files": pdfs}


@router.get("/inbox/job-state/")
def inbox_job_state():
    return get_job_state()


@router.post("/inbox/cancel/")
def inbox_cancel():
    request_cancel()
    return {"ok": True, "message": "已请求取消，当前批次结束后停止"}


@router.post("/inbox/clear-job/")
def inbox_clear_job():
    clear_job()
    clear_cancel()
    return {"ok": True}


@router.post("/inbox/reset/")
def inbox_reset_file(body: InboxFileBody, db: Session = Depends(get_db)):
    try:
        return reset_inbox_pdf(db, body.filename)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e)) from e


@router.post("/inbox/process-all/")
async def inbox_process_all(body: InboxProcessBody, db: Session = Depends(get_db)):
    tag_list = [t.strip() for t in body.tags.split(",") if t.strip()]
    try:
        return await process_all_inbox(
            db,
            provider=body.provider,
            model=body.model,
            tags=tag_list,
            pages_per_batch=body.pages_per_batch,
            auto_confirm=body.auto_confirm,
        )
    except Exception as e:
        raise HTTPException(500, str(e)) from e


def _sse_stream(events):
    async def event_stream():
        try:
            async for event in events:
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            err = {"type": "fatal", "error": str(e)}
            yield f"data: {json.dumps(err, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream; charset=utf-8",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/inbox/process-all/stream/")
async def inbox_process_all_stream(body: InboxProcessBody):
    """SSE：批量导入进度（plan / file_start / batch_* / complete）。"""
    tag_list = [t.strip() for t in body.tags.split(",") if t.strip()]

    return _sse_stream(
        iter_inbox_process_all(
            provider=body.provider,
            model=body.model,
            tags=tag_list,
            pages_per_batch=body.pages_per_batch,
            auto_confirm=body.auto_confirm,
        )
    )


@router.post("/inbox/process-one/stream/")
async def inbox_process_one_stream(body: InboxProcessOneBody):
    """SSE：只处理收件箱中指定 PDF（可先 reset 再调用）。"""
    tag_list = [t.strip() for t in body.tags.split(",") if t.strip()]
    return _sse_stream(
        iter_inbox_process_one(
            body.filename,
            provider=body.provider,
            model=body.model,
            tags=tag_list,
            pages_per_batch=body.pages_per_batch,
            auto_confirm=body.auto_confirm,
        )
    )


@router.get("/inbox/failed-batches/")
def inbox_failed_batches():
    pending = list_all_pending()
    return {
        "pending": pending,
        "count_by_file": count_pending_by_file(),
        "total": len(pending),
    }


@router.post("/inbox/retry-failed/stream/")
async def inbox_retry_failed_stream(body: InboxProcessOneBody):
    """SSE：仅重导 import_batch_failures 中记录的失败批（不删已入库题）。"""
    tag_list = [t.strip() for t in body.tags.split(",") if t.strip()]

    async def events():
        from app.services.import_cancel import clear_cancel

        clear_cancel()
        start_job(file_total=1, pending_files=0)
        yield {"type": "plan", "total_files": 1, "pending_files": 0, "skipped_files": 0}
        yield {
            "type": "file_start",
            "file": body.filename,
            "file_index": 1,
            "file_total": 1,
        }

        db = SessionLocal()
        added = 0
        try:
            async for event in iter_retry_failed_batches(
                db,
                body.filename,
                provider=body.provider,
                model=body.model,
                tags=tag_list,
                auto_confirm=body.auto_confirm,
            ):
                _mirror_event_to_job(event, 1, 1)
                if event.get("type") == "retry_done":
                    added = event.get("questions_added", 0)
                yield event
        finally:
            db.close()

        finish_job(
            summary={
                "mode": "retry_failed",
                "file": body.filename,
                "questions_added": added,
            }
        )
        yield {
            "type": "complete",
            "processed": 1,
            "skipped": 0,
            "results": [],
            "skipped_files": [],
            "errors": [],
            "mode": "retry_failed",
            "questions_added": added,
        }

    return _sse_stream(events())
