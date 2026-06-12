"""Attach hierarchical tags to Question / PdfImportTask."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import PdfImportTask, Question, Tag
from app.services.pdf_source_tag import ensure_pdf_source_tag
from app.services.tag_hierarchy import get_or_create_group_tag, is_group_name, tag_ids_for_metadata


def merge_task_pdf_tag(
    db: Session,
    task: PdfImportTask,
    pdf_tag: str | None,
    *,
    source_pdf: str | None = None,
) -> None:
    """Attach 主题大标签 + PDF 来源标签到导入任务。"""
    existing = {t.name for t in task.tags}
    added: list[Tag] = []

    if source_pdf and source_pdf.strip():
        src = ensure_pdf_source_tag(db, source_pdf.strip())
        if src and src.name not in existing:
            added.append(src)
            existing.add(src.name)

    if pdf_tag and pdf_tag.strip() and is_group_name(pdf_tag.strip()):
        name = pdf_tag.strip()
        if name not in existing:
            tag = get_or_create_group_tag(db, name)
            if tag:
                added.append(tag)
    if added:
        task.tags = list(task.tags) + added


def tag_ids_for_question(
    db: Session,
    item: dict,
    task_tags: list[Tag],
) -> list[int]:
    meta = item.get("metadata") or {}
    group = meta.get("tag_group")
    if not group:
        for t in task_tags:
            if is_group_name(t.name):
                group = t.name
                break
        if not group and task_tags:
            group = task_tags[0].name

    if not group:
        return []

    extra = [t.name for t in task_tags if not is_group_name(t.name)]
    ids = tag_ids_for_metadata(db, meta, group=group, extra_user_small=extra)
    source_pdf = meta.get("source_pdf")
    if isinstance(source_pdf, str) and source_pdf.strip():
        src_tag = ensure_pdf_source_tag(db, source_pdf)
        if src_tag and src_tag.id not in ids:
            ids.append(src_tag.id)
    return ids


def attach_tags(db: Session, question: Question, tag_ids: list[int]) -> None:
    if tag_ids:
        unique_ids = list(dict.fromkeys(tag_ids))
        question.tags = db.query(Tag).filter(Tag.id.in_(unique_ids)).all()
