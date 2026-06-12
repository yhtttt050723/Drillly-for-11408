"""题目附图：存于 media/question_images/{question_id}/"""

from __future__ import annotations

import re
import shutil
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.config import settings

ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
MAX_IMAGE_MB = 12


def question_images_dir(question_id: int) -> Path:
    d = settings.media_dir / "question_images" / str(question_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def safe_image_name(original: str) -> str:
    base = Path(original).name
    base = re.sub(r"[^\w.\-一-龥]", "_", base, flags=re.UNICODE)
    if not base or base in (".", ".."):
        base = "image.png"
    ext = Path(base).suffix.lower()
    if ext not in ALLOWED_EXT:
        ext = ".png"
        base = Path(base).stem + ext
    return base[:120]


def media_url(question_id: int, filename: str) -> str:
    return f"/api/media/question_images/{question_id}/{filename}"


async def save_upload(question_id: int, file: UploadFile) -> str:
    if not file.filename:
        raise HTTPException(400, "缺少文件名")
    name = safe_image_name(file.filename)
    dest = question_images_dir(question_id) / name
    data = await file.read()
    if len(data) > MAX_IMAGE_MB * 1024 * 1024:
        raise HTTPException(400, f"图片超过 {MAX_IMAGE_MB}MB")
    dest.write_bytes(data)
    return media_url(question_id, name)


def remove_image_file(question_id: int, url: str) -> None:
    prefix = f"/api/media/question_images/{question_id}/"
    if not url.startswith(prefix):
        return
    filename = url[len(prefix) :]
    path = question_images_dir(question_id) / filename
    if path.is_file():
        path.unlink()


def remove_all_images(question_id: int) -> None:
    d = settings.media_dir / "question_images" / str(question_id)
    if d.is_dir():
        shutil.rmtree(d, ignore_errors=True)
