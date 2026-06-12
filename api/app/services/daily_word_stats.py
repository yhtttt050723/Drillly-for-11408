"""每日背单词 / 默写统计：submissions + 背词时长日志，重启不丢。"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session, joinedload

from app.models import Question, Submission
from app.services.word_dictation_import import WORD_TYPE
from app.services.word_study_time import _load_log, aggregate_from_sessions

CST = timezone(timedelta(hours=8))


def _local_date(dt: datetime | None) -> str:
    if not dt:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(CST).strftime("%Y-%m-%d")


def _word_meta(q: Question) -> dict[str, Any]:
    m = (q.content or {}).get("metadata")
    return m if isinstance(m, dict) else {}


def _unit_label(q: Question) -> str:
    meta = _word_meta(q)
    book = str(meta.get("book") or "").strip()
    unit = str(meta.get("unit") or "").strip()
    if unit:
        if book and book in unit:
            return unit
        if book:
            return f"{book} · {unit}"
        return unit
    return book or "未分单元"


def _submission_correct(sub: Submission) -> bool:
    ans = sub.answer if isinstance(sub.answer, dict) else {}
    mark = ans.get("self_mark")
    if mark == "correct":
        return True
    if mark == "wrong":
        return False
    return bool(sub.is_correct)


def _study_minutes_by_day() -> dict[str, int]:
    log = _load_log()
    data = aggregate_from_sessions(log.get("sessions") or [])
    out: dict[str, int] = {}
    for day, minutes in (data.get("dailyLog") or {}).items():
        out[str(day)] = int(minutes)
    active = log.get("active")
    if active:
        today = datetime.now(CST).strftime("%Y-%m-%d")
        sec = int(active.get("duration_sec") or 0)
        if sec > 0 and str(active.get("date") or today) == today:
            out[today] = out.get(today, 0) + max(1, sec // 60)
    return out


def get_daily_word_stats(db: Session, *, days: int = 14) -> dict[str, Any]:
    days = max(1, min(days, 90))
    today = datetime.now(CST).strftime("%Y-%m-%d")
    since = datetime.now(timezone.utc) - timedelta(days=days)
    study_minutes = _study_minutes_by_day()

    rows = (
        db.query(Submission)
        .join(Question, Submission.question_id == Question.id)
        .options(joinedload(Submission.question))
        .filter(Question.type == WORD_TYPE, Submission.created_at >= since)
        .order_by(Submission.created_at.desc())
        .all()
    )

    by_day: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "date": "",
            "submissions": 0,
            "words": set(),
            "correct": 0,
            "wrong": 0,
            "by_unit": defaultdict(
                lambda: {"submissions": 0, "words": set(), "correct": 0, "wrong": 0}
            ),
        }
    )

    for sub in rows:
        question = sub.question
        if not question:
            continue
        day = _local_date(sub.created_at)
        if not day:
            continue

        ok = _submission_correct(sub)
        unit = _unit_label(question)

        bucket = by_day[day]
        bucket["date"] = day
        bucket["submissions"] += 1
        bucket["words"].add(sub.question_id)
        if ok:
            bucket["correct"] += 1
        else:
            bucket["wrong"] += 1

        ub = bucket["by_unit"][unit]
        ub["submissions"] += 1
        ub["words"].add(sub.question_id)
        if ok:
            ub["correct"] += 1
        else:
            ub["wrong"] += 1

    day_list: list[dict[str, Any]] = []
    all_days = set(by_day.keys()) | set(study_minutes.keys())
    for day in sorted(all_days, reverse=True):
        if day < (datetime.now(CST) - timedelta(days=days)).strftime("%Y-%m-%d"):
            continue
        b = by_day.get(day)
        if b:
            units = []
            for name, ub in sorted(b["by_unit"].items(), key=lambda x: -len(x[1]["words"])):
                units.append(
                    {
                        "unit": name,
                        "submissions": ub["submissions"],
                        "words": len(ub["words"]),
                        "correct": ub["correct"],
                        "wrong": ub["wrong"],
                    }
                )
            day_list.append(
                {
                    "date": day,
                    "submissions": b["submissions"],
                    "words": len(b["words"]),
                    "correct": b["correct"],
                    "wrong": b["wrong"],
                    "study_minutes": study_minutes.get(day, 0),
                    "by_unit": units,
                }
            )
        elif study_minutes.get(day, 0) > 0:
            day_list.append(
                {
                    "date": day,
                    "submissions": 0,
                    "words": 0,
                    "correct": 0,
                    "wrong": 0,
                    "study_minutes": study_minutes.get(day, 0),
                    "by_unit": [],
                }
            )

    today_row = next((d for d in day_list if d["date"] == today), None)
    if not today_row:
        today_row = {
            "date": today,
            "submissions": 0,
            "words": 0,
            "correct": 0,
            "wrong": 0,
            "study_minutes": study_minutes.get(today, 0),
            "by_unit": [],
        }

    return {
        "timezone": "Asia/Shanghai",
        "today": today,
        "days": days,
        "today_stats": today_row,
        "daily": day_list,
        "storage": "sqlite:submissions + word_study_log.json",
    }
