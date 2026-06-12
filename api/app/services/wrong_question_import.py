"""从 Study 错题截图目录导入图片题为 wrong_review 类型。"""

from __future__ import annotations

import re
import shutil
from copy import deepcopy
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.config import settings
from app.models import Question, Tag
from app.services.question_images import ALLOWED_EXT, media_url, question_images_dir, safe_image_name
from app.services.tag_hierarchy import get_or_create_child_tag, get_or_create_group_tag, tag_ids_for_metadata

WRONG_SCREENSHOT_REL = Path("学习资料") / "错题截图"

# 660_365.png / wxz_ch1_yx06.png
_RE_660 = re.compile(r"^660_(\d+)\.", re.I)
_RE_GENERIC = re.compile(r"^([a-z0-9]+)_", re.I)


def default_tag_group(subject: str) -> str:
    """按科目文件夹推断主题大标签。"""
    s = subject.strip()
    if s in ("线代", "高数", "概率论"):
        return f"数学-{s}"
    if s.startswith("408-"):
        return s
    return s


def default_source_label(subject: str) -> str:
    return f"错题截图·{subject.strip()}"


def wrong_screenshot_root() -> Path:
    return Path(settings.study_root) / WRONG_SCREENSHOT_REL


def list_subjects() -> list[str]:
    root = wrong_screenshot_root()
    if not root.is_dir():
        return []
    return sorted(
        p.name for p in root.iterdir() if p.is_dir() and not p.name.startswith(".")
    )


def _parse_filename(name: str) -> dict[str, str]:
    stem = Path(name).stem
    m = _RE_660.match(name)
    if m:
        num = m.group(1)
        return {
            "question_number": f"T{num}",
            "book": "660",
            "title": f"660 · T{num}",
        }
    book_m = _RE_GENERIC.match(stem)
    book = book_m.group(1) if book_m else ""
    return {
        "question_number": stem,
        "book": book,
        "title": stem,
    }


def _existing_import_keys(db: Session) -> set[str]:
    rows = (
        db.query(Question)
        .filter(Question.type == "wrong_review")
        .all()
    )
    keys: set[str] = set()
    for q in rows:
        meta = (q.content or {}).get("metadata") or {}
        key = meta.get("import_key")
        if isinstance(key, str) and key.strip():
            keys.add(key.strip())
    return keys


def _list_image_files(subject: str) -> list[Path]:
    folder = wrong_screenshot_root() / subject
    if not folder.is_dir():
        return []
    files: list[Path] = []
    for p in sorted(folder.iterdir()):
        if not p.is_file():
            continue
        if p.suffix.lower() not in ALLOWED_EXT:
            continue
        if p.name.startswith("rename-manifest"):
            continue
        files.append(p)
    return files


def preview_import(subject: str) -> dict[str, Any]:
    files = _list_image_files(subject)
    return {
        "subject": subject,
        "folder": str(wrong_screenshot_root() / subject),
        "total_files": len(files),
        "files": [p.name for p in files[:200]],
    }


def preview_import_with_db(db: Session, subject: str) -> dict[str, Any]:
    files = _list_image_files(subject)
    existing = _existing_import_keys(db)
    new_files: list[str] = []
    skipped: list[str] = []
    for p in files:
        key = f"{subject}/{p.name}"
        if key in existing:
            skipped.append(p.name)
        else:
            new_files.append(p.name)
    return {
        "subject": subject,
        "folder": str(wrong_screenshot_root() / subject),
        "total_files": len(files),
        "new_count": len(new_files),
        "skipped_count": len(skipped),
        "new_files": new_files[:200],
        "skipped_files": skipped[:50],
    }


def _attach_question_tags(db: Session, q: Question, meta: dict, group: str, subject: str) -> None:
    tag_ids = tag_ids_for_metadata(db, meta, group=group, extra_user_small=[])
    get_or_create_group_tag(db, "错题")
    child = get_or_create_child_tag(db, "错题", subject)
    if child and child.id not in tag_ids:
        tag_ids.append(child.id)
    if tag_ids:
        q.tags = db.query(Tag).filter(Tag.id.in_(tag_ids)).all()


def _copy_image(question_id: int, src: Path) -> str:
    name = safe_image_name(src.name)
    dest = question_images_dir(question_id) / name
    shutil.copy2(src, dest)
    return media_url(question_id, name)


def _set_question_content(q: Question, content: dict) -> None:
    """必须赋新 dict，否则 SQLAlchemy JSON 列可能检测不到 images 更新。"""
    q.content = deepcopy(content)


