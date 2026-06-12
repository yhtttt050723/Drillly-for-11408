"""Persist PDF import batch failures for retry and Study-side logs."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import API_ROOT, settings

_DATA_PATH = API_ROOT / "data" / "import_batch_failures.json"


def _study_failures_dir() -> Path:
    d = Path(settings.study_root) / "学习资料" / "做题" / "PDF导入失败批次"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _load() -> dict[str, Any]:
    if not _DATA_PATH.exists():
        return {"sessions": [], "pending": []}
    try:
        return json.loads(_DATA_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"sessions": [], "pending": []}


def _save(data: dict[str, Any]) -> None:
    _DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    _DATA_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    _export_study_markdown(data)


def _format_error(exc: BaseException) -> str:
    msg = str(exc).strip()
    if msg:
        return msg[:2000]
    return f"{type(exc).__name__}: {exc!r}"[:2000]


def record_batch_failure(
    *,
    file: str,
    batch_index: int,
    batch_total: int,
    page_start: int,
    page_end: int,
    chunk_path: str,
    task_id: int | None,
    source_path: str,
    provider: str,
    model: str | None,
    tags: list[str],
    exc: BaseException,
    pages_per_batch: int,
) -> None:
    data = _load()
    pending: list[dict[str, Any]] = list(data.get("pending") or [])
    err = _format_error(exc)
    entry = {
        "file": file,
        "batch_index": batch_index,
        "batch_total": batch_total,
        "page_start": page_start,
        "page_end": page_end,
        "chunk_path": chunk_path,
        "task_id": task_id,
        "source_path": source_path,
        "provider": provider,
        "model": model,
        "tags": tags,
        "pages_per_batch": pages_per_batch,
        "error": err,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "status": "pending",
    }
    pending = [
        p
        for p in pending
        if not (p.get("file") == file and p.get("batch_index") == batch_index)
    ]
    pending.append(entry)
    data["pending"] = pending
    _save(data)


def mark_batch_resolved(file: str, batch_index: int) -> None:
    data = _load()
    pending = [
        p
        for p in (data.get("pending") or [])
        if not (p.get("file") == file and p.get("batch_index") == batch_index)
    ]
    data["pending"] = pending
    _save(data)


def list_pending_for_file(filename: str) -> list[dict[str, Any]]:
    data = _load()
    return sorted(
        [p for p in (data.get("pending") or []) if p.get("file") == filename],
        key=lambda x: x.get("batch_index", 0),
    )


def list_all_pending() -> list[dict[str, Any]]:
    data = _load()
    return sorted(
        data.get("pending") or [],
        key=lambda x: (x.get("file", ""), x.get("batch_index", 0)),
    )


def count_pending_by_file() -> dict[str, int]:
    out: dict[str, int] = {}
    for p in list_all_pending():
        name = p.get("file") or ""
        out[name] = out.get(name, 0) + 1
    return out


def append_session_summary(summary: dict[str, Any]) -> None:
    data = _load()
    sessions: list[dict[str, Any]] = list(data.get("sessions") or [])
    summary = {**summary, "recorded_at": datetime.now(timezone.utc).isoformat()}
    sessions.append(summary)
    if len(sessions) > 50:
        sessions = sessions[-50:]
    data["sessions"] = sessions
    _save(data)


def seed_pending_from_user_log(entries: list[dict[str, Any]]) -> None:
    """Merge manual failure rows (no chunk_path) for planning retries."""
    data = _load()
    pending: list[dict[str, Any]] = list(data.get("pending") or [])
    for e in entries:
        key = (e.get("file"), e.get("batch_index"))
        if any((p.get("file"), p.get("batch_index")) == key for p in pending):
            continue
        pending.append({**e, "status": "pending", "source": "manual_log"})
    data["pending"] = pending
    _save(data)


def _export_study_markdown(data: dict[str, Any]) -> None:
    out_dir = _study_failures_dir()
    md_path = out_dir / "导入失败批次-待重导.md"
    json_path = out_dir / "导入失败批次-待重导.json"
    pending = data.get("pending") or []
    json_path.write_text(
        json.dumps({"pending": pending, "updated_at": datetime.now(timezone.utc).isoformat()}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    lines = [
        "# PDF 导入 · 失败批次待重导",
        "",
        f"> 更新：**{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}**（本机）",
        f"> 待重导 **{len(pending)}** 批 · API 数据：`drillly/api/data/import_batch_failures.json`",
        "",
        "**操作**：Drillly 导入页 → 对单文件 **「重导失败批」**；或先 **清除** 该 PDF 记录后整本重导（会删已入库题）。",
        "",
        "| PDF | 批 | 页码 | 错误摘要 | chunk 可用 |",
        "|:---|:---:|:---|:---|:---:|",
    ]
    for p in pending:
        chunk = p.get("chunk_path") or ""
        ok = "✅" if chunk and Path(chunk).is_file() else "❌"
        err = (p.get("error") or "（空，多为超时/网络）")[:80].replace("|", "/")
        lines.append(
            f"| {p.get('file', '')} | {p.get('batch_index')}/{p.get('batch_total', '?')} "
            f"| p{p.get('page_start', '?')}-{p.get('page_end', '?')} | {err} | {ok} |"
        )
    if not pending:
        lines.append("| — | — | — | 当前无待重导批次 | — |")
    lines.extend(["", "## 按文件汇总", ""])
    by_file: dict[str, list[dict]] = {}
    for p in pending:
        by_file.setdefault(p.get("file", "?"), []).append(p)
    for fname, items in sorted(by_file.items()):
        batches = ", ".join(str(x.get("batch_index")) for x in items)
        lines.append(f"- **{fname}**：批 **{batches}**（共 {len(items)} 批）")
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
