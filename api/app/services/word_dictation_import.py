"""默写单词：从粘贴、Study 英语错词笔记、已入库 PDF 题目导入为 word_dictation 类型。"""

from __future__ import annotations

import io
import re
from copy import deepcopy
from pathlib import Path
from typing import Any

from pypdf import PdfReader
from sqlalchemy.orm import Session

from app.config import settings
from app.models import PracticeProgress, Question, Submission, Tag
from app.services.question_images import remove_all_images
from app.services.question_query import question_search_blob, source_pdf_from_content
from app.services.tag_hierarchy import get_or_create_child_tag, get_or_create_group_tag, tag_ids_for_metadata

DEFAULT_TAG_GROUP = "英语"
WORD_TYPE = "word_dictation"


def study_root() -> Path:
    return Path(settings.study_root).resolve()


def english_notes_dir() -> Path:
    return study_root() / "学习资料" / "笔记" / "英语"


def english_wrong_file() -> Path:
    return study_root() / "学习资料" / "英语错题" / "英语错题总记录.md"


def _normalize_word(w: str) -> str:
    return re.sub(r"\s+", " ", (w or "").strip().lower())


def _existing_word_keys(db: Session) -> set[str]:
    rows = db.query(Question).filter(Question.type == WORD_TYPE).all()
    keys: set[str] = set()
    for q in rows:
        c = q.content or {}
        for field in ("word", "title"):
            v = c.get(field)
            if isinstance(v, str) and v.strip():
                keys.add(_normalize_word(v))
        meta = c.get("metadata") or {}
        ik = meta.get("import_key")
        if isinstance(ik, str) and ik.strip():
            keys.add(ik.strip().lower())
    return keys


def _word_content(
    *,
    word: str,
    meaning: str = "",
    unit: str = "",
    book: str = "",
    import_source: str,
    import_key: str,
    source_label: str = "",
    phonetic: str = "",
    hint: str = "",
) -> dict[str, Any]:
    w = word.strip()
    m = (meaning or "").strip()
    stem = m or "（请回忆拼写）"
    bk = (book or "").strip()
    meta: dict[str, Any] = {
        "import_source": import_source,
        "import_key": import_key,
        "tag_group": bk or DEFAULT_TAG_GROUP,
        "unit": unit,
        "source_label": source_label or import_source,
    }
    if bk:
        meta["book"] = bk
    if phonetic:
        meta["phonetic"] = phonetic
    if hint:
        meta["hint"] = hint
    return {
        "type": WORD_TYPE,
        "title": w,
        "word": w,
        "meaning": m,
        "stem": stem,
        "phonetic": phonetic,
        "hint": hint,
        "answer": [w],
        "images": [],
        "metadata": meta,
    }


def _create_word_question(
    db: Session,
    *,
    word: str,
    meaning: str,
    unit: str,
    book: str = "",
    import_source: str,
    import_key: str,
    source_label: str,
    tag_group: str,
    small_tags: list[str],
) -> Question | None:
    key = import_key or f"word:{_normalize_word(word)}"
    bk = (book or tag_group or "").strip()
    content = _word_content(
        word=word,
        meaning=meaning,
        unit=unit,
        book=bk,
        import_source=import_source,
        import_key=key,
        source_label=source_label,
    )
    group = bk or DEFAULT_TAG_GROUP
    meta = content["metadata"]
    extra = list(small_tags or [])
    if bk and bk not in extra:
        extra.append(bk)
    if unit:
        ut = f"Unit{unit}".replace(" ", "")
        if ut not in extra:
            extra.append(ut)
    sl = (source_label or "").strip()
    if sl and sl not in extra:
        extra.append(sl[:120])
    meta["tags"] = extra
    if sl:
        meta["pdf_source"] = sl
    tag_ids = tag_ids_for_metadata(db, meta, group=group, extra_user_small=extra)
    get_or_create_group_tag(db, "默写单词")
    for child_short in (group, sl[:120] if sl else ""):
        if not child_short:
            continue
        child = get_or_create_child_tag(db, "默写单词", child_short)
        if child and child.id not in tag_ids:
            tag_ids.append(child.id)
    # 去重，避免 question_tags 唯一约束冲突
    tag_ids = list(dict.fromkeys(tag_ids))

    q = Question(type=WORD_TYPE, content=deepcopy(content))
    db.add(q)
    db.flush()
    if tag_ids:
        from app.services.question_tags import attach_tags

        attach_tags(db, q, tag_ids)
    q.content = deepcopy(content)
    q.source_pdf = source_pdf_from_content(content)
    q.search_text = question_search_blob(content)
    return q


