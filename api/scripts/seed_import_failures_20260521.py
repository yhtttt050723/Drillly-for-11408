"""Seed pending retry list from 2026-05-21 import session log (run once)."""
from __future__ import annotations

import re
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

from app.config import settings
from app.services.import_batch_failures import _load, _save

CHUNKS = settings.media_dir / "imports" / "chunks"

SESSION = [
    {
        "file": "操作系统做题本.pdf",
        "total_pages": 71,
        "batch_total": 24,
        "pages_per_batch": 3,
        "imported": 345,
        "failed_batches": [3, 7, 10, 14, 16, 17, 19, 22, 23, 24],
        "errors": {},
    },
    {
        "file": "数据结构做题本.pdf",
        "total_pages": 71,
        "batch_total": 24,
        "pages_per_batch": 3,
        "imported": 131,
        "failed_batches": [3, 4, 6, 8, 9, 10, 11, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23],
        "errors": {
            16: "Expecting ',' delimiter: line 255 column 10 (char 7207)",
            17: "Invalid \\escape: line 399 column 37 (char 9241)",
            19: "Expecting ',' delimiter: line 354 column 10 (char 11656)",
        },
    },
    {
        "file": "计算机组成做题本.pdf",
        "total_pages": 70,
        "batch_total": 24,
        "pages_per_batch": 3,
        "imported": None,
        "failed_batches": [3],
        "errors": {},
        "note": "导入日志截断，仅记录第 3 批失败；跑完后用 API 自动补全",
    },
]


def page_range(batch_index: int, pages_per_batch: int, total_pages: int) -> tuple[int, int]:
    start = (batch_index - 1) * pages_per_batch + 1
    end = min(batch_index * pages_per_batch, total_pages)
    return start, end


def find_chunk_dir(filename: str) -> Path | None:
    stem = Path(filename).stem
    dirs = sorted(
        [d for d in CHUNKS.iterdir() if d.is_dir() and stem in d.name],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return dirs[0] if dirs else None


def find_chunk_file(chunk_dir: Path, page_start: int, page_end: int) -> Path | None:
    for p in chunk_dir.glob(f"*_p{page_start}-{page_end}.pdf"):
        return p
    return None


def main() -> None:
    pending: list[dict] = []
    for spec in SESSION:
        chunk_dir = find_chunk_dir(spec["file"])
        if not chunk_dir:
            print(f"WARN no chunk dir: {spec['file']}")
            continue
        for bi in spec["failed_batches"]:
            ps, pe = page_range(bi, spec["pages_per_batch"], spec["total_pages"])
            chunk = find_chunk_file(chunk_dir, ps, pe)
            pending.append(
                {
                    "file": spec["file"],
                    "batch_index": bi,
                    "batch_total": spec["batch_total"],
                    "page_start": ps,
                    "page_end": pe,
                    "chunk_path": str(chunk) if chunk else "",
                    "task_id": None,
                    "source_path": "",
                    "provider": "tongyi",
                    "model": None,
                    "tags": [],
                    "pages_per_batch": spec["pages_per_batch"],
                    "error": spec["errors"].get(bi, "（导入时失败，错误文本为空：多为超时/限流）"),
                    "status": "pending",
                    "source": "seed_20260521",
                    "session_imported": spec.get("imported"),
                }
            )
    data = _load()
    data["pending"] = pending
    _save(data)
    print(f"Seeded {len(pending)} pending batches -> {_load().get('pending', [])[:1]}...")


if __name__ == "__main__":
    main()
