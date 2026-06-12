"""默写单词错词记录：提交时打标、统计、筛选。"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session, aliased

from app.models import Question, Submission, Tag
from app.services.tag_hierarchy import (
    WORD_DICTATION_PARENT,
    child_full_name,
    get_or_create_child_tag,
    get_or_create_group_tag,
)
from app.services.word_dictation_import import WORD_TYPE


def _meta(content: dict) -> dict:
    m = content.get("metadata")
    return m if isinstance(m, dict) else {}

WRONG_CHILD_TAG = "错词"


def _word_meta(q: Question) -> dict[str, Any]:
    return dict(_meta(q.content or {}))


def _save_meta(q: Question, meta: dict[str, Any]) -> None:
    c = dict(q.content or {})
    c["metadata"] = meta
    q.content = c


def ensure_wrong_tag(db: Session, q: Question) -> None:
    get_or_create_group_tag(db, WORD_DICTATION_PARENT)
    wrong = get_or_create_child_tag(db, WORD_DICTATION_PARENT, WRONG_CHILD_TAG)
    if not wrong:
        return
    ids = {t.id for t in (q.tags or [])}
    if wrong.id not in ids:
        q.tags = list(q.tags or []) + [wrong]


def remove_wrong_tag(db: Session, q: Question) -> None:
    full = child_full_name(WORD_DICTATION_PARENT, WRONG_CHILD_TAG)
    q.tags = [t for t in (q.tags or []) if t.name != full]


def record_word_wrong(db: Session, q: Question) -> None:
    meta = _word_meta(q)
    meta["wrong_count"] = int(meta.get("wrong_count") or 0) + 1
    meta["last_wrong_at"] = datetime.now(timezone.utc).isoformat()
    _save_meta(q, meta)
    ensure_wrong_tag(db, q)


def record_word_correct(db: Session, q: Question, *, clear_wrong_tag: bool = False) -> None:
    meta = _word_meta(q)
    meta["last_correct_at"] = datetime.now(timezone.utc).isoformat()
    _save_meta(q, meta)
    if clear_wrong_tag:
        remove_wrong_tag(db, q)


def handle_word_submission(
    db: Session,
    q: Question,
    answer: dict,
    *,
    is_correct: bool,
) -> None:
    mark = answer.get("self_mark")
    if mark == "wrong" or (not mark and not is_correct):
        record_word_wrong(db, q)
    elif mark == "correct" or (not mark and is_correct):
        record_word_correct(db, q)


def latest_submission_map(db: Session, question_ids: list[int]) -> dict[int, Submission]:
    if not question_ids:
        return {}
    subq = (
        db.query(
            Submission.question_id,
            func.max(Submission.id).label("max_id"),
        )
        .filter(Submission.question_id.in_(question_ids))
        .group_by(Submission.question_id)
        .subquery()
    )
    latest_sub = aliased(Submission)
    rows = (
        db.query(latest_sub)
        .join(subq, latest_sub.id == subq.c.max_id)
        .all()
    )
    return {r.question_id: r for r in rows}


def word_wrong_stats(db: Session) -> dict[str, Any]:
    rows = db.query(Question).filter(Question.type == WORD_TYPE).all()
    ids = [r.id for r in rows]
    latest = latest_submission_map(db, ids)
    wrong_full = child_full_name(WORD_DICTATION_PARENT, WRONG_CHILD_TAG)
    by_tag = 0
    by_last = 0
    for q in rows:
        if any(t.name == wrong_full for t in (q.tags or [])):
            by_tag += 1
        sub = latest.get(q.id)
        if sub and not sub.is_correct:
            by_last += 1
    return {
        "total_words": len(rows),
        "tagged_wrong": by_tag,
        "last_mark_wrong": by_last,
    }


def filter_words_by_wrong(
    rows: list[Question],
    db: Session,
    *,
    mode: str,
) -> list[Question]:
    """mode: wrong | correct | unmarked"""
    if mode not in ("wrong", "correct", "unmarked"):
        return rows
    latest = latest_submission_map(db, [r.id for r in rows])
    out: list[Question] = []
    for q in rows:
        sub = latest.get(q.id)
        if mode == "unmarked":
            if sub is None:
                out.append(q)
        elif mode == "wrong":
            if sub is not None and not sub.is_correct:
                out.append(q)
        elif mode == "correct":
            if sub is not None and sub.is_correct:
                out.append(q)
    return out


def word_practice_hint(q: Question, db: Session) -> dict[str, Any]:
    meta = _word_meta(q)
    sub = latest_submission_map(db, [q.id]).get(q.id)
    last_mark = None
    if sub:
        ans = sub.answer or {}
        if ans.get("self_mark") in ("correct", "wrong"):
            last_mark = ans["self_mark"]
        else:
            last_mark = "correct" if sub.is_correct else "wrong"
    return {
        "wrong_count": int(meta.get("wrong_count") or 0),
        "last_wrong_at": meta.get("last_wrong_at") or "",
        "last_mark": last_mark,
        "has_wrong_tag": any(
            t.name == child_full_name(WORD_DICTATION_PARENT, WRONG_CHILD_TAG)
            for t in (q.tags or [])
        ),
    }
