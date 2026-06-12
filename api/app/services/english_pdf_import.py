"""英文词汇 PDF：复用 PDF 分批 + LLM（DeepSeek 等）解析后写入默写词库。"""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.config import settings
from app.services.llm import parse_english_vocab_pdf_batch
from app.services.word_dictation_import import (
    DEFAULT_TAG_GROUP,
    _normalize_word,
    delete_words_from_pdf_source,
    import_words_batch,
    read_pdf_page_count,
)
from app.services.word_vocab_meta import parse_vocab_pdf_filename
from app.tools.split_pdf import split_pdf


def _safe_vocab_dest_name(filename: str) -> str:
    """规范化 PDF 文件名（含「unit1 .pdf」这类扩展名前空格）。"""
    stem = Path((filename or "vocab.pdf").strip()).stem.strip()
    stem = re.sub(r'[<>:"/\\|?*]', "_", stem)
    stem = re.sub(r"\s+", " ", stem).strip() or "vocab"
    return f"{uuid.uuid4().hex}_{stem}.pdf"


async def extract_words_via_llm(
    content: bytes,
    *,
    filename: str,
    provider: str = "deepseek",
    model: str | None = None,
    pages_per_batch: int = 3,
    unit: str = "",
    book: str = "",
    preview_only: bool = False,
) -> dict[str, Any]:
    parsed_name = parse_vocab_pdf_filename(filename) if filename else {}
    detected_book = (book or parsed_name.get("book") or "").strip()
    detected_unit = (unit or parsed_name.get("unit") or "").strip()
    max_bytes = settings.pdf_max_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise ValueError(f"PDF 超过 {settings.pdf_max_mb}MB")

    batch_size = max(1, min(10, pages_per_batch))
    safe_name = _safe_vocab_dest_name(filename)
    dest_dir = settings.media_dir / "imports" / "english_vocab"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / safe_name
    dest_path.write_bytes(content)

    chunks_dir = dest_dir / "chunks" / dest_path.stem
    chunk_list = split_pdf(dest_path, chunks_dir, batch_size)
    total_pages = read_pdf_page_count(content)

    if not chunk_list:
        raise ValueError("PDF 无有效页面")

    batches_to_run = chunk_list[:1] if preview_only else chunk_list
    all_words: list[dict[str, str]] = []
    seen: set[str] = set()
    logs: list[str] = []
    errors: list[str] = []

    unit_hint = detected_unit
    if detected_book and detected_unit:
        unit_hint = f"{detected_book} Unit{detected_unit}"
    elif detected_book:
        unit_hint = detected_book

    for page_start, page_end, chunk_path in batches_to_run:
        try:
            result = await parse_english_vocab_pdf_batch(
                provider,
                model,
                str(chunk_path),
                page_start,
                page_end,
                source_filename=filename or dest_path.name,
                unit_hint=unit_hint,
                book_hint=detected_book,
            )
            batch_words = result.get("words") or []
            if not detected_unit and result.get("unit"):
                detected_unit = str(result["unit"]).strip()
            mode = result.get("extract_mode", "?")
            added = 0
            for item in batch_words:
                w = str(item.get("word") or "").strip()
                nk = _normalize_word(w)
                if not nk or nk in seen:
                    continue
                seen.add(nk)
                row: dict[str, str] = {
                    "word": w,
                    "meaning": str(item.get("meaning") or "").strip(),
                    "unit": str(item.get("unit") or detected_unit).strip(),
                    "book": str(item.get("book") or detected_book).strip(),
                }
                if item.get("phonetic"):
                    row["phonetic"] = str(item["phonetic"]).strip()
                all_words.append(row)
                added += 1
            logs.append(
                f"第 {page_start}–{page_end} 页 · {mode} · 提取 {added} 词（累计 {len(all_words)}）"
            )
        except Exception as e:
            msg = f"第 {page_start}–{page_end} 页失败: {e}"
            logs.append(msg)
            errors.append(msg)

    if not all_words and errors:
        raise ValueError(errors[0])

    return {
        "pages": total_pages,
        "batches": len(chunk_list),
        "batches_processed": len(batches_to_run),
        "word_count": len(all_words),
        "words": all_words[:300],
        "all_words": all_words,
        "truncated": len(all_words) > 300,
        "unit": detected_unit,
        "book": detected_book,
        "provider": provider,
        "model": model or "",
        "logs": logs,
        "errors": errors,
        "filename": filename,
        "preview_only": preview_only,
    }


async def import_english_pdf(
    db: Session,
    content: bytes,
    *,
    filename: str = "",
    provider: str = "deepseek",
    model: str | None = None,
    pages_per_batch: int = 3,
    unit: str = "",
    book: str = "",
    tag_group: str = DEFAULT_TAG_GROUP,
    source_label: str = "",
    small_tags: list[str] | None = None,
    auto_import: bool = True,
    allow_reimport: bool = False,
    replace_pdf_source: bool = False,
) -> dict[str, Any]:
    parsed = parse_vocab_pdf_filename(filename) if filename else {}
    use_book = (book or parsed.get("book") or "").strip()
    use_unit = (unit or parsed.get("unit") or "").strip()
    label = (source_label or parsed.get("source_label") or filename or "英文PDF").strip()
    extracted = await extract_words_via_llm(
        content,
        filename=filename,
        provider=provider,
        model=model,
        pages_per_batch=pages_per_batch,
        unit=use_unit,
        book=use_book,
        preview_only=False,
    )

    word_list = extracted.get("all_words") or extracted.get("words") or []
    if not word_list:
        raise ValueError(
            "AI 未提取到单词。请在「设置」或下方填写 DeepSeek API Key，并确认 PDF 为词汇表。"
        )

    result: dict[str, Any] = {k: v for k, v in extracted.items() if k != "all_words"}

    if auto_import:
        pdf_tag = (parsed.get("pdf_tag") or label).strip()
        batch_tags: list[str] = []
        for t in [pdf_tag, use_book, f"Unit{use_unit}" if use_unit else "", *(small_tags or [])]:
            s = str(t).strip()
            if s and s not in batch_tags:
                batch_tags.append(s)
        if not use_book:
            batch_tags.append("英文PDF")
        batch_tags.append("AI提取")

        imp = import_words_batch(
            db,
            word_list,
            unit=extracted.get("unit") or use_unit,
            book=extracted.get("book") or use_book,
            tag_group=use_book or tag_group,
            source_label=label,
            small_tags=batch_tags,
            import_source="pdf_llm",
            pdf_filename=filename,
            allow_reimport=allow_reimport,
            replace_pdf_source=replace_pdf_source,
        )
        result["imported"] = imp

    return result


async def preview_english_pdf(
    content: bytes,
    *,
    filename: str = "",
    provider: str = "deepseek",
    model: str | None = None,
    pages_per_batch: int = 3,
    unit: str = "",
) -> dict[str, Any]:
    r = await extract_words_via_llm(
        content,
        filename=filename,
        provider=provider,
        model=model,
        pages_per_batch=pages_per_batch,
        unit=unit,
        preview_only=True,
    )
    return {k: v for k, v in r.items() if k != "all_words"}
