"""Track inbox PDFs already imported to avoid duplicate runs."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import API_ROOT

LEDGER_PATH = API_ROOT / "data" / "inbox_imported.json"


def _load() -> dict[str, Any]:
    if not LEDGER_PATH.exists():
        return {"records": {}}
    try:
        data = json.loads(LEDGER_PATH.read_text(encoding="utf-8"))
        if "records" not in data:
            data["records"] = {}
        return data
    except json.JSONDecodeError:
        return {"records": {}}


def _save(data: dict[str, Any]) -> None:
    LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
    LEDGER_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def file_fingerprint(pdf_path: Path) -> str:
    """Stable id: sha256 of file bytes (same content => same id)."""
    h = hashlib.sha256()
    with open(pdf_path, "rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def is_imported(pdf_path: Path) -> bool:
    if not pdf_path.is_file():
        return False
    fp = file_fingerprint(pdf_path)
    rec = _load()["records"].get(fp)
    return rec is not None


def get_import_record(pdf_path: Path) -> dict[str, Any] | None:
    fp = file_fingerprint(pdf_path)
    return _load()["records"].get(fp)


def mark_imported(
    pdf_path: Path,
    *,
    task_id: int,
    question_count: int,
    pdf_tag: str | None = None,
) -> None:
    data = _load()
    fp = file_fingerprint(pdf_path)
    data["records"][fp] = {
        "fingerprint": fp,
        "filename": pdf_path.name,
        "path": str(pdf_path.resolve()),
        "size": pdf_path.stat().st_size,
        "task_id": task_id,
        "question_count": question_count,
        "pdf_tag": pdf_tag,
        "imported_at": datetime.now(timezone.utc).isoformat(),
    }
    _save(data)


def should_move_after_import() -> bool:
    from app.services.settings_store import _load_raw

    raw = _load_raw()
    return bool(raw.get("pdf_inbox_move_after_import", False))