def parse_paste_lines(text: str) -> list[dict[str, str]]:
    """每行：word | word,释义 | word\t释义 | word 释义"""
    out: list[dict[str, str]] = []
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        word, meaning = "", ""
        if "\t" in line:
            parts = line.split("\t", 1)
            word, meaning = parts[0].strip(), parts[1].strip() if len(parts) > 1 else ""
        elif "," in line or "，" in line:
            sep = "," if "," in line else "，"
            parts = line.split(sep, 1)
            word, meaning = parts[0].strip(), parts[1].strip() if len(parts) > 1 else ""
        elif "|" in line and not line.startswith("|"):
            parts = [p.strip() for p in line.split("|") if p.strip()]
            if len(parts) >= 2 and parts[0].isdigit():
                word = re.sub(r"^\*+|\*+$", "", parts[1]).strip()
                meaning = parts[2] if len(parts) > 2 else ""
            elif len(parts) >= 2:
                word = re.sub(r"^\*+|\*+$", "", parts[0]).strip()
                meaning = parts[1]
        else:
            m = re.match(r"^([A-Za-z][A-Za-z\-']*)\s+(.+)$", line)
            if m:
                word, meaning = m.group(1).strip(), m.group(2).strip()
            elif re.fullmatch(r"[A-Za-z][A-Za-z\-']*", line):
                word = line
        word = re.sub(r"^\*+|\*+$", "", word).strip()
        if not word or not re.search(r"[A-Za-z]", word):
            continue
        out.append({"word": word, "meaning": meaning})
    return out


def _parse_unit_from_path(path: Path) -> str:
    m = re.search(r"Unit\s*(\d+)", path.name, re.I)
    return m.group(1) if m else ""


def scan_study_english_files() -> list[Path]:
    root = english_notes_dir()
    if not root.is_dir():
        return []
    files = sorted(root.glob("*默写错词*.md"))
    wrong = english_wrong_file()
    if wrong.is_file():
        files.append(wrong)
    return files


