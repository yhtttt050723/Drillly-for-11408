"""Seed/refresh pending retry list from import session logs. Run: python scripts/seed_import_failures.py"""
from __future__ import annotations

import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

from app.config import settings
from app.services.import_batch_failures import _export_study_markdown, _load, _save

CHUNKS = settings.media_dir / "imports" / "chunks"

# 第 1 批多为封面，不列入失败重导
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
        "imported": 158,
        "failed_batches": [3, 6, 7, 8, 9, 10, 11, 12, 13, 15, 17, 18, 20, 21, 22, 23],
        "errors": {
            7: "Expecting ',' delimiter: line 24 column 10 (char 701)",
        },
    },
    {
        "file": "计算机网络做题本.pdf",
        "total_pages": 66,
        "batch_total": 22,
        "pages_per_batch": 3,
        "imported": None,
        "failed_batches": [2, 3, 4, 6, 7, 8, 12, 13, 16, 18, 19],
        "errors": {
            8: "Unterminated string starting at: line 390 column 22 (char 12324)",
        },
        "note": "日志在 19/22 批截断；无 chunk 时需先「仅导入」生成分片",
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
    return p


def lookup_task_id(filename: str) -> int | None:
    try:
        from app.database import SessionLocal
        from app.models import PdfImportTask

        db = SessionLocal()
        try:
            t = (
                db.query(PdfImportTask)
                .filter(PdfImportTask.original_name == filename)
                .order_by(PdfImportTask.id.desc())
                .first()
            )
            return t.id if t else None
        finally:
            db.close()
    except Exception:
        return None


def build_pending() -> list[dict]:
    pending: list[dict] = []
    for spec in SESSION:
        chunk_dir = find_chunk_dir(spec["file"])
        task_id = lookup_task_id(spec["file"])
        for bi in spec["failed_batches"]:
            ps, pe = page_range(bi, spec["pages_per_batch"], spec["total_pages"])
            chunk = find_chunk_file(chunk_dir, ps, pe) if chunk_dir else None
            pending.append(
                {
                    "file": spec["file"],
                    "batch_index": bi,
                    "batch_total": spec["batch_total"],
                    "page_start": ps,
                    "page_end": pe,
                    "chunk_path": str(chunk) if chunk else "",
                    "task_id": task_id,
                    "source_path": "",
                    "provider": "tongyi",
                    "model": None,
                    "tags": [],
                    "pages_per_batch": spec["pages_per_batch"],
                    "error": spec["errors"].get(
                        bi, "（导入时失败，错误文本为空：多为超时/限流）"
                    ),
                    "status": "pending",
                    "source": "seed_session_log",
                    "session_imported": spec.get("imported"),
                }
            )
    return pending


def main() -> None:
    pending = build_pending()
    data = _load()
    # 保留 API 实时记录的条目（有 chunk_path 且非 seed）
    api_rows = [
        p
        for p in (data.get("pending") or [])
        if p.get("source") != "seed_session_log" and p.get("chunk_path")
    ]
    merged: dict[tuple[str, int], dict] = {}
    for p in pending + api_rows:
        merged[(p["file"], p["batch_index"])] = p
    data["pending"] = sorted(
        merged.values(), key=lambda x: (x.get("file", ""), x.get("batch_index", 0))
    )
    _save(data)
    _export_study_markdown(data)
    with_chunk = sum(1 for p in data["pending"] if p.get("chunk_path"))
    print(f"Pending {len(data['pending'])} batches ({with_chunk} with chunk files)")


if __name__ == "__main__":
    main()
