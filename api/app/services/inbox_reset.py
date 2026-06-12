"""Clear import ledger and questions for one inbox PDF (re-import)."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from app.models import PdfImportBatch, PdfImportTask, PracticeProgress, Question, Submission
from app.services.inbox_ledger import _load, _save, file_fingerprint
from app.services.settings_store import get_pdf_inbox_dir
def delete_questions_for_pdf(db: Session, source_pdf: str) -> int:
    """Delete all questions whose metadata.source_pdf matches filename."""
    name = source_pdf.strip()
    if not name:
        return 0
    rows = db.query(Question.id).filter(Question.source_pdf == name).all()
    ids = [r[0] for r in rows]
    if not ids:
        return 0
    db.query(Submission).filter(Submission.question_id.in_(ids)).delete(
        synchronize_session=False
    )
    db.query(PracticeProgress).filter(PracticeProgress.question_id.in_(ids)).delete(
        synchronize_session=False
    )
    db.query(Question).filter(Question.id.in_(ids)).delete(synchronize_session=False)
    db.commit()
    return len(ids)


def clear_import_record(pdf_path: Path) -> bool:
    if not pdf_path.is_file():
        return False
    data = _load()
    fp = file_fingerprint(pdf_path)
    if fp in data.get("records", {}):
        del data["records"][fp]
        _save(data)
        return True
    return False


def reset_inbox_pdf(db: Session, filename: str) -> dict:
    """Remove ledger entry + DB questions for one PDF in inbox."""
    inbox = get_pdf_inbox_dir()
    pdf_path = inbox / filename
    if not pdf_path.is_file():
        raise FileNotFoundError(f"收件箱中无此文件: {filename}")

    n_q = delete_questions_for_pdf(db, filename)
    cleared = clear_import_record(pdf_path)

    # orphan import tasks (optional cleanup)
    tasks = (
        db.query(PdfImportTask)
        .filter(PdfImportTask.original_name == filename)
        .all()
    )
    for t in tasks:
        db.query(PdfImportBatch).filter(PdfImportBatch.task_id == t.id).delete()
        db.delete(t)
    db.commit()

    return {
        "file": filename,
        "questions_deleted": n_q,
        "ledger_cleared": cleared,
    }
