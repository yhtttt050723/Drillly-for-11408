"""Persist inbox import job state for UI restore after refresh."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import API_ROOT

JOB_PATH = API_ROOT / "data" / "import_job_state.json"


def _load() -> dict[str, Any]:
    if not JOB_PATH.exists():
        return {"active": False, "logs": [], "progress": {}}
    try:
        return json.loads(JOB_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"active": False, "logs": [], "progress": {}}


def _save(data: dict[str, Any]) -> None:
    JOB_PATH.parent.mkdir(parents=True, exist_ok=True)
    JOB_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def get_job_state() -> dict[str, Any]:
    return _load()


def start_job(*, file_total: int, pending_files: int) -> None:
    _save(
        {
            "active": True,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "file_total": file_total,
            "pending_files": pending_files,
            "progress": {
                "percent": 0,
                "file_index": 0,
                "file_name": "",
                "batch_index": 0,
                "batch_total": 0,
            },
            "logs": [],
        }
    )


def append_log(line: str, *, max_lines: int = 300) -> None:
    data = _load()
    logs: list[str] = list(data.get("logs") or [])
    logs.append(line)
    if len(logs) > max_lines:
        logs = logs[-max_lines:]
    data["logs"] = logs
    data["active"] = True
    _save(data)


def update_progress(**fields: Any) -> None:
    data = _load()
    prog = dict(data.get("progress") or {})
    prog.update({k: v for k, v in fields.items() if v is not None})
    data["progress"] = prog
    data["active"] = True
    _save(data)


def finish_job(*, summary: dict[str, Any] | None = None) -> None:
    data = _load()
    data["active"] = False
    data["finished_at"] = datetime.now(timezone.utc).isoformat()
    if summary:
        data["summary"] = summary
    if data.get("progress"):
        data["progress"]["percent"] = 100
    _save(data)


def clear_job() -> None:
    if JOB_PATH.exists():
        JOB_PATH.unlink()
