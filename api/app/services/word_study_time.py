"""背词练习时长：本地日志 + 同步 Study 学习数据看板 / 当日日报 smr-study-time。"""

from __future__ import annotations

import json
import re
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import API_ROOT, settings

LOG_PATH = API_ROOT / "data" / "word_study_log.json"
FENCE_WORD = "smr-word-study-time"
FENCE_STUDY = "smr-study-time"


def _study_root() -> Path:
    return Path(settings.study_root).resolve()


def get_word_study_board_file() -> Path:
    return _study_root() / "学习资料" / "学习数据看板" / "背词时长数据.md"


def get_cycle_journal_file(date_str: str | None = None) -> Path:
    d = date_str or _today_ymd()
    return _study_root() / "周期记录" / f"{d}.md"


def _today_ymd() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_log() -> dict[str, Any]:
    if not LOG_PATH.exists():
        return {"sessions": [], "active": None}
    try:
        data = json.loads(LOG_PATH.read_text(encoding="utf-8"))
        data.setdefault("sessions", [])
        return data
    except json.JSONDecodeError:
        return {"sessions": [], "active": None}


def _save_log(data: dict[str, Any]) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    LOG_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _parse_fence(md: str, fence: str) -> dict[str, Any] | None:
    re_f = re.compile(rf"```{re.escape(fence)}\s*\r?\n([\s\S]*?)```", re.M)
    m = re_f.search(md)
    if not m:
        return None
    try:
        return json.loads(m[1].strip())
    except json.JSONDecodeError:
        return None


def _replace_fence(md: str, fence: str, payload: dict[str, Any], header: str) -> str:
    block = f"```{{fence}}\n{{json.dumps(payload, ensure_ascii=False, indent=2)}}\n```"
    block = block.replace("{{fence}}", fence).replace(
        "{{json.dumps(payload, ensure_ascii=False, indent=2)}}",
        json.dumps(payload, ensure_ascii=False, indent=2),
    )
    re_f = re.compile(rf"```{re.escape(fence)}\s*\r?\n[\s\S]*?```", re.M)
    if re_f.search(md):
        return re_f.sub(block, md, count=1)
    return md.rstrip() + "\n\n" + block + "\n"


