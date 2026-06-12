"""Export Drillly questions to md-reader 错题本 Markdown format."""

from __future__ import annotations

from datetime import date
from pathlib import Path

from sqlalchemy.orm import Session, joinedload

from app.models import Question


def _stem_block(content: dict) -> str:
    stem = content.get("stem") or ""
    opts = content.get("options") or []
    lines = [stem, ""]
    if opts:
        lines.append("选项：")
        for o in opts:
            lines.append(f"- **{o.get('key')}**. {o.get('content', '')}")
        lines.append("")
    return "\n".join(lines)


def question_to_wrongbook_block(q: Question, *, subject: str, source: str) -> str:
    c = q.content
    title = c.get("title") or f"题目{q.id}"
    today = date.today().isoformat()
    meta = c.get("metadata") or {}
    chapter = (
        meta.get("chapter")
        or meta.get("tag_group")
        or (meta.get("tags", [""])[0] if meta.get("tags") else "")
    )
    pdf_name = meta.get("source_pdf") or ""
    pdf_path = meta.get("source_path") or ""
    source_line = source
    if pdf_path:
        source_line = pdf_path
    elif pdf_name:
        source_line = pdf_name

    return f"""### 题目：{title}

- 日期：{today}
- 科目：{subject or "未分类"}
- 章节：{chapter}
- 来源：{source_line}
- 题目图片：

#### 原题（OCR整理）

{_stem_block(c)}

#### 我的作答（从截图提取）

[Drillly 导入，尚未作答]

#### 答案

（见纸质版，此处不录。）

#### 错因分析

- 错因标签：
- 本次错误点：

#### 下次避免策略

1.
2.

#### 二刷计划

- 二刷时间：
- 二刷标准：

---
"""


def export_questions_wrongbook_md(
    db: Session,
    questions: list[Question],
    *,
    file_title: str,
) -> str:
    header = f"""# {file_title}

> 由 Drillly 同步导出，格式兼容 **Study Markdown Reader** 错题本（`### 题目：` + 隐藏答案区随机刷题）。

"""
    blocks = []
    for q in questions:
        subject = q.category.name if q.category else "未分类"
        meta = q.content.get("metadata") or {}
        source = meta.get("source_pdf") or "Drillly"
        blocks.append(question_to_wrongbook_block(q, subject=subject, source=source))
    return header + "\n".join(blocks)


def write_wrongbook_sync_file(db: Session, out_dir: Path, *, tag: str = "Drillly") -> Path:
    questions = (
        db.query(Question)
        .options(joinedload(Question.category), joinedload(Question.tags))
        .order_by(Question.id)
        .all()
    )
    stamp = date.today().isoformat()
    path = out_dir / f"{tag}导入-{stamp}.md"
    body = export_questions_wrongbook_md(
        db,
        questions,
        file_title=f"{tag} 同步错题 · {stamp}",
    )
    path.write_text(body, encoding="utf-8")
    return path
