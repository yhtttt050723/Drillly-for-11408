"""Denormalized source_pdf / search_text for fast filters (SQLite)."""

from __future__ import annotations

from sqlalchemy import event, text

from app.database import engine
from app.models import Question
from app.services.question_query import question_search_blob, source_pdf_from_content


def sync_question_index(question: Question) -> None:
    content = question.content if isinstance(question.content, dict) else {}
    question.source_pdf = source_pdf_from_content(content)
    question.search_text = question_search_blob(content)


@event.listens_for(Question, "before_insert")
@event.listens_for(Question, "before_update")
def _question_index_before_save(_mapper, _connection, target: Question) -> None:
    sync_question_index(target)


def ensure_question_index_columns() -> None:
    """SQLite: add columns on existing DB without Alembic."""
    with engine.begin() as conn:
        cols = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(questions)")).fetchall()
        }
        if "source_pdf" not in cols:
            conn.execute(
                text(
                    "ALTER TABLE questions ADD COLUMN source_pdf VARCHAR(512) "
                    "NOT NULL DEFAULT ''"
                )
            )
            conn.execute(
                text("CREATE INDEX IF NOT EXISTS ix_questions_source_pdf ON questions (source_pdf)")
            )
        if "search_text" not in cols:
            conn.execute(
                text("ALTER TABLE questions ADD COLUMN search_text TEXT NOT NULL DEFAULT ''")
            )


def backfill_question_index(batch_size: int = 500) -> int:
    from sqlalchemy import or_

    from app.database import SessionLocal

    updated = 0
    offset = 0
    db = SessionLocal()
    try:
        needs = (
            db.query(Question.id)
            .filter(or_(Question.search_text == "", Question.search_text.is_(None)))
            .limit(1)
            .first()
        )
        if not needs:
            return 0
        while True:
            rows = (
                db.query(Question)
                .order_by(Question.id)
                .offset(offset)
                .limit(batch_size)
                .all()
            )
            if not rows:
                break
            changed = False
            for q in rows:
                blob = question_search_blob(q.content)
                pdf = source_pdf_from_content(q.content)
                if q.search_text != blob or (q.source_pdf or "") != pdf:
                    q.search_text = blob
                    q.source_pdf = pdf
                    updated += 1
                    changed = True
            if changed:
                db.commit()
            offset += batch_size
            if len(rows) < batch_size:
                break
        return updated
    finally:
        db.close()
