"""按时段聚合 Drillly 做题本数据（刷题 + 默写 + 背词时长），供日报附挂。"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session, joinedload

from app.models import Question, Submission
from app.services.daily_word_stats import _submission_correct, _unit_label
from app.services.question_query import source_pdf_from_content
from app.services.word_dictation_import import WORD_TYPE
from app.services.word_study_time import _load_log

CST = timezone(timedelta(hours=8))


def parse_cst_datetime(raw: str) -> datetime:
    s = (raw or "").strip().replace(" ", "T")
    if not s:
        raise ValueError("时间不能为空")
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    if "+" not in s[10:] and "-" not in s[11:]:
        s = s + "+08:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=CST)
    return dt.astimezone(CST)


def parse_slot_range(
    slot: str,
    *,
    date: str,
    end_date: str | None = None,
) -> tuple[datetime, datetime]:
    """解析 `HH:MM—HH:MM` 或 `HH:MM-HH:MM`，配合 date / end_date（跨日）。"""
    sep = "—" if "—" in slot else "-"
    parts = [p.strip() for p in slot.split(sep, 1)]
    if len(parts) != 2:
        raise ValueError(f"时段格式应为 HH:MM—HH:MM，收到：{slot}")
    start_h, start_m = [int(x) for x in parts[0].split(":", 1)]
    end_h, end_m = [int(x) for x in parts[1].split(":", 1)]
    end_day = (end_date or date).strip()
    start_dt = parse_cst_datetime(f"{date.strip()}T{start_h:02d}:{start_m:02d}:00")
    end_dt = parse_cst_datetime(f"{end_day}T{end_h:02d}:{end_m:02d}:00")
    if end_dt <= start_dt:
        end_dt += timedelta(days=1)
    return start_dt, end_dt


def _source_label(q: Question) -> str:
    pdf = (q.source_pdf or "").strip() or source_pdf_from_content(q.content or {})
    return pdf or "（未标注来源）"


def _overlap_sec(session_start: datetime, session_end: datetime, win_start: datetime, win_end: datetime) -> int:
    a = max(session_start, win_start)
    b = min(session_end, win_end)
    if b <= a:
        return 0
    return int((b - a).total_seconds())


def _word_study_minutes_in_range(start: datetime, end: datetime) -> int:
    log = _load_log()
    total_sec = 0
    win_start = start.astimezone(timezone.utc)
    win_end = end.astimezone(timezone.utc)

    for s in log.get("sessions") or []:
        started = s.get("started_at")
        ended = s.get("ended_at")
        if not started:
            continue
        try:
            s0 = datetime.fromisoformat(str(started).replace("Z", "+00:00"))
            s1 = (
                datetime.fromisoformat(str(ended).replace("Z", "+00:00"))
                if ended
                else datetime.now(timezone.utc)
            )
        except ValueError:
            continue
        total_sec += _overlap_sec(s0, s1, win_start, win_end)

    active = log.get("active")
    if active and active.get("started_at"):
        try:
            s0 = datetime.fromisoformat(str(active["started_at"]).replace("Z", "+00:00"))
            s1 = datetime.now(timezone.utc)
            total_sec += _overlap_sec(s0, s1, win_start, win_end)
        except ValueError:
            pass

    return max(0, total_sec // 60)


def get_session_stats(
    db: Session,
    *,
    start: datetime,
    end: datetime,
    source_pdf: str | None = None,
) -> dict[str, Any]:
    if end <= start:
        raise ValueError("end 必须晚于 start")

    start_utc = start.astimezone(timezone.utc)
    end_utc = end.astimezone(timezone.utc)

    rows = (
        db.query(Submission)
        .join(Question, Submission.question_id == Question.id)
        .options(joinedload(Submission.question).joinedload(Question.tags))
        .filter(Submission.created_at >= start_utc, Submission.created_at <= end_utc)
        .order_by(Submission.created_at.asc())
        .all()
    )

    practice = {
        "submissions": 0,
        "questions": set(),
        "correct": 0,
        "wrong": 0,
        "by_source": defaultdict(lambda: {"submissions": 0, "questions": set(), "correct": 0, "wrong": 0}),
    }
    words = {
        "submissions": 0,
        "words": set(),
        "correct": 0,
        "wrong": 0,
        "by_unit": defaultdict(lambda: {"submissions": 0, "words": set(), "correct": 0, "wrong": 0}),
    }

    for sub in rows:
        q = sub.question
        if not q:
            continue
        ok = sub.is_correct if q.type != WORD_TYPE else _submission_correct(sub)
        src = _source_label(q)
        if source_pdf and src != source_pdf.strip():
            continue

        if q.type == WORD_TYPE:
            unit = _unit_label(q)
            words["submissions"] += 1
            words["words"].add(sub.question_id)
            if ok:
                words["correct"] += 1
            else:
                words["wrong"] += 1
            ub = words["by_unit"][unit]
            ub["submissions"] += 1
            ub["words"].add(sub.question_id)
            if ok:
                ub["correct"] += 1
            else:
                ub["wrong"] += 1
        else:
            practice["submissions"] += 1
            practice["questions"].add(sub.question_id)
            if ok:
                practice["correct"] += 1
            else:
                practice["wrong"] += 1
            sb = practice["by_source"][src]
            sb["submissions"] += 1
            sb["questions"].add(sub.question_id)
            if ok:
                sb["correct"] += 1
            else:
                sb["wrong"] += 1

    practice_sources = []
    for name, sb in sorted(practice["by_source"].items(), key=lambda x: -len(x[1]["questions"])):
        practice_sources.append(
            {
                "source_pdf": name,
                "submissions": sb["submissions"],
                "questions": len(sb["questions"]),
                "correct": sb["correct"],
                "wrong": sb["wrong"],
            }
        )

    word_units = []
    for name, ub in sorted(words["by_unit"].items(), key=lambda x: -len(x[1]["words"])):
        word_units.append(
            {
                "unit": name,
                "submissions": ub["submissions"],
                "words": len(ub["words"]),
                "correct": ub["correct"],
                "wrong": ub["wrong"],
            }
        )

    study_min = _word_study_minutes_in_range(start, end)

    return {
        "timezone": "Asia/Shanghai",
        "start": start.strftime("%Y-%m-%d %H:%M"),
        "end": end.strftime("%Y-%m-%d %H:%M"),
        "source_pdf": source_pdf or "",
        "practice": {
            "submissions": practice["submissions"],
            "questions": len(practice["questions"]),
            "correct": practice["correct"],
            "wrong": practice["wrong"],
            "by_source": practice_sources,
        },
        "words": {
            "submissions": words["submissions"],
            "words": len(words["words"]),
            "correct": words["correct"],
            "wrong": words["wrong"],
            "study_minutes": study_min,
            "by_unit": word_units,
        },
        "storage": "sqlite:submissions + word_study_log.json",
    }


def format_stats_markdown(stats: dict[str, Any], *, slot_label: str = "") -> str:
    """生成可粘贴进日报段落的 Markdown 片段。"""
    p = stats["practice"]
    w = stats["words"]
    lines = [
        f"> **Drillly 做题本**（{slot_label or stats['start'] + '—' + stats['end']} · SQLite）",
    ]
    if p["submissions"] > 0:
        lines.append(
            f"> - **刷题**：**{p['questions']}** 题 · **{p['submissions']}** 次 · 对/错 **{p['correct']}/{p['wrong']}**"
        )
        for s in p["by_source"][:5]:
            short = s["source_pdf"].replace(".pdf", "").replace("做题本", "")
            lines.append(
                f">   - `{short}`：**{s['questions']}** 题 · **{s['submissions']}** 次 · **{s['correct']}/{s['wrong']}**"
            )
    if w["submissions"] > 0 or w["study_minutes"] > 0:
        parts = []
        if w["submissions"] > 0:
            parts.append(f"默写 **{w['words']}** 词 · **{w['submissions']}** 次 · **{w['correct']}/{w['wrong']}**")
        if w["study_minutes"] > 0:
            parts.append(f"背词 **{w['study_minutes']}** min")
        lines.append(f"> - **单词**：{' · '.join(parts)}")
        for u in w["by_unit"][:3]:
            lines.append(
                f">   - `{u['unit']}`：**{u['words']}** 词 · **{u['submissions']}** 次 · **{u['correct']}/{u['wrong']}**"
            )
    if p["submissions"] == 0 and w["submissions"] == 0 and w["study_minutes"] == 0:
        lines.append("> - （该时段无 Drillly 提交记录）")
    return "\n".join(lines)
