from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.wrong_question_import import (
    default_source_label,
    default_tag_group,
    import_all_screenshots,
    import_screenshots,
    list_subjects,
    preview_import_all,
    preview_import_with_db,
    repair_missing_images,
    repair_wrong_question_tags,
    wrong_screenshot_root,
)

router = APIRouter(prefix="/api/wrong-questions", tags=["wrong-questions"])


class WrongImportBody(BaseModel):
    subject: str = Field(..., description="错题截图子目录名，如 线代、高数")
    tag_group: str = Field("", description="主题大标签，如 数学-线代")
    source_label: str = Field("", description="出处说明，如 660 Ch2 矩阵")
    small_tags: list[str] = Field(default_factory=list, description="额外小标签")


@router.get("/subjects/")
def get_subjects():
    root = wrong_screenshot_root()
    subjects = list_subjects()
    return {
        "root": str(root),
        "subjects": subjects,
        "tag_groups": {s: default_tag_group(s) for s in subjects},
    }


@router.get("/preview/")
def preview(subject: str, db: Session = Depends(get_db)):
    if not subject.strip():
        raise HTTPException(400, "subject 不能为空")
    s = subject.strip()
    p = preview_import_with_db(db, s)
    p["tag_group"] = default_tag_group(s)
    p["source_label"] = default_source_label(s)
    return p


@router.get("/preview-all/")
def preview_all(db: Session = Depends(get_db)):
    return preview_import_all(db)


@router.post("/import/")
def run_import(body: WrongImportBody, db: Session = Depends(get_db)):
    try:
        s = body.subject.strip()
        return import_screenshots(
            db,
            subject=s,
            tag_group=body.tag_group.strip() or default_tag_group(s),
            source_label=body.source_label.strip() or default_source_label(s),
            small_tags=body.small_tags,
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/import-all/")
def run_import_all(db: Session = Depends(get_db)):
    return import_all_screenshots(db)


@router.post("/repair-images/")
def run_repair_images(db: Session = Depends(get_db)):
    return repair_missing_images(db)


@router.post("/repair-tags/")
def run_repair_tags(db: Session = Depends(get_db)):
    return repair_wrong_question_tags(db)
