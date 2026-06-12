"""默写单词标签：设置、合并标签名、合并词条。"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from sqlalchemy.orm import Session, joinedload

from app.models import Question, Tag
from app.services.pdf_source_tag import is_pdf_source_tag
from app.services.question_query import question_search_blob, source_pdf_from_content
from app.services.question_tags import attach_tags
from app.services.tag_hierarchy import (
    WORD_DICTATION_PARENT,
    child_full_name,
    get_or_create_child_tag,
    get_or_create_group_tag,
    normalize_small_tags,
    parse_child_display,
)
from app.services.word_crud import _load_word, _meta, word_to_dict
from app.services.word_dictation_import import WORD_TYPE
from app.services.word_wrong import remove_wrong_tag


def list_word_tag_catalog(db: Session) -> dict[str, Any]:
    """默写单词下已有子标签 + 词书列表。"""
    prefix = f"{WORD_DICTATION_PARENT}/"
    children: set[str] = set()
    books: set[str] = set()
    for t in db.query(Tag).filter(Tag.name.like(f"{prefix}%")).all():
        _, short = parse_child_display(t.name)
        if short:
            children.add(short)
    for q in db.query(Question).filter(Question.type == WORD_TYPE):
        meta = _meta(q.content or {})
        bk = str(meta.get("book") or meta.get("tag_group") or "").strip()
        if bk:
            books.add(bk)
        for t in q.tags or []:
            if t.name.startswith(prefix):
                _, short = parse_child_display(t.name)
                if short:
                    children.add(short)
    return {
        "parent": WORD_DICTATION_PARENT,
        "children": sorted(children),
        "books": sorted(books),
    }


def _topic_child_names(book: str, unit: str, small_tags: list[str]) -> list[str]:
    out: list[str] = []
    bk = book.strip()
    u = unit.strip()
    if bk:
        out.append(bk)
    if u:
        ut = f"Unit{u}".replace(" ", "")
        if ut not in out:
            out.append(ut)
    for s in small_tags:
        s = s.strip()
        if not s or s in out:
            continue
        if s == bk or s == f"Unit{u}":
            continue
        out.append(s)
    return out[:6]


def set_word_tags(
    db: Session,
    word_id: int,
    *,
    book: str | None = None,
    unit: str | None = None,
    small_tags: list[str] | None = None,
    keep_wrong_tag: bool = True,
) -> dict[str, Any]:
    q = _load_word(db, word_id)
    c = deepcopy(q.content or {})
    meta = dict(_meta(c))

    if book is not None:
        bk = book.strip()
        meta["book"] = bk
        meta["tag_group"] = bk or meta.get("tag_group") or "英语"
    if unit is not None:
        meta["unit"] = unit.strip()
    if small_tags is not None:
        meta["tags"] = normalize_small_tags(
            str(meta.get("book") or meta.get("tag_group") or "英语"),
            small_tags,
        )

    c["metadata"] = meta
    q.content = c
    q.search_text = question_search_blob(c)

    bk = str(meta.get("book") or meta.get("tag_group") or "").strip()
    u = str(meta.get("unit") or "").strip()
    extras = list(meta.get("tags") or [])
    if isinstance(extras, str):
        extras = [extras]

    preserved = [t for t in (q.tags or []) if is_pdf_source_tag(t.name)]
    wrong_full = child_full_name(WORD_DICTATION_PARENT, "错词")
    if keep_wrong_tag and any(t.name == wrong_full for t in (q.tags or [])):
        preserved_ids = {t.id for t in preserved}
        wrong_tag = db.query(Tag).filter(Tag.name == wrong_full).first()
        if wrong_tag and wrong_tag.id not in preserved_ids:
            preserved.append(wrong_tag)

    ids: list[int] = [t.id for t in preserved]
    get_or_create_group_tag(db, WORD_DICTATION_PARENT)
    for short in _topic_child_names(bk, u, extras if isinstance(extras, list) else []):
        child = get_or_create_child_tag(db, WORD_DICTATION_PARENT, short)
        if child and child.id not in ids:
            ids.append(child.id)

    attach_tags(db, q, ids)
    q.source_pdf = source_pdf_from_content(c)
    db.commit()
    return word_to_dict(_load_word(db, word_id), db)


def merge_word_tag_names(
    db: Session,
    *,
    from_name: str,
    to_name: str,
) -> dict[str, Any]:
    """将「默写单词/from」合并为「默写单词/to」（所有单词题）。"""
    src = from_name.strip().replace("/", "·")
    dst = to_name.strip().replace("/", "·")
    if not src or not dst:
        raise ValueError("from_name 与 to_name 不能为空")
    if src == dst:
        return {"updated": 0, "merged": dst}

    from_full = child_full_name(WORD_DICTATION_PARENT, src)
    to_full = child_full_name(WORD_DICTATION_PARENT, dst)
    if not from_full or not to_full:
        raise ValueError("无效标签名")

    src_tag = db.query(Tag).filter(Tag.name == from_full).first()
    dst_tag = get_or_create_child_tag(db, WORD_DICTATION_PARENT, dst)
    if not src_tag:
        return {"updated": 0, "merged": dst, "note": "源标签不存在"}

    rows = (
        db.query(Question)
        .options(joinedload(Question.tags))
        .filter(Question.type == WORD_TYPE)
        .all()
    )
    updated = 0
    for q in rows:
        if not any(t.id == src_tag.id for t in (q.tags or [])):
            continue
        tag_ids = [t.id for t in q.tags if t.id != src_tag.id]
        if dst_tag and dst_tag.id not in tag_ids:
            tag_ids.append(dst_tag.id)
        attach_tags(db, q, tag_ids)
        meta = dict(_meta(q.content or {}))
        tags_meta = meta.get("tags") or []
        if isinstance(tags_meta, list):
            meta["tags"] = [dst if t == src else t for t in tags_meta]
        if src in str(meta.get("book") or ""):
            pass
        c = dict(q.content or {})
        c["metadata"] = meta
        q.content = c
        updated += 1

    db.delete(src_tag)
    db.commit()
    return {"updated": updated, "merged": dst, "from": src}


def merge_word_entries(
    db: Session,
    *,
    target_id: int,
    source_id: int,
) -> dict[str, Any]:
    """合并两条单词记录：保留 target，合并标签/释义/错词统计，删除 source。"""
    if target_id == source_id:
        raise ValueError("不能合并同一条记录")
    target = _load_word(db, target_id)
    source = _load_word(db, source_id)

    tc = dict(target.content or {})
    sc = dict(source.content or {})
    tmeta = dict(_meta(tc))
    smeta = dict(_meta(sc))

    if not str(tc.get("meaning") or "").strip() and str(sc.get("meaning") or "").strip():
        tc["meaning"] = sc["meaning"]
        tc["stem"] = sc.get("stem") or sc["meaning"]

    tmeta["wrong_count"] = int(tmeta.get("wrong_count") or 0) + int(smeta.get("wrong_count") or 0)
    for key in ("phonetic", "hint", "source_label"):
        if not str(tmeta.get(key) or tc.get(key) or "").strip():
            v = smeta.get(key) or sc.get(key)
            if v:
                tmeta[key] = v
                if key in ("phonetic", "hint"):
                    tc[key] = v

    tc["metadata"] = tmeta
    target.content = tc
    target.search_text = question_search_blob(tc)

    tag_ids = {t.id for t in (target.tags or [])}
    for t in source.tags or []:
        tag_ids.add(t.id)
    attach_tags(db, target, list(tag_ids))

    from app.models import PracticeProgress, Submission
    from app.services.question_images import remove_all_images

    db.query(Submission).filter(Submission.question_id == source_id).delete()
    db.query(PracticeProgress).filter(PracticeProgress.question_id == source_id).delete()
    remove_all_images(source_id)
    db.delete(source)
    db.commit()
    return word_to_dict(_load_word(db, target_id), db)
