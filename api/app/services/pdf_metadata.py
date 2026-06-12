"""PDF import metadata: filename, path, hierarchical tags."""

from __future__ import annotations

from pathlib import Path

from app.services.tag_hierarchy import normalize_small_tags, resolve_group_tag


def tag_from_filename(filename: str) -> str:
    stem = Path(filename).stem
    if "_" in stem and len(stem) > 33:
        prefix, rest = stem.split("_", 1)
        if len(prefix) == 32 and all(c in "0123456789abcdef" for c in prefix.lower()):
            stem = rest
    return stem[:48] or "PDF导入"


def enrich_questions(
    questions: list[dict],
    *,
    source_filename: str,
    source_path: str,
    user_tags: list[str],
    page_start: int,
    page_end: int,
    pdf_tag: str | None = None,
) -> tuple[list[dict], str]:
    """Set tag_group (大标签) + tags (小标签短名，最多 3 个/题)."""
    first_meta = questions[0].get("metadata") if questions else {}
    group = resolve_group_tag(
        pdf_tag=pdf_tag,
        meta=first_meta if isinstance(first_meta, dict) else {},
        filename=source_filename,
        user_tags=user_tags,
    )
    from app.services.pdf_source_tag import is_pdf_source_tag

    user_small = [
        t for t in user_tags if t.strip() and t.strip() != group and not is_pdf_source_tag(t)
    ]

    out: list[dict] = []
    for item in questions:
        q = dict(item)
        meta = dict(q.get("metadata") or {})
        meta.setdefault("source_pdf", source_filename)
        meta.setdefault("source_path", source_path)
        if meta.get("page") is None:
            meta["page"] = page_start
        meta.setdefault("page_end", page_end)
        meta["tag_group"] = group
        meta["tags"] = normalize_small_tags(group, meta.get("tags"))
        if user_small:
            meta["tags"] = normalize_small_tags(group, [*meta["tags"], *user_small])
        q["metadata"] = meta
        out.append(q)
    return out, group
