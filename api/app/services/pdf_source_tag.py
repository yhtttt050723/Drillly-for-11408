"""PDF 文件名作为独立「来源标签」，与主题大/小标签分开。"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import Tag
from app.services.tag_hierarchy import is_group_name

PDF_SOURCE_PREFIX = "来源·"


def pdf_source_tag_name(source_pdf: str) -> str:
    name = source_pdf.strip()
    if not name:
        return ""
    if name.startswith(PDF_SOURCE_PREFIX):
        return name
    return f"{PDF_SOURCE_PREFIX}{name}"


def is_pdf_source_tag(name: str) -> bool:
    return name.startswith(PDF_SOURCE_PREFIX)


def pdf_filename_from_tag(name: str) -> str:
    if is_pdf_source_tag(name):
        return name[len(PDF_SOURCE_PREFIX) :]
    return ""


def ensure_pdf_source_tag(db: Session, source_pdf: str) -> Tag | None:
    tag_name = pdf_source_tag_name(source_pdf)
    if not tag_name:
        return None
    tag = db.query(Tag).filter(Tag.name == tag_name).first()
    if not tag:
        tag = Tag(name=tag_name, color="#0ea5e9")
        db.add(tag)
        db.flush()
    return tag


def topic_tags_only(tag_names: list[str]) -> list[str]:
    """Exclude PDF source tags and slash-children from conflation."""
    out: list[str] = []
    for n in tag_names:
        if is_pdf_source_tag(n):
            continue
        out.append(n)
    return out
