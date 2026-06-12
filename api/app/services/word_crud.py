"""默写单词题库增删改查。"""

from __future__ import annotations

import re
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.models import PracticeProgress, Question, Submission, Tag
from app.services.question_images import remove_all_images
from app.services.question_query import (
    progress_map,
    question_matches_tag_filter,
    question_search_blob,
    source_pdf_from_content,
)
from app.services.word_dictation_import import (
    DEFAULT_TAG_GROUP,
    WORD_TYPE,
    _create_word_question,
    _normalize_word,
)
from app.services.word_wrong import filter_words_by_wrong, latest_submission_map


def _meta(content: dict[str, Any]) -> dict[str, Any]:
    m = content.get("metadata")
    return m if isinstance(m, dict) else {}


def _practice_history_meta(meta: dict[str, Any]) -> dict[str, Any]:
    hist = meta.get("practice_history")
    if not isinstance(hist, list):
        hist = []
    return {
        "practice_history_count": len(hist),
        "last_practice_archive": hist[-1] if hist else None,
    }


def _word_row_dict(
    q: Question,
    prog: dict[str, bool],
    sub: Submission | None,
) -> dict[str, Any]:
    c = q.content or {}
    meta = _meta(c)
    from app.services.tag_hierarchy import WORD_DICTATION_PARENT, child_full_name
    from app.services.word_wrong import WRONG_CHILD_TAG

    last_mark = None
    if sub:
        ans = sub.answer or {}
        if ans.get("self_mark") in ("correct", "wrong"):
            last_mark = ans["self_mark"]
        else:
            last_mark = "correct" if sub.is_correct else "wrong"
    wrong_full = child_full_name(WORD_DICTATION_PARENT, WRONG_CHILD_TAG)
    return {
        "id": q.id,
        "word": str(c.get("word") or c.get("title") or "").strip(),
        "meaning": str(c.get("meaning") or "").strip(),
        "unit": str(meta.get("unit") or "").strip(),
        "phonetic": str(c.get("phonetic") or meta.get("phonetic") or "").strip(),
        "hint": str(c.get("hint") or meta.get("hint") or "").strip(),
        "source_label": str(meta.get("source_label") or "").strip(),
        "import_source": str(meta.get("import_source") or "").strip(),
        "book": str(meta.get("book") or meta.get("tag_group") or "").strip(),
        "tag_names": [t.name for t in (q.tags or [])],
        "small_tags": _small_tags_from_question(q),
        "wrong_count": int(meta.get("wrong_count") or 0),
        "last_wrong_at": meta.get("last_wrong_at") or "",
        "last_mark": last_mark,
        "has_wrong_tag": any(t.name == wrong_full for t in (q.tags or [])),
        "round1": bool(prog.get("round1")),
        "round2": bool(prog.get("round2")),
        **_practice_history_meta(meta),
    }


def words_to_dict(db: Session, rows: list[Question]) -> list[dict[str, Any]]:
    if not rows:
        return []
    ids = [r.id for r in rows]
    pmap = progress_map(db, ids)
    subs = latest_submission_map(db, ids)
    return [_word_row_dict(r, pmap.get(r.id, {"round1": False, "round2": False}), subs.get(r.id)) for r in rows]


def word_to_dict(q: Question, db: Session) -> dict[str, Any]:
    subs = latest_submission_map(db, [q.id])
    return _word_row_dict(
        q,
        progress_map(db, [q.id]).get(q.id, {"round1": False, "round2": False}),
        subs.get(q.id),
    )


def _small_tags_from_question(q: Question) -> list[str]:
    from app.services.tag_hierarchy import WORD_DICTATION_PARENT, parse_child_display

    out: list[str] = []
    skip = {WORD_DICTATION_PARENT, "错词"}
    for t in q.tags or []:
        g, short = parse_child_display(t.name)
        if g == WORD_DICTATION_PARENT and short and short not in skip:
            if short not in out:
                out.append(short)
    return out


