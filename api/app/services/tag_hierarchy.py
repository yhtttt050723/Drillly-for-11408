"""Two-level tags: group (大标签) + child (小标签), stored as ``group`` and ``group/child``."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models import Tag

TAG_SEP = "/"
MAX_CHILD_TAGS = 3
WORD_DICTATION_PARENT = "默写单词"


def is_group_name(name: str) -> bool:
    return TAG_SEP not in name


def child_full_name(group: str, short: str) -> str:
    g = group.strip()
    s = short.strip().replace(TAG_SEP, "·")
    if not g or not s:
        return ""
    if s == g:
        return ""
    return f"{g}{TAG_SEP}{s}"


def parse_child_display(full_name: str) -> tuple[str, str]:
    if TAG_SEP in full_name:
        g, c = full_name.split(TAG_SEP, 1)
        return g, c
    return full_name, ""


def normalize_small_tags(group: str, raw: list | str | None) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        raw = [raw]
    out: list[str] = []
    g = group.strip()
    for item in raw:
        if not isinstance(item, str):
            continue
        s = item.strip().replace(TAG_SEP, "·")
        if not s or s == g:
            continue
        if s.startswith(f"{g}{TAG_SEP}"):
            s = s.split(TAG_SEP, 1)[1]
        if s not in out:
            out.append(s)
        if len(out) >= MAX_CHILD_TAGS:
            break
    return out


def resolve_group_tag(
    *,
    pdf_tag: str | None,
    meta: dict,
    filename: str,
    user_tags: list[str],
) -> str:
    from app.services.pdf_metadata import tag_from_filename

    for candidate in (
        meta.get("tag_group"),
        pdf_tag,
        user_tags[0] if user_tags and is_group_name(user_tags[0]) else None,
    ):
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return tag_from_filename(filename)


def question_matches_tag_filter(question_tag_names: set[str], filter_name: str) -> bool:
    if filter_name in question_tag_names:
        return True
    if is_group_name(filter_name):
        prefix = f"{filter_name}{TAG_SEP}"
        return any(n.startswith(prefix) for n in question_tag_names)
    return False


def build_tag_tree(tags: list[Tag], *, include_pdf_source: bool = False) -> list[dict[str, Any]]:
    from app.services.pdf_source_tag import is_pdf_source_tag

    groups: dict[str, dict[str, Any]] = {}
    for t in tags:
        if not include_pdf_source and is_pdf_source_tag(t.name):
            continue
        if TAG_SEP in t.name:
            g, child = t.name.split(TAG_SEP, 1)
            node = groups.setdefault(g, {"name": g, "children": []})
            node["children"].append(
                {"id": t.id, "name": child, "full_name": t.name, "color": t.color}
            )
        else:
            node = groups.setdefault(t.name, {"name": t.name, "children": []})
            node["id"] = t.id
    for node in groups.values():
        node["children"] = sorted(node["children"], key=lambda c: c["name"])
    return sorted(groups.values(), key=lambda n: n["name"])


def get_or_create_group_tag(db: Session, group: str) -> Tag | None:
    name = group.strip()
    if not name or not is_group_name(name):
        return None
    tag = db.query(Tag).filter(Tag.name == name).first()
    if not tag:
        tag = Tag(name=name)
        db.add(tag)
        db.flush()
    return tag


def get_or_create_child_tag(db: Session, group: str, short: str) -> Tag | None:
    full = child_full_name(group, short)
    if not full:
        return None
    tag = db.query(Tag).filter(Tag.name == full).first()
    if not tag:
        tag = Tag(name=full)
        db.add(tag)
        db.flush()
    return tag


def tag_ids_for_metadata(
    db: Session,
    meta: dict,
    *,
    group: str,
    extra_user_small: list[str] | None = None,
) -> list[int]:
    small = normalize_small_tags(group, meta.get("tags"))
    if extra_user_small:
        for t in extra_user_small:
            if is_group_name(t):
                continue
            small = normalize_small_tags(group, [*small, t])

    ids: list[int] = []
    gtag = get_or_create_group_tag(db, group)
    if gtag:
        ids.append(gtag.id)
    for s in small:
        ctag = get_or_create_child_tag(db, group, s)
        if ctag and ctag.id not in ids:
            ids.append(ctag.id)
    return ids
