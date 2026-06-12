"""英文词汇 PDF 收件箱：已导入记录，避免重复跑 AI。"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import API_ROOT

LEDGER_PATH = API_ROOT / "data" / "english_vocab_inbox_imported.json"


def _load() -> dict[str, Any]:
    if not LEDGER_PATH.exists():
        return {"records": {}}
    try:
        data = json.loads(LEDGER_PATH.read_text(encoding="utf-8"))
        data.setdefault("records", {})
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
    h = hashlib.sha256()
    with open(pdf_path, "rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def is_imported(pdf_path: Path) -> bool:
    if not pdf_path.is_file():
        return False
    return file_fingerprint(pdf_path) in _load()["records"]


def get_import_record(pdf_path: Path) -> dict[str, Any] | None:
    return _load()["records"].get(file_fingerprint(pdf_path))


def mark_imported(
    pdf_path: Path,
    *,
    word_count: int,
    created: int,
    skipped: int,
    book: str = "",
    unit: str = "",
) -> None:
    data = _load()
    fp = file_fingerprint(pdf_path)
    data["records"][fp] = {
        "fingerprint": fp,
        "filename": pdf_path.name,
        "path": str(pdf_path.resolve()),
        "word_count": word_count,
        "created": created,
        "skipped": skipped,
        "book": book,
        "unit": unit,
        "imported_at": datetime.now(timezone.utc).isoformat(),
    }
    _save(data)


def clear_all_records() -> int:
    data = _load()
    n = len(data.get("records") or {})
    data["records"] = {}
    _save(data)
    return n


def clear_record(pdf_path: Path) -> bool:
    data = _load()
    fp = file_fingerprint(pdf_path)
    if fp not in data["records"]:
        return False
    del data["records"][fp]
    _save(data)
    return True
