"""今日/近期做错题目看板：按提交记录聚合，带标签与出处。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session, joinedload

from app.models import Question, Submission
from app.services.question_query import source_pdf_from_content
from app.services.tag_hierarchy import question_matches_tag_filter
from app.services.word_dictation_import import WORD_TYPE

CST = timezone(timedelta(hours=8))
SKIP_TYPES = {WORD_TYPE}


def _stem_preview(content: dict | None) -> str:
    if not content:
        return ""
    title = str(content.get("title") or "").strip()
    stem = str(content.get("stem") or "").strip()
    text = title or stem
    if len(text) > 140:
        return text[:140] + "…"
    return text


def _tag_filter_name(tags: str | None) -> str | None:
    if not tags or not tags.strip():
        return None
    return tags.strip()


def _matches_filters(q: Question, source_pdf: str | None, tag_filter: str | None) -> bool:
    if source_pdf and source_pdf.strip():
        if source_pdf_from_content(q.content or {}) != source_pdf.strip():
            return False
    if tag_filter:
        names = {t.name for t in (q.tags or [])}
        if not question_matches_tag_filter(names, tag_filter):
            return False
    return True


def get_wrong_board(
    db: Session,
    *,
    days: int = 1,
    source_pdf: str | None = None,
    tags: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> dict[str, Any]:
    days = max(1, min(days, 30))
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    today = datetime.now(CST).strftime("%Y-%m-%d")
    start_cst = (datetime.now(CST) - timedelta(days=days - 1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    since = start_cst.astimezone(timezone.utc)
    tag_filter = _tag_filter_name(tags)

    subs = (
        db.query(Submission)
        .join(Question, Submission.question_id == Question.id)
        .options(joinedload(Submission.question).joinedload(Question.tags))
        .filter(
            Submission.is_correct.is_(False),
            Question.type.notin_(list(SKIP_TYPES)),
            Submission.created_at >= since,
        )
        .order_by(Submission.created_at.desc())
        .all()
    )

    buckets: dict[int, dict[str, Any]] = {}
    for sub in subs:
        q = sub.question
        if not q:
            continue
        if not _matches_filters(q, source_pdf, tag_filter):
            continue
        if q.id in buckets:
            buckets[q.id]["wrong_count"] += 1
            continue
        content = q.content or {}
        meta = content.get("metadata") if isinstance(content.get("metadata"), dict) else {}
        ans = sub.answer if isinstance(sub.answer, dict) else {}
        got = ans.get("value") or ans.get("self_mark") or ""
        buckets[q.id] = {
            "question_id": q.id,
            "type": q.type,
            "title": str(content.get("title") or f"#{q.id}").strip(),
            "stem_preview": _stem_preview(content),
            "source_pdf": source_pdf_from_content(content),
            "chapter": str(meta.get("chapter") or "").strip(),
            "tags": [{"id": t.id, "name": t.name, "color": t.color} for t in (q.tags or [])],
            "wrong_count": 1,
            "last_wrong_at": sub.created_at.isoformat() if sub.created_at else "",
            "last_answer": str(got) if got else "",
        }

    items = sorted(
        buckets.values(),
        key=lambda x: x.get("last_wrong_at") or "",
        reverse=True,
    )
    total = len(items)
    page = items[offset : offset + limit]

    return {
        "timezone": "Asia/Shanghai",
        "today": today,
        "days": days,
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": page,
    }
