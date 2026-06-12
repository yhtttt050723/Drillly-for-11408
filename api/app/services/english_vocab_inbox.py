"""英文词汇 PDF 收件箱：放入目录后批量 AI 导入。"""

from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.services.english_pdf_import import import_english_pdf
from app.services.english_vocab_ledger import (
    clear_record,
    get_import_record,
    is_imported,
    mark_imported,
)
from app.services.settings_store import get_english_vocab_inbox_dir
from app.services.word_vocab_meta import parse_vocab_pdf_filename


def normalize_pdf_filename(name: str) -> str:
    """去掉扩展名前后空白，避免 Windows 无法打开「unit1 .pdf」。"""
    stem = Path(name.strip()).stem.strip()
    stem = re.sub(r'[<>:"/\\|?*]', "_", stem)
    stem = re.sub(r"\s+", " ", stem).strip() or "vocab"
    return f"{stem}.pdf"


def list_inbox_pdf_paths(inbox: Path | None = None) -> list[Path]:
    root = inbox or get_english_vocab_inbox_dir()
    root.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for entry in os.scandir(root):
        if entry.is_file() and entry.name.lower().endswith(".pdf"):
            paths.append(Path(entry.path))
    return sorted(paths, key=lambda p: p.name.lower())


def ensure_normalized_pdf(path: Path) -> Path:
    clean = normalize_pdf_filename(path.name)
    if clean == path.name:
        return path
    dest = path.parent / clean
    if dest.exists() and dest.resolve() != path.resolve():
        dest.unlink()
    path.rename(dest)
    return dest


def list_english_vocab_inbox(db: Session | None = None) -> list[dict[str, Any]]:
    inbox = get_english_vocab_inbox_dir()
    inbox.mkdir(parents=True, exist_ok=True)
    files = sorted(
        (ensure_normalized_pdf(p) for p in list_inbox_pdf_paths(inbox)),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )

    word_counts: dict[str, int] = {}
    if db is not None:
        from app.models import Question
        from app.services.word_dictation_import import WORD_TYPE

        for q in db.query(Question).filter(Question.type == WORD_TYPE):
            meta = (q.content or {}).get("metadata") or {}
            label = str(meta.get("source_label") or "")
            if label:
                word_counts[label] = word_counts.get(label, 0) + 1

    out: list[dict[str, Any]] = []
    for f in files:
        rec = get_import_record(f)
        parsed = parse_vocab_pdf_filename(f.name)
        item: dict[str, Any] = {
            "name": f.name,
            "path": str(f),
            "size_mb": round(f.stat().st_size / (1024 * 1024), 2),
            "book": parsed["book"],
            "unit": parsed["unit"],
            "imported": rec is not None,
        }
        if rec:
            item["imported_at"] = rec.get("imported_at")
            item["word_count"] = rec.get("word_count")
            item["created"] = rec.get("created")
            item["skipped"] = rec.get("skipped")
            item["book"] = rec.get("book") or parsed["book"]
            item["unit"] = rec.get("unit") or parsed["unit"]
        out.append(item)
    return out


