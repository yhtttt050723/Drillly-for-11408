"""Render PDF chunk pages to PNG base64 for vision LLM (scanned 做题本)."""

from __future__ import annotations

import base64
from pathlib import Path


def render_chunk_images_b64(
    chunk_path: str,
    *,
    dpi: int = 120,
    max_pages: int = 5,
    jpeg_quality: int = 82,
) -> list[str]:
    """Return JPEG base64 strings, one per page (smaller payload for DashScope VL)."""
    try:
        import fitz  # pymupdf
    except ImportError:
        return []

    path = Path(chunk_path)
    if not path.is_file():
        return []

    images: list[str] = []
    doc = fitz.open(str(path))
    try:
        scale = dpi / 72.0
        matrix = fitz.Matrix(scale, scale)
        for i, page in enumerate(doc):
            if i >= max_pages:
                break
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            img_bytes = pix.tobytes("jpeg", jpg_quality=jpeg_quality)
            images.append(base64.standard_b64encode(img_bytes).decode("ascii"))
    finally:
        doc.close()
    return images