def _load_word(db: Session, word_id: int) -> Question:
    q = (
        db.query(Question)
        .options(joinedload(Question.tags))
        .filter(Question.id == word_id, Question.type == WORD_TYPE)
        .first()
    )
    if not q:
        raise HTTPException(404, "单词不存在")
    return q


def _word_taken(db: Session, normalized: str, *, exclude_id: int | None = None) -> bool:
    rows = db.query(Question).filter(Question.type == WORD_TYPE)
    if exclude_id is not None:
        rows = rows.filter(Question.id != exclude_id)
    for q in rows:
        c = q.content or {}
        for field in ("word", "title"):
            v = c.get(field)
            if isinstance(v, str) and _normalize_word(v) == normalized:
                return True
    return False


def _word_unit(q: Question) -> str:
    meta = _meta(q.content or {})
    u = normalize_unit_label(str(meta.get("unit") or ""))
    if u:
        return u
    for t in q.tags or []:
        if "/Unit" in t.name or re.search(r"unit\s*\d+", t.name, re.I):
            part = t.name.split("/")[-1]
            nu = normalize_unit_label(part)
            if nu:
                return nu
    return ""


def _word_book(q: Question) -> str:
    meta = _meta(q.content or {})
    bk = str(meta.get("book") or meta.get("tag_group") or "").strip()
    if bk:
        return bk
    from app.services.tag_hierarchy import WORD_DICTATION_PARENT, parse_child_display

    for t in q.tags or []:
        g, short = parse_child_display(t.name)
        if g == WORD_DICTATION_PARENT and short and not normalize_unit_label(short):
            if short not in ("错词", "AI提取"):
                return short
    return ""


def _filter_word_rows(
    db: Session,
    *,
    q: str = "",
    unit: str = "",
    book: str = "",
    tag: str = "",
    wrong_only: str = "",
) -> list[Question]:
    unit_filter = unit.strip()
    book_filter = book.strip()
    query = (
        db.query(Question)
        .options(joinedload(Question.tags))
        .filter(Question.type == WORD_TYPE)
    )
    if q.strip():
        query = query.filter(Question.search_text.ilike(f"%{q.strip()}%"))
    if unit_filter:
        u = unit_filter
        query = (
            query.join(Question.tags)
            .filter(
                or_(
                    Tag.name.ilike(f"%/Unit{u}"),
                    Tag.name.ilike(f"%unit{u}"),
                    Tag.name.ilike(f"%Unit{u}%"),
                )
            )
            .distinct()
        )
    rows = query.order_by(Question.id).all()

    if unit_filter or book_filter:
        filtered = []
        for r in rows:
            if unit_filter and _word_unit(r) != unit_filter:
                continue
            if book_filter and _word_book(r) != book_filter:
                if not question_matches_tag_filter(
                    {t.name for t in (r.tags or [])}, book_filter
                ):
                    continue
            filtered.append(r)
        rows = filtered

    tag_filter = tag.strip()
    if tag_filter:
        rows = [
            r
            for r in rows
            if question_matches_tag_filter({t.name for t in (r.tags or [])}, tag_filter)
        ]

    if wrong_only in ("wrong", "correct", "unmarked"):
        rows = filter_words_by_wrong(rows, db, mode=wrong_only)
    return rows


