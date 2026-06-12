"""一刷 / 二刷进度."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import PracticeProgress


def upsert_round_done(
    db: Session,
    question_id: int,
    round_num: int,
    done: bool = True,
) -> PracticeProgress:
    if round_num not in (1, 2):
        raise ValueError("round must be 1 or 2")
    row = (
        db.query(PracticeProgress)
        .filter(
            PracticeProgress.question_id == question_id,
            PracticeProgress.round == round_num,
        )
        .first()
    )
    if not row:
        row = PracticeProgress(question_id=question_id, round=round_num, done=False)
        db.add(row)
    row.done = done
    row.updated_at = datetime.now(timezone.utc)
    return row


def set_round_done(db: Session, question_id: int, round_num: int, done: bool = True) -> PracticeProgress:
    row = upsert_round_done(db, question_id, round_num, done)
    db.commit()
    db.refresh(row)
    return row