def extract_words_from_study_file(path: Path) -> list[dict[str, str]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    unit = _parse_unit_from_path(path)
    out: list[dict[str, str]] = []

    for line in text.splitlines():
        row = line.strip()
        if not row.startswith("|") or row.count("|") < 3:
            continue
        if "单词" in row or ":---" in row:
            continue
        cells = [c.strip() for c in row.split("|") if c.strip()]
        if len(cells) < 2:
            continue
        idx = 0
        if cells[0].isdigit():
            idx = 1
        if idx >= len(cells):
            continue
        word = re.sub(r"^\*+|\*+$", "", cells[idx]).strip()
        if not word or not re.search(r"[A-Za-z]", word):
            continue
        meaning = cells[idx + 1] if len(cells) > idx + 1 else ""
        meaning = re.sub(r"^\*+|\*+$", "", meaning).strip()
        out.append({"word": word, "meaning": meaning, "unit": unit})

    for m in re.finditer(r"错词列表[^`]*`([^`]+)`", text):
        blob = m.group(1)
        for part in re.split(r"[,，、\s]+", blob):
            w = re.sub(r"[^\w\-']", "", part.strip())
            if w and re.search(r"[A-Za-z]", w):
                out.append({"word": w, "meaning": "", "unit": unit})

    return out


def extract_words_from_pdf_question(content: dict) -> dict[str, str] | None:
    """从已入库题目启发式提取单词。"""
    stem = str(content.get("stem") or content.get("title") or "").strip()
    if not stem:
        return None
    title = str(content.get("title") or "").strip()

    if re.fullmatch(r"[A-Za-z][A-Za-z\-']{0,48}", stem):
        return {"word": stem, "meaning": str(content.get("explanation") or "")}

    m = re.match(
        r"^([A-Za-z][A-Za-z\-']{0,48})\s*[:：\-—]\s*(.+)$",
        stem,
    )
    if m:
        return {"word": m.group(1).strip(), "meaning": m.group(2).strip()}

    if title and re.fullmatch(r"[A-Za-z][A-Za-z\-']{0,48}", title):
        return {"word": title, "meaning": stem}

    return None


def preview_import(db: Session) -> dict[str, Any]:
    existing = _existing_word_keys(db)
    paste_sample = 0

    study_files = scan_study_english_files()
    study_words: list[dict[str, str]] = []
    for fp in study_files:
        study_words.extend(extract_words_from_study_file(fp))

    study_new = 0
    for item in study_words:
        if _normalize_word(item["word"]) not in existing:
            study_new += 1

    pdf_candidates = 0
    pdf_new = 0
    rows = db.query(Question).filter(Question.type != WORD_TYPE).all()
    for q in rows:
        tags = [t.name for t in q.tags]
        pdf_name = (q.source_pdf or "").lower()
        if not any("英语" in t or "单词" in t for t in tags) and "英语" not in pdf_name and "单词" not in pdf_name:
            continue
        extracted = extract_words_from_pdf_question(q.content or {})
        if not extracted:
            continue
        pdf_candidates += 1
        key = f"pdf:{_normalize_word(extracted['word'])}"
        if key not in existing and _normalize_word(extracted["word"]) not in existing:
            pdf_new += 1

    in_db = db.query(Question).filter(Question.type == WORD_TYPE).count()

    return {
        "study_root": str(study_root()),
        "english_notes_dir": str(english_notes_dir()),
        "study_files": [str(p.relative_to(study_root())) for p in study_files],
        "study_word_count": len(study_words),
        "study_new_count": study_new,
        "pdf_candidate_count": pdf_candidates,
        "pdf_new_count": pdf_new,
        "word_dictation_in_db": in_db,
        "existing_word_keys": len(existing),
    }


def import_paste(
    db: Session,
    *,
    text: str,
    unit: str = "",
    tag_group: str = "",
    source_label: str = "",
    small_tags: list[str] | None = None,
) -> dict[str, Any]:
    existing = _existing_word_keys(db)
    items = parse_paste_lines(text)
    created_ids: list[int] = []
    skipped = 0
    for item in items:
        w = item["word"]
        nk = _normalize_word(w)
        ik = f"paste:{nk}"
        if nk in existing or ik in existing:
            skipped += 1
            continue
        q = _create_word_question(
            db,
            word=w,
            meaning=item.get("meaning", ""),
            unit=unit,
            import_source="paste",
            import_key=ik,
            source_label=source_label or "粘贴导入",
            tag_group=tag_group or DEFAULT_TAG_GROUP,
            small_tags=list(small_tags or []),
        )
        if q:
            created_ids.append(q.id)
            existing.add(nk)
            existing.add(ik)
    db.commit()
    return {"created": len(created_ids), "created_question_ids": created_ids, "skipped": skipped}


def import_from_study(
    db: Session,
    *,
    tag_group: str = "",
    source_label: str = "",
    small_tags: list[str] | None = None,
) -> dict[str, Any]:
    existing = _existing_word_keys(db)
    created_ids: list[int] = []
    skipped = 0
    files_touched: list[str] = []

    for fp in scan_study_english_files():
        files_touched.append(str(fp.relative_to(study_root())))
        for item in extract_words_from_study_file(fp):
            w = item["word"]
            nk = _normalize_word(w)
            unit = item.get("unit", "")
            ik = f"study:{fp.name}:{nk}"
            if nk in existing or ik in existing:
                skipped += 1
                continue
            q = _create_word_question(
                db,
                word=w,
                meaning=item.get("meaning", ""),
                unit=unit,
                import_source="study_wrong",
                import_key=ik,
                source_label=source_label or f"Study·{fp.name}",
                tag_group=tag_group or DEFAULT_TAG_GROUP,
                small_tags=list(small_tags or []),
            )
            if q:
                created_ids.append(q.id)
                existing.add(nk)
                existing.add(ik)

    db.commit()
    return {
        "created": len(created_ids),
        "created_question_ids": created_ids,
        "skipped": skipped,
        "files": files_touched,
    }


def import_from_pdf_questions(
    db: Session,
    *,
    source_pdf: str = "",
    tag_group: str = "",
    source_label: str = "",
    small_tags: list[str] | None = None,
) -> dict[str, Any]:
    existing = _existing_word_keys(db)
    created_ids: list[int] = []
    skipped = 0

    q = db.query(Question).filter(Question.type != WORD_TYPE)
    if source_pdf.strip():
        q = q.filter(Question.source_pdf == source_pdf.strip())
    rows = q.all()

    for row in rows:
        tags = [t.name for t in row.tags]
        pdf_name = (row.source_pdf or "").lower()
        if source_pdf.strip() or any("英语" in t or "单词" in t for t in tags) or "英语" in pdf_name:
            pass
        elif not source_pdf.strip():
            continue
        extracted = extract_words_from_pdf_question(row.content or {})
        if not extracted:
            continue
        w = extracted["word"]
        nk = _normalize_word(w)
        ik = f"pdf:{row.source_pdf}:{nk}"
        if nk in existing or ik in existing:
            skipped += 1
            continue
        qn = _create_word_question(
            db,
            word=w,
            meaning=extracted.get("meaning", ""),
            unit="",
            import_source="pdf_question",
            import_key=ik,
            source_label=source_label or row.source_pdf or "PDF题目",
            tag_group=tag_group or DEFAULT_TAG_GROUP,
            small_tags=list(small_tags or []),
        )
        if qn:
            created_ids.append(qn.id)
            existing.add(nk)
            existing.add(ik)

    db.commit()
    return {
        "created": len(created_ids),
        "created_question_ids": created_ids,
        "skipped": skipped,
        "source_pdf": source_pdf.strip(),
    }


def read_pdf_page_count(content: bytes) -> int:
    try:
        return len(PdfReader(io.BytesIO(content)).pages)
    except Exception:
        return 0


def _find_word_question(db: Session, normalized: str) -> Question | None:
    for q in db.query(Question).filter(Question.type == WORD_TYPE):
        c = q.content or {}
        for field in ("word", "title"):
            v = c.get(field)
            if isinstance(v, str) and _normalize_word(v) == normalized:
                return q
    return None


def delete_all_words(db: Session) -> dict[str, int]:
    """删除全部默写单词及相关提交、进度。"""
    rows = db.query(Question).filter(Question.type == WORD_TYPE).all()
    ids = [q.id for q in rows]
    if not ids:
        db.commit()
        return {"deleted": 0}
    db.query(Submission).filter(Submission.question_id.in_(ids)).delete(synchronize_session=False)
    db.query(PracticeProgress).filter(PracticeProgress.question_id.in_(ids)).delete(
        synchronize_session=False
    )
    for qid in ids:
        remove_all_images(qid)
    db.query(Question).filter(Question.id.in_(ids)).delete(synchronize_session=False)
    db.commit()
    return {"deleted": len(ids)}


def delete_words_from_pdf_source(db: Session, source_label: str) -> int:
    """二次导入：删除同一 PDF 来源标签下此前 AI 导入的单词。"""
    label = (source_label or "").strip()
    if not label:
        return 0
    to_delete: list[int] = []
    for q in db.query(Question).filter(Question.type == WORD_TYPE):
        meta = (q.content or {}).get("metadata") or {}
        if meta.get("import_source") == "pdf_llm" and str(meta.get("source_label") or "") == label:
            to_delete.append(q.id)
    for qid in to_delete:
        db.query(Submission).filter(Submission.question_id == qid).delete()
        db.query(PracticeProgress).filter(PracticeProgress.question_id == qid).delete()
        remove_all_images(qid)
        row = db.query(Question).filter(Question.id == qid).first()
        if row:
            db.delete(row)
    if to_delete:
        db.commit()
    return len(to_delete)


def _update_word_content(
    q: Question,
    *,
    word: str,
    meaning: str,
    unit: str,
    phonetic: str,
    source_label: str,
) -> None:
    c = deepcopy(q.content or {})
    meta = dict(c.get("metadata") or {})
    c["word"] = word
    c["title"] = word
    c["meaning"] = meaning
    c["stem"] = meaning or "（请回忆拼写）"
    c["answer"] = [word]
    if phonetic:
        c["phonetic"] = phonetic
        meta["phonetic"] = phonetic
    if unit:
        meta["unit"] = unit
    if source_label:
        meta["source_label"] = source_label
    c["metadata"] = meta
    q.content = c
    q.search_text = question_search_blob(c)


def import_words_batch(
    db: Session,
    words: list[dict[str, Any]],
    *,
    unit: str = "",
    book: str = "",
    tag_group: str = "",
    source_label: str = "",
    small_tags: list[str] | None = None,
    import_source: str = "pdf_llm",
    pdf_filename: str = "",
    allow_reimport: bool = False,
    replace_pdf_source: bool = False,
) -> dict[str, Any]:
    label = (source_label or pdf_filename or "英文PDF").strip()
    pdf_stem = re.sub(r"[^\w\u4e00-\u9fff\-]+", "_", Path(pdf_filename or label).stem)[:60] or "pdf"

    removed = delete_words_from_pdf_source(db, label) if replace_pdf_source else 0
    existing = _existing_word_keys(db)

    created_ids: list[int] = []
    created = 0
    updated = 0
    skipped = 0
    default_unit = unit.strip()
    default_book = book.strip()

    for item in words:
        w = str(item.get("word") or "").strip()
        if not w:
            continue
        nk = _normalize_word(w)
        meaning = str(item.get("meaning") or "").strip()
        phonetic = str(item.get("phonetic") or "").strip()
        row_unit = str(item.get("unit") or default_unit).strip()
        row_book = str(item.get("book") or default_book).strip()
        ik = f"word:{row_book}:{row_unit}:{nk}" if row_book and row_unit else f"word:{nk}"

        if allow_reimport:
            found = _find_word_question(db, nk)
            if found:
                _update_word_content(
                    found,
                    word=w,
                    meaning=meaning,
                    unit=row_unit,
                    phonetic=phonetic,
                    source_label=label,
                )
                updated += 1
                continue

        # 全局去重：同一单词只保留一条（不重复导入）
        if nk in existing:
            skipped += 1
            continue

        q = _create_word_question(
            db,
            word=w,
            meaning=meaning,
            unit=row_unit,
            book=row_book,
            import_source=import_source,
            import_key=ik,
            source_label=label,
            tag_group=row_book or tag_group or DEFAULT_TAG_GROUP,
            small_tags=list(small_tags or []),
        )
        if q and phonetic:
            c = dict(q.content or {})
            c["phonetic"] = phonetic
            meta = dict(c.get("metadata") or {})
            meta["phonetic"] = phonetic
            c["metadata"] = meta
            q.content = c
            q.search_text = question_search_blob(c)
        if q:
            created_ids.append(q.id)
            existing.add(nk)
            if ik:
                existing.add(ik.lower())
            created += 1

    db.commit()
    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "removed": removed,
        "created_question_ids": created_ids,
        "source_label": label,
        "book": default_book,
        "unit": default_unit,
    }