def aggregate_from_sessions(sessions: list[dict[str, Any]]) -> dict[str, Any]:
    daily_log: dict[str, int] = {}
    blocks: list[dict[str, Any]] = []
    total_sec = 0
    for s in sessions:
        if s.get("ended_at") is None and not s.get("duration_sec"):
            continue
        sec = int(s.get("duration_sec") or 0)
        if sec <= 0:
            continue
        total_sec += sec
        day = str(s.get("date") or _today_ymd())
        daily_log[day] = daily_log.get(day, 0) + max(1, sec // 60)
        blocks.append(
            {
                "date": day,
                "minutes": max(1, sec // 60),
                "seconds": sec,
                "label": s.get("label") or "英语·背词 Drillly",
                "book": s.get("book") or "",
                "unit": s.get("unit") or "",
                "words_done": int(s.get("words_done") or 0),
                "started_at": s.get("started_at"),
                "ended_at": s.get("ended_at"),
            }
        )
    return {
        "dailyLog": daily_log,
        "blocks": blocks,
        "totalSeconds": total_sec,
        "updatedAt": _now_iso(),
    }


def build_board_markdown(data: dict[str, Any]) -> str:
    json_body = json.dumps(data, ensure_ascii=False, indent=2)
    return f"""# 背词时长 · 学习数据看板

本文件由 **Drillly 默写单词** 自动同步。Study Markdown Reader **学习时长看板** 可读取下方 **`{FENCE_WORD}`**；合并进当日日报请在看板内点「写入今日日报」或 API 同步。

- **dailyLog**：自然日 → 当日背词分钟数
- **blocks**：每次练习会话（结束默写模式或离开页面时结算）

```{{fence}}
{{json_body}}
```
""".replace(
        "{fence}", FENCE_WORD
    ).replace("{json_body}", json_body)


def sync_board_file() -> Path:
    log = _load_log()
    data = aggregate_from_sessions(log.get("sessions") or [])
    path = get_word_study_board_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(build_board_markdown(data), encoding="utf-8")
    return path


def merge_into_daily_journal(
    *,
    minutes: int,
    label: str,
    date_str: str | None = None,
) -> dict[str, Any]:
    """合并一条背词块进 周期记录/YYYY-MM-DD.md 的 smr-study-time。"""
    day = date_str or _today_ymd()
    path = get_cycle_journal_file(day)
    if not path.is_file():
        return {"ok": False, "reason": f"日报不存在：{path.name}"}

    text = path.read_text(encoding="utf-8")
    existing = _parse_fence(text, FENCE_STUDY) or {"totalMinutes": 0, "blocks": []}
    blocks = list(existing.get("blocks") or [])
    slot = f"drillly-words-{day}"
    blocks = [b for b in blocks if b.get("slotKey") != slot]
    blocks.append({"slotKey": slot, "minutes": minutes, "label": label})
    total = sum(int(b.get("minutes") or 0) for b in blocks)
    payload = {"totalMinutes": total, "blocks": blocks}
    new_text = _replace_fence(text, FENCE_STUDY, payload, "")
    path.write_text(new_text, encoding="utf-8")
    return {"ok": True, "path": str(path), "totalMinutes": total}


def start_session(*, book: str = "", unit: str = "") -> dict[str, Any]:
    log = _load_log()
    active = log.get("active")
    if active and active.get("started_at"):
        return {"ok": True, "session": active, "resumed": True}
    session = {
        "id": f"s-{int(datetime.now().timestamp() * 1000)}",
        "started_at": _now_iso(),
        "ended_at": None,
        "date": _today_ymd(),
        "book": book.strip(),
        "unit": unit.strip(),
        "duration_sec": 0,
        "words_done": 0,
        "label": _session_label(book, unit),
        "last_tick_at": _now_iso(),
    }
    log["active"] = session
    _save_log(log)
    return {"ok": True, "session": session}


def _session_label(book: str, unit: str) -> str:
    parts = ["英语·背词"]
    if book:
        parts.append(book)
    if unit:
        parts.append(f"Unit{unit}")
    parts.append("Drillly")
    return " ".join(parts)


def tick_session(
    *,
    delta_sec: int = 15,
    book: str = "",
    unit: str = "",
    words_done_delta: int = 0,
) -> dict[str, Any]:
    log = _load_log()
    active = log.get("active")
    if not active:
        start_session(book=book, unit=unit)
        log = _load_log()
        active = log.get("active")
    if not active:
        return {"ok": False, "reason": "无活动会话"}

    if book:
        active["book"] = book.strip()
    if unit:
        active["unit"] = unit.strip()
    active["label"] = _session_label(active.get("book", ""), active.get("unit", ""))
    active["duration_sec"] = int(active.get("duration_sec") or 0) + max(0, delta_sec)
    active["words_done"] = int(active.get("words_done") or 0) + max(0, words_done_delta)
    active["last_tick_at"] = _now_iso()
    log["active"] = active
    _save_log(log)
    sync_board_file()
    return {
        "ok": True,
        "duration_sec": active["duration_sec"],
        "today_minutes": get_today_stats()["today_minutes"],
    }


def end_session(*, sync_journal: bool = False) -> dict[str, Any]:
    log = _load_log()
    active = log.get("active")
    if not active:
        return {"ok": True, "ended": False, "reason": "无活动会话"}

    active = dict(active)
    active["ended_at"] = _now_iso()
    sessions = list(log.get("sessions") or [])
    sessions.append(active)
    log["sessions"] = sessions[-500:]
    log["active"] = None
    _save_log(log)
    sync_board_file()

    result: dict[str, Any] = {
        "ok": True,
        "ended": True,
        "session": active,
        "minutes": max(1, int(active.get("duration_sec") or 0) // 60),
        "board_file": str(get_word_study_board_file()),
    }
    if sync_journal and result["minutes"] > 0:
        result["journal"] = merge_into_daily_journal(
            minutes=result["minutes"],
            label=str(active.get("label") or "英语·背词 Drillly"),
            date_str=str(active.get("date") or _today_ymd()),
        )
    return result


def get_today_stats() -> dict[str, Any]:
    log = _load_log()
    data = aggregate_from_sessions(log.get("sessions") or [])
    active = log.get("active")
    today = _today_ymd()
    today_sec = data["dailyLog"].get(today, 0) * 60
    if active:
        today_sec += int(active.get("duration_sec") or 0)
    return {
        "date": today,
        "today_minutes": max(0, today_sec // 60),
        "today_seconds": today_sec,
        "active": active is not None,
        "active_duration_sec": int(active.get("duration_sec") or 0) if active else 0,
        "board_file": str(get_word_study_board_file()),
        "dailyLog": data.get("dailyLog") or {},
        "recent_blocks": (data.get("blocks") or [])[-10:],
    }


def get_stats(days: int = 14) -> dict[str, Any]:
    log = _load_log()
    data = aggregate_from_sessions(log.get("sessions") or [])
    return {
        "days": days,
        "board_file": str(get_word_study_board_file()),
        **data,
        "active": log.get("active"),
    }