def preview_import_all(db: Session) -> dict[str, Any]:
    subjects = list_subjects()
    per_subject: list[dict[str, Any]] = []
    total_files = 0
    total_new = 0
    total_skipped = 0
    for subject in subjects:
        p = preview_import_with_db(db, subject)
        per_subject.append(
            {
                "subject": subject,
                "tag_group": default_tag_group(subject),
                "total_files": p["total_files"],
                "new_count": p["new_count"],
                "skipped_count": p["skipped_count"],
            }
        )
        total_files += p["total_files"]
        total_new += p["new_count"]
        total_skipped += p["skipped_count"]
    return {
        "subjects": subjects,
        "total_files": total_files,
        "new_count": total_new,
        "skipped_count": total_skipped,
        "per_subject": per_subject,
    }


def repair_missing_images(db: Session) -> dict[str, Any]:
    """已导入但 content.images 为空的题目，从 media 目录补回 URL。"""
    rows = db.query(Question).filter(Question.type == "wrong_review").all()
    fixed = 0
    for q in rows:
        content = dict(q.content or {})
        imgs = content.get("images") or []
        if imgs:
            continue
        img_dir = settings.media_dir / "question_images" / str(q.id)
        if not img_dir.is_dir():
            continue
        files = sorted(
            f for f in img_dir.iterdir() if f.is_file() and f.suffix.lower() in ALLOWED_EXT
        )
        if not files:
            continue
        content["images"] = [media_url(q.id, f.name) for f in files]
        _set_question_content(q, content)
        fixed += 1
    db.commit()
    return {"fixed": fixed}


def repair_wrong_question_tags(db: Session) -> dict[str, Any]:
    """按 subject_folder 修正错题标签与出处。"""
    rows = db.query(Question).filter(Question.type == "wrong_review").all()
    fixed = 0
    for q in rows:
        content = dict(q.content or {})
        meta = dict(content.get("metadata") or {})
        subject = str(meta.get("subject_folder") or "").strip()
        if not subject:
            continue
        group = default_tag_group(subject)
        label = default_source_label(subject)
        meta["tag_group"] = group
        meta["source_label"] = label
        meta["source_pdf"] = label
        content["metadata"] = meta
        _set_question_content(q, content)
        _attach_question_tags(db, q, meta, group, subject)
        fixed += 1
    db.commit()
    return {"fixed": fixed}


def import_all_screenshots(db: Session) -> dict[str, Any]:
    subjects = list_subjects()
    results: list[dict[str, Any]] = []
    total_created = 0
    for subject in subjects:
        r = import_screenshots(
            db,
            subject=subject,
            tag_group=default_tag_group(subject),
            source_label=default_source_label(subject),
        )
        results.append(r)
        total_created += r["created"]
    repair = repair_missing_images(db)
    tags = repair_wrong_question_tags(db)
    return {
        "subjects": subjects,
        "total_created": total_created,
        "results": results,
        "images_repaired": repair["fixed"],
        "tags_repaired": tags["fixed"],
    }


def import_screenshots(
    db: Session,
    *,
    subject: str,
    tag_group: str = "",
    source_label: str = "",
    small_tags: list[str] | None = None,
) -> dict[str, Any]:
    subject = subject.strip()
    if not subject:
        raise ValueError("subject 不能为空")

    folder = wrong_screenshot_root() / subject
    if not folder.is_dir():
        raise ValueError(f"目录不存在: {folder}")

    group = (tag_group or default_tag_group(subject)).strip()
    label = (source_label or default_source_label(subject)).strip()
    files = _list_image_files(subject)
    existing = _existing_import_keys(db)

    created_ids: list[int] = []
    skipped: list[str] = []
    errors: list[dict[str, str]] = []

    for src in files:
        import_key = f"{subject}/{src.name}"
        if import_key in existing:
            skipped.append(src.name)
            continue
        try:
            parsed = _parse_filename(src.name)
            meta: dict[str, Any] = {
                "wrong_import": True,
                "import_key": import_key,
                "source_label": label,
                "source_path": str(src.resolve()),
                "source_pdf": label,
                "tag_group": group,
                "tags": list(small_tags or []),
                "question_number": parsed["question_number"],
                "book": parsed.get("book") or "",
                "subject_folder": subject,
            }
            if parsed.get("book"):
                meta["tags"] = list(dict.fromkeys([*meta["tags"], parsed["book"]]))

            content = {
                "type": "wrong_review",
                "title": parsed["title"],
                "stem": "",
                "images": [],
                "answer": [],
                "metadata": meta,
            }

            q = Question(type="wrong_review", content=deepcopy(content))
            _attach_question_tags(db, q, meta, group, subject)

            db.add(q)
            db.flush()

            url = _copy_image(q.id, src)
            content["images"] = [url]
            _set_question_content(q, content)
            db.flush()

            created_ids.append(q.id)
            existing.add(import_key)
        except Exception as e:
            errors.append({"file": src.name, "error": str(e)})

    db.commit()
    return {
        "subject": subject,
        "created": len(created_ids),
        "created_question_ids": created_ids,
        "skipped": len(skipped),
        "skipped_files": skipped[:50],
        "errors": errors,
    }