def list_words(
    db: Session,
    *,
    q: str = "",
    unit: str = "",
    book: str = "",
    tag: str = "",
    wrong_only: str = "",
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    rows = _filter_word_rows(
        db,
        q=q,
        unit=unit,
        book=book,
        tag=tag,
        wrong_only=wrong_only,
    )
    total = len(rows)
    page = rows[offset : offset + limit]
    return {
        "items": words_to_dict(db, page),
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def list_word_unit_tags(db: Session, *, book: str = "", unit: str = "") -> list[str]:
    """当前单元出现过的子标签（轻量，不序列化整页单词）。"""
    if not unit.strip():
        return []
    rows = _filter_word_rows(db, book=book, unit=unit)
    book_filter = book.strip()
    skip = {book_filter, "错词"} if book_filter else {"错词"}
    tags: set[str] = set()
    for r in rows:
        for t in _small_tags_from_question(r):
            if t in skip:
                continue
            if re.match(r"^Unit\d+$", t.replace(" ", ""), re.I):
                continue
            tags.add(t)
    return sorted(tags)


def reset_word_practice(
    db: Session,
    *,
    book: str = "",
    unit: str = "",
    tag: str = "",
) -> dict[str, Any]:
    """重刷：归档一刷/二刷进度后清零（提交记录与错词标签保留）。"""
    rows = _filter_word_rows(db, book=book, unit=unit, tag=tag)
    ids = [r.id for r in rows]
    if not ids:
        return {"reset": 0, "archived": 0, "question_ids": []}
    pmap = progress_map(db, ids)
    archived = 0
    now = datetime.now(timezone.utc).isoformat()
    for q in rows:
        prog = pmap.get(q.id, {})
        if not (prog.get("round1") or prog.get("round2")):
            continue
        c = deepcopy(q.content or {})
        meta = _meta(c)
        hist = meta.get("practice_history")
        if not isinstance(hist, list):
            hist = []
        hist.append(
            {
                "archived_at": now,
                "round1": bool(prog.get("round1")),
                "round2": bool(prog.get("round2")),
                "book": book.strip(),
                "unit": unit.strip(),
                "tag": tag.strip(),
            }
        )
        meta["practice_history"] = hist[-30:]
        c["metadata"] = meta
        q.content = c
        archived += 1
    db.query(PracticeProgress).filter(PracticeProgress.question_id.in_(ids)).delete(
        synchronize_session=False
    )
    db.commit()
    return {"reset": len(ids), "archived": archived, "question_ids": ids}


def get_word(db: Session, word_id: int) -> dict[str, Any]:
    return word_to_dict(_load_word(db, word_id), db)


def create_word(
    db: Session,
    *,
    word: str,
    meaning: str = "",
    unit: str = "",
    book: str = "",
    phonetic: str = "",
    hint: str = "",
    source_label: str = "",
    tag_group: str = DEFAULT_TAG_GROUP,
    small_tags: list[str] | None = None,
) -> dict[str, Any]:
    w = (word or "").strip()
    if not w:
        raise ValueError("单词不能为空")
    nk = _normalize_word(w)
    if _word_taken(db, nk):
        raise ValueError(f"单词已存在：{w}")

    bk = (book or tag_group or DEFAULT_TAG_GROUP).strip()
    q = _create_word_question(
        db,
        word=w,
        meaning=(meaning or "").strip(),
        unit=(unit or "").strip(),
        book=bk,
        import_source="manual",
        import_key=f"manual:{nk}",
        source_label=(source_label or "").strip() or "手动添加",
        tag_group=bk,
        small_tags=list(small_tags or []),
    )
    if phonetic or hint:
        c = dict(q.content or {})
        if phonetic:
            c["phonetic"] = phonetic.strip()
            _meta(c)["phonetic"] = phonetic.strip()
        if hint:
            c["hint"] = hint.strip()
            _meta(c)["hint"] = hint.strip()
        q.content = c
        q.search_text = question_search_blob(c)

    db.commit()
    db.refresh(q)
    return word_to_dict(_load_word(db, q.id), db)


def mark_word_wrong(db: Session, word_id: int) -> dict[str, Any]:
    from app.services.word_wrong import record_word_wrong

    q = _load_word(db, word_id)
    record_word_wrong(db, q)
    db.commit()
    return word_to_dict(_load_word(db, word_id), db)


def clear_word_wrong(db: Session, word_id: int) -> dict[str, Any]:
    from app.services.word_wrong import record_word_correct

    q = _load_word(db, word_id)
    record_word_correct(db, q, clear_wrong_tag=True)
    db.commit()
    return word_to_dict(_load_word(db, word_id), db)


def update_word(
    db: Session,
    word_id: int,
    *,
    word: str | None = None,
    meaning: str | None = None,
    unit: str | None = None,
    book: str | None = None,
    phonetic: str | None = None,
    hint: str | None = None,
    source_label: str | None = None,
) -> dict[str, Any]:
    q = _load_word(db, word_id)
    c = deepcopy(q.content or {})
    meta = dict(_meta(c))

    if word is not None:
        w = word.strip()
        if not w:
            raise ValueError("单词不能为空")
        nk = _normalize_word(w)
        if _word_taken(db, nk, exclude_id=word_id):
            raise ValueError(f"单词已存在：{w}")
        c["word"] = w
        c["title"] = w
        c["answer"] = [w]
        meta["import_key"] = f"manual:{nk}"

    if meaning is not None:
        m = meaning.strip()
        c["meaning"] = m
        c["stem"] = m or "（请回忆拼写）"

    if unit is not None:
        meta["unit"] = unit.strip()

    if book is not None:
        bk = book.strip()
        meta["book"] = bk
        if bk:
            meta["tag_group"] = bk

    if phonetic is not None:
        p = phonetic.strip()
        c["phonetic"] = p
        if p:
            meta["phonetic"] = p
        elif "phonetic" in meta:
            del meta["phonetic"]

    if hint is not None:
        h = hint.strip()
        c["hint"] = h
        if h:
            meta["hint"] = h
        elif "hint" in meta:
            del meta["hint"]

    if source_label is not None:
        meta["source_label"] = source_label.strip()

    c["metadata"] = meta
    q.content = c
    q.source_pdf = source_pdf_from_content(c)
    q.search_text = question_search_blob(c)

    if unit is not None or book is not None:
        from app.services.word_tags import set_word_tags

        set_word_tags(
            db,
            word_id,
            book=book if book is not None else str(meta.get("book") or ""),
            unit=unit if unit is not None else str(meta.get("unit") or ""),
            small_tags=list(meta.get("tags") or []) if isinstance(meta.get("tags"), list) else [],
        )
        return word_to_dict(_load_word(db, word_id), db)

    db.commit()
    return word_to_dict(_load_word(db, word_id), db)


def delete_word(db: Session, word_id: int) -> dict[str, Any]:
    q = _load_word(db, word_id)
    db.query(Submission).filter(Submission.question_id == word_id).delete()
    db.query(PracticeProgress).filter(PracticeProgress.question_id == word_id).delete()
    remove_all_images(word_id)
    db.delete(q)
    db.commit()
    return {"ok": True, "id": word_id}


def normalize_unit_label(raw: str) -> str:
    """从 metadata.unit 或 Unit12 等字符串提取单元编号。"""
    s = (raw or "").strip()
    if not s:
        return ""
    m = re.search(r"[Uu]nit\s*(\d+)", s)
    if m:
        return str(int(m.group(1)))
    if s.isdigit():
        return str(int(s))
    m = re.search(r"(\d+)", s)
    return str(int(m.group(1))) if m else s


def list_word_units(db: Session) -> list[str]:
    rows = db.query(Question).filter(Question.type == WORD_TYPE).all()
    units: set[str] = set()
    for q in rows:
        meta = _meta(q.content or {})
        u = normalize_unit_label(str(meta.get("unit") or ""))
        if u:
            units.add(u)
        for t in q.tags or []:
            if "/Unit" in t.name:
                part = t.name.split("/")[-1]
                nu = normalize_unit_label(part)
                if nu:
                    units.add(nu)
    return sorted(units, key=lambda x: (not x.isdigit(), int(x) if x.isdigit() else 0, x))


def list_word_books(db: Session) -> list[str]:
    rows = db.query(Question).filter(Question.type == WORD_TYPE).all()
    books: set[str] = set()
    for q in rows:
        meta = _meta(q.content or {})
        bk = str(meta.get("book") or meta.get("tag_group") or "").strip()
        if bk:
            books.add(bk)
    return sorted(books)