async def process_one_english_vocab_pdf(
    db: Session,
    filename: str,
    *,
    provider: str = "deepseek",
    model: str | None = None,
    pages_per_batch: int = 3,
    book: str = "",
    unit: str = "",
    force: bool = False,
) -> dict[str, Any]:
    inbox = get_english_vocab_inbox_dir()
    pdf_path = inbox / filename
    if not pdf_path.is_file():
        for p in list_inbox_pdf_paths(inbox):
            if p.name == filename or normalize_pdf_filename(p.name) == filename:
                pdf_path = p
                filename = p.name
                break
    if not pdf_path.is_file():
        raise FileNotFoundError(f"收件箱中无此文件：{filename}")
    pdf_path = ensure_normalized_pdf(pdf_path)
    filename = pdf_path.name

    if is_imported(pdf_path) and not force:
        rec = get_import_record(pdf_path)
        return {
            "file": filename,
            "skipped": True,
            "reason": "已导入过（内容指纹相同）。勾选强制可重导",
            "record": rec,
        }

    parsed = parse_vocab_pdf_filename(filename)
    use_book = (book or parsed["book"]).strip()
    use_unit = (unit or parsed["unit"]).strip()
    label = parsed["source_label"] or filename

    content = pdf_path.read_bytes()
    result = await import_english_pdf(
        db,
        content,
        filename=filename,
        provider=provider,
        model=model,
        pages_per_batch=pages_per_batch,
        unit=use_unit,
        book=use_book,
        source_label=label,
        allow_reimport=False,
        replace_pdf_source=force,
    )
    imp = result.get("imported") or {}
    mark_imported(
        pdf_path,
        word_count=result.get("word_count", 0),
        created=int(imp.get("created", 0)),
        skipped=int(imp.get("skipped", 0)),
        book=use_book,
        unit=use_unit,
    )

    done_dir = inbox / "已处理"
    done_dir.mkdir(exist_ok=True)
    dest = done_dir / filename
    if dest.exists():
        dest.unlink()
    shutil.move(str(pdf_path), str(dest))

    return {
        "file": filename,
        "ok": True,
        "book": use_book,
        "unit": use_unit,
        "word_count": result.get("word_count"),
        "imported": imp,
        "logs": result.get("logs", []),
        "moved_to": str(dest),
    }


async def process_all_english_vocab_inbox(
    db: Session,
    *,
    provider: str = "deepseek",
    model: str | None = None,
    pages_per_batch: int = 3,
    skip_imported: bool = True,
    force: bool = False,
    default_book: str = "",
) -> dict[str, Any]:
    inbox = get_english_vocab_inbox_dir()
    inbox.mkdir(parents=True, exist_ok=True)
    pdfs = [ensure_normalized_pdf(p) for p in list_inbox_pdf_paths(inbox)]

    results: list[dict[str, Any]] = []
    ok_count = 0
    skip_count = 0
    err_count = 0

    for pdf_path in pdfs:
        if skip_imported and not force and is_imported(pdf_path):
            results.append(
                {
                    "file": pdf_path.name,
                    "skipped": True,
                    "reason": "已导入",
                }
            )
            skip_count += 1
            continue
        try:
            r = await process_one_english_vocab_pdf(
                db,
                pdf_path.name,
                provider=provider,
                model=model,
                pages_per_batch=pages_per_batch,
                book=default_book,
                force=force,
            )
            if r.get("skipped"):
                skip_count += 1
            else:
                ok_count += 1
            results.append(r)
        except Exception as e:
            err_count += 1
            results.append({"file": pdf_path.name, "error": str(e)})

    return {
        "inbox_dir": str(inbox),
        "total": len(pdfs),
        "processed": ok_count,
        "skipped": skip_count,
        "errors": err_count,
        "results": results,
    }


def restore_inbox_from_processed() -> dict[str, Any]:
    """将「已处理」子目录中的 PDF 移回收件箱，便于全量重导。"""
    inbox = get_english_vocab_inbox_dir()
    done = inbox / "已处理"
    moved: list[str] = []
    if done.is_dir():
        for f in sorted(done.glob("*.pdf")):
            dest = inbox / f.name
            if dest.exists():
                dest.unlink()
            shutil.move(str(f), str(dest))
            moved.append(f.name)
    return {"moved": len(moved), "files": moved}


def reset_english_vocab_inbox_file(filename: str) -> dict[str, Any]:
    """清除导入记录，并把 已处理/ 里的文件移回收件箱以便重导。"""
    inbox = get_english_vocab_inbox_dir()
    done = inbox / "已处理" / filename
    target = inbox / filename
    if done.is_file():
        inbox.mkdir(parents=True, exist_ok=True)
        if target.exists():
            target.unlink()
        shutil.move(str(done), str(target))
    cleared = False
    if target.is_file():
        cleared = clear_record(target)
    return {"file": filename, "ledger_cleared": cleared, "restored": target.is_file()}
