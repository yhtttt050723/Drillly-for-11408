"""每日刷题统计：基于 submissions 表聚合，数据存 SQLite 重启不丢。"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session, joinedload

from app.models import Question, Submission
from app.services.question_query import source_pdf_from_content

CST = timezone(timedelta(hours=8))


def _local_date(dt: datetime | None) -> str:
    if not dt:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(CST).strftime("%Y-%m-%d")


def _source_label(q: Question) -> str:
    pdf = (q.source_pdf or "").strip() or source_pdf_from_content(q.content)
    return pdf or "（未标注来源）"


def get_daily_stats(
    db: Session,
    *,
    days: int = 14,
    source_pdf: str | None = None,
) -> dict[str, Any]:
    days = max(1, min(days, 90))
    today = datetime.now(CST).strftime("%Y-%m-%d")
    since = datetime.now(timezone.utc) - timedelta(days=days)

    q = (
        db.query(Submission)
        .options(joinedload(Submission.question).joinedload(Question.tags))
        .filter(Submission.created_at >= since)
        .order_by(Submission.created_at.desc())
    )
    rows = q.all()

    by_day: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "date": "",
            "submissions": 0,
            "questions": set(),
            "correct": 0,
            "by_source": defaultdict(lambda: {"submissions": 0, "questions": set()}),
        }
    )

    for sub in rows:
        question = sub.question
        if not question:
            continue
        src = _source_label(question)
        if source_pdf and src != source_pdf:
            continue

        day = _local_date(sub.created_at)
        if not day:
            continue

        bucket = by_day[day]
        bucket["date"] = day
        bucket["submissions"] += 1
        bucket["questions"].add(sub.question_id)
        if sub.is_correct:
            bucket["correct"] += 1

        src_bucket = bucket["by_source"][src]
        src_bucket["submissions"] += 1
        src_bucket["questions"].add(sub.question_id)

    day_list: list[dict[str, Any]] = []
    for day in sorted(by_day.keys(), reverse=True):
        b = by_day[day]
        sources = []
        for name, sb in sorted(b["by_source"].items(), key=lambda x: -len(x[1]["questions"])):
            sources.append(
                {
                    "source_pdf": name,
                    "submissions": sb["submissions"],
                    "questions": len(sb["questions"]),
                }
            )
        day_list.append(
            {
                "date": day,
                "submissions": b["submissions"],
                "questions": len(b["questions"]),
                "correct": b["correct"],
                "by_source": sources,
            }
        )

    today_row = next((d for d in day_list if d["date"] == today), None)
    if not today_row:
        today_row = {
            "date": today,
            "submissions": 0,
            "questions": 0,
            "correct": 0,
            "by_source": [],
        }

    return {
        "timezone": "Asia/Shanghai",
        "today": today,
        "days": days,
        "today_stats": today_row,
        "daily": day_list,
        "storage": "sqlite:submissions",
    }
