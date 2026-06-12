"""Question list filters: PDF source, tags, practice round, random order."""

from __future__ import annotations

import random
from typing import Any

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, joinedload

from app.models import PracticeProgress, Question, Submission, Tag
from app.services.tag_hierarchy import is_group_name, question_matches_tag_filter


def source_pdf_from_content(content: dict) -> str:
    meta = content.get("metadata") or {}
    return str(meta.get("source_pdf") or "").strip()


def question_search_blob(content: dict | None) -> str:
    """可搜索正文：题干、选项、章节、来源等（小写便于匹配）。"""
    if not content:
        return ""
    parts: list[str] = []
    imgs = content.get("images")
    if isinstance(imgs, list):
        for u in imgs:
            if isinstance(u, str) and u.strip():
                parts.append(u)
    for key in ("title", "stem", "explanation", "word", "meaning", "phonetic"):
        v = content.get(key)
        if isinstance(v, str) and v.strip():
            parts.append(v)
    meta = content.get("metadata")
    if isinstance(meta, dict):
        for key in ("chapter", "source_pdf", "source_path"):
            v = meta.get(key)
            if isinstance(v, str) and v.strip():
                parts.append(v)
    opts = content.get("options")
    if isinstance(opts, list):
        for o in opts:
            if isinstance(o, dict):
                for key in ("key", "content"):
                    v = o.get(key)
                    if isinstance(v, str) and v.strip():
                        parts.append(v)
    return "\n".join(parts).lower()


def question_matches_search(content: dict, query: str) -> bool:
    q = (query or "").strip().lower()
    if not q:
        return True
    return q in question_search_blob(content)


def _apply_tag_filters(q, tags: str):
    names = [t.strip() for t in (tags or "").split(",") if t.strip()]
    if not names:
        return q
    clauses = []
    for name in names:
        if is_group_name(name):
            clauses.append(
                Question.tags.any(
                    or_(Tag.name == name, Tag.name.startswith(f"{name}/"))
                )
            )
        else:
            clauses.append(Question.tags.any(Tag.name == name))
    return q.filter(or_(*clauses))


def _apply_self_mark_filter(db: Session, q, self_mark_status: str | None):
    """按最近一次自评结果筛选（wrong_review 刷错题）。"""
    if self_mark_status not in ("correct", "wrong", "unmarked"):
        return q
    from sqlalchemy.orm import aliased
    from sqlalchemy import func

    subq = (
        db.query(
            Submission.question_id,
            func.max(Submission.id).label("max_id"),
        )
        .group_by(Submission.question_id)
        .subquery()
    )
    latest_sub = aliased(Submission)
    q = q.outerjoin(subq, Question.id == subq.c.question_id).outerjoin(
        latest_sub,
        latest_sub.id == subq.c.max_id,
    )
    if self_mark_status == "unmarked":
        return q.filter(latest_sub.id.is_(None))
    want_ok = self_mark_status == "correct"
    return q.filter(latest_sub.is_correct.is_(want_ok))


def _apply_practice_filter(q, practice_round: int | None, round_status: str | None):
    if practice_round not in (1, 2) or round_status not in ("pending", "done"):
        return q
    join_cond = and_(
        Question.id == PracticeProgress.question_id,
        PracticeProgress.round == practice_round,
    )
    if round_status == "done":
        return q.join(PracticeProgress, join_cond).filter(PracticeProgress.done.is_(True))
    return q.outerjoin(PracticeProgress, join_cond).filter(
        or_(PracticeProgress.id.is_(None), PracticeProgress.done.is_(False))
    )


def list_pdf_sources(db: Session) -> list[dict[str, Any]]:
    rows = (
        db.query(Question.source_pdf, func.count(Question.id).label("cnt"))
        .filter(Question.source_pdf != "")
        .group_by(Question.source_pdf)
        .order_by(func.count(Question.id).desc(), Question.source_pdf)
        .all()
    )
    return [
        {"source_pdf": name, "question_count": int(n)}
        for name, n in rows
        if name
    ]


