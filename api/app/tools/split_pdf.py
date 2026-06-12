"""CLI: python -m app.tools.split_pdf file.pdf -o out -b 5"""
from __future__ import annotations

import argparse
from pathlib import Path

from pypdf import PdfReader, PdfWriter


def split_pdf(src: Path, out_dir: Path, pages_per_batch: int) -> list[tuple[int, int, Path]]:
    out_dir.mkdir(parents=True, exist_ok=True)
    reader = PdfReader(str(src))
    total = len(reader.pages)
    chunks: list[tuple[int, int, Path]] = []
    batch_idx = 0
    for start in range(0, total, pages_per_batch):
        end = min(start + pages_per_batch, total)
        batch_idx += 1
        writer = PdfWriter()
        for p in range(start, end):
            writer.add_page(reader.pages[p])
        out_path = out_dir / f"{src.stem}_p{start + 1}-{end}.pdf"
        with open(out_path, "wb") as f:
            writer.write(f)
        chunks.append((start + 1, end, out_path))
    return chunks


def main() -> None:
    parser = argparse.ArgumentParser(description="Split PDF by page batches")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("-o", "--out", type=Path, required=True)
    parser.add_argument("-b", "--batch", type=int, default=5)
    args = parser.parse_args()
    chunks = split_pdf(args.pdf, args.out, args.batch)
    for a, b, p in chunks:
        print(f"{a}-{b} -> {p}")


if __name__ == "__main__":
    main()
