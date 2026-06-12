import io
import zipfile
from datetime import datetime

from sqlalchemy.orm import Session, joinedload

from app.models import Question, Submission


def question_to_md(q: Question, include_answers: bool, submissions: list[Submission] | None) -> str:
    c = q.content
    lines = [
        f"# {c.get('title') or f'题目 {q.id}'}",
        "",
        f"- **类型**: {q.type}",
    ]
    if q.category:
        lines.append(f"- **分类**: {q.category.name}")
    if q.tags:
        lines.append(f"- **标签**: {', '.join(t.name for t in q.tags)}")
    lines.extend(["", "## 题干", "", c.get("stem", ""), ""])

    opts = c.get("options") or []
    if opts:
        lines.append("## 选项")
        lines.append("")
        for o in opts:
            lines.append(f"- **{o.get('key')}**. {o.get('content', '')}")
        lines.append("")

    if include_answers:
        lines.extend(
            [
                "## 答案",
                "",
                ", ".join(c.get("answer") or []) or "（代码题见解析）",
                "",
                "## 解析",
                "",
                c.get("explanation") or "",
                "",
            ]
        )

    if submissions:
        lines.append("## 作答记录")
        lines.append("")
        for s in submissions:
            ts = s.created_at.strftime("%Y-%m-%d %H:%M:%S")
            lines.append(f"### {ts} · {'正确' if s.is_correct else '错误'} · 得分 {s.score}")
            if q.type == "coding":
                code = s.answer.get("code") or s.answer.get("value") or ""
                lang = s.answer.get("language", "cpp")
                lines.append(f"```{lang}")
                lines.append(code)
                lines.append("```")
            else:
                lines.append(f"- 作答: `{s.answer}`")
            lines.append("")

    return "\n".join(lines)


def build_export(
    db: Session,
    questions: list[Question],
    include_answers: bool,
    include_submissions: bool,
    fmt: str,
) -> tuple[bytes, str, str]:
    all_subs: dict[int, list[Submission]] = {}
    if include_submissions:
        qids = [q.id for q in questions]
        if qids:
            subs = (
                db.query(Submission)
                .filter(Submission.question_id.in_(qids))
                .order_by(Submission.created_at.desc())
                .all()
            )
            for s in subs:
                all_subs.setdefault(s.question_id, []).append(s)

    parts = [
        question_to_md(q, include_answers, all_subs.get(q.id) if include_submissions else None)
        for q in questions
    ]
    combined = "\n\n---\n\n".join(parts)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")

    if fmt == "zip":
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("all.md", combined)
            for q, md in zip(questions, parts):
                zf.writestr(f"q{q.id}.md", md)
        buf.seek(0)
        return buf.read(), f"drillly-export-{stamp}.zip", "application/zip"

    return combined.encode("utf-8"), f"drillly-export-{stamp}.md", "text/markdown; charset=utf-8"


def load_questions_filtered(
    db: Session,
    tags: str | None,
    category: str | None,
    q_type: str | None,
    source_pdf: str | None = None,
) -> list[Question]:
    from app.services.question_query import load_questions

    return load_questions(
        db,
        tags=tags,
        category=category,
        q_type=q_type,
        source_pdf=source_pdf,
        limit=500,
    )