def _practice_questions_query(
    db: Session,
    *,
    tags: str | None = None,
    category: str | None = None,
    q_type: str | None = None,
    source_pdf: str | None = None,
    search: str | None = None,
    practice_round: int | None = None,
    round_status: str | None = None,
    self_mark_status: str | None = None,
):
    q = db.query(Question).options(
        joinedload(Question.tags),
        joinedload(Question.category),
    )
    if q_type:
        q = q.filter(Question.type == q_type)
    if category:
        if category.isdigit():
            q = q.filter(Question.category_id == int(category))
        else:
            from app.models import Category

            q = q.join(Category).filter(Category.name == category)

    if source_pdf:
        q = q.filter(Question.source_pdf == source_pdf)

    term = (search or "").strip().lower()
    if term:
        q = q.filter(Question.search_text.contains(term))

    q = _apply_tag_filters(q, tags)
    q = _apply_practice_filter(q, practice_round, round_status)
    q = _apply_self_mark_filter(db, q, self_mark_status)
    return q.distinct()


def count_questions(
    db: Session,
    *,
    tags: str | None = None,
    category: str | None = None,
    q_type: str | None = None,
    source_pdf: str | None = None,
    search: str | None = None,
    practice_round: int | None = None,
    round_status: str | None = None,
    self_mark_status: str | None = None,
) -> int:
    q = _practice_questions_query(
        db,
        tags=tags,
        category=category,
        q_type=q_type,
        source_pdf=source_pdf,
        search=search,
        practice_round=practice_round,
        round_status=round_status,
        self_mark_status=self_mark_status,
    )
    return int(q.with_entities(func.count(Question.id.distinct())).scalar() or 0)


def load_questions(
    db: Session,
    *,
    tags: str | None = None,
    category: str | None = None,
    q_type: str | None = None,
    source_pdf: str | None = None,
    search: str | None = None,
    practice_round: int | None = None,
    round_status: str | None = None,
    self_mark_status: str | None = None,
    order: str = "id",
    limit: int = 50,
    offset: int = 0,
) -> list[Question]:
    q = _practice_questions_query(
        db,
        tags=tags,
        category=category,
        q_type=q_type,
        source_pdf=source_pdf,
        search=search,
        practice_round=practice_round,
        round_status=round_status,
        self_mark_status=self_mark_status,
    )
    if order == "random":
        q = q.order_by(func.random())
    else:
        q = q.order_by(Question.id)

    return q.offset(offset).limit(limit).all()


def progress_map(db: Session, question_ids: list[int]) -> dict[int, dict[str, bool]]:
    if not question_ids:
        return {}
    rows = (
        db.query(PracticeProgress)
        .filter(PracticeProgress.question_id.in_(question_ids))
        .all()
    )
    out: dict[int, dict[str, bool]] = {
        qid: {"round1": False, "round2": False} for qid in question_ids
    }
    for p in rows:
        if p.question_id not in out:
            out[p.question_id] = {"round1": False, "round2": False}
        if p.round == 1:
            out[p.question_id]["round1"] = p.done
        elif p.round == 2:
            out[p.question_id]["round2"] = p.done
    return out


def progress_summary(
    db: Session,
    *,
    source_pdf: str | None = None,
) -> dict[str, Any]:
    base = db.query(Question)
    if source_pdf:
        base = base.filter(Question.source_pdf == source_pdf)
    total = base.count()
    if not total:
        return {"total": 0, "round1_done": 0, "round2_done": 0}

    def _count_round(rnd: int) -> int:
        q = (
            db.query(func.count(func.distinct(PracticeProgress.question_id)))
            .join(Question, Question.id == PracticeProgress.question_id)
            .filter(PracticeProgress.round == rnd, PracticeProgress.done.is_(True))
        )
        if source_pdf:
            q = q.filter(Question.source_pdf == source_pdf)
        return int(q.scalar() or 0)

    return {
        "total": total,
        "round1_done": _count_round(1),
        "round2_done": _count_round(2),
    }
