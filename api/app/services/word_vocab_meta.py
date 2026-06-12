"""从文件名 / 路径解析词汇书系（基础词、必考词）与 Unit。"""

from __future__ import annotations

import re
from pathlib import Path


def parse_vocab_pdf_filename(name: str) -> dict[str, str]:
    """
    识别示例：
    - 基础词 Unit15.pdf / 基础词-Unit-15.pdf
    - 必考词 U3.pdf / 必考词Unit03.pdf
    - Unit12-基础词.pdf
    """
    stem = Path(name).stem
    book = ""
    if "基础词" in stem:
        book = "基础词"
    elif "必考词" in stem:
        book = "必考词"

    unit = ""
    for pat in (
        r"[Uu]nit\s*[_\-]?\s*(\d+)",
        r"[Uu](\d{1,2})(?:\D|$)",
        r"第\s*(\d+)\s*[单元课]",
        r"[_\-\s](\d{1,2})(?:\D|$)",
    ):
        m = re.search(pat, stem, re.I)
        if m:
            unit = m.group(1).lstrip("0") or m.group(1)
            break

    # 每个 PDF 单独小标签（默写单词/{stem}）
    pdf_tag = stem[:120].strip()

    return {
        "book": book,
        "unit": unit,
        "source_label": stem,
        "pdf_tag": pdf_tag,
    }
