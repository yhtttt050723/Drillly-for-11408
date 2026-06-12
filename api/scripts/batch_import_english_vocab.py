"""批量导入英文词汇 PDF 收件箱（命令行，不依赖前端）。"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

from app.database import SessionLocal
from app.services.english_vocab_inbox import process_all_english_vocab_inbox
from app.services.english_vocab_ledger import clear_all_records
from app.services.settings_store import get_english_vocab_inbox_dir
from app.services.word_dictation_import import WORD_TYPE
from app.models import Question


async def main(*, force: bool = False, clear_ledger: bool = False) -> None:
    if clear_ledger:
        n = clear_all_records()
        print(f"已清除收件箱导入记录 {n} 条")

    db = SessionLocal()
    try:
        before = db.query(Question).filter(Question.type == WORD_TYPE).count()
        inbox = get_english_vocab_inbox_dir()
        pdfs = sorted(inbox.glob("*.pdf"))
        print(f"收件箱: {inbox}")
        print(f"待处理 PDF: {len(pdfs)} 个 · 库内单词: {before}")

        result = await process_all_english_vocab_inbox(
            db,
            provider="deepseek",
            pages_per_batch=3,
            skip_imported=not force,
            force=force,
            default_book="基础词",
        )
        after = db.query(Question).filter(Question.type == WORD_TYPE).count()
        print(
            f"\n完成: 处理 {result.get('processed')} · 跳过 {result.get('skipped')} "
            f"· 失败 {result.get('errors')} / 共 {result.get('total')}"
        )
        print(f"词库: {before} → {after} (+{after - before})")
        for r in result.get("results") or []:
            name = r.get("file", "?")
            if r.get("skipped"):
                print(f"  跳过 {name}: {r.get('reason', '')}")
            elif r.get("error"):
                print(f"  失败 {name}: {r.get('error')}")
            elif r.get("ok"):
                imp = r.get("imported") or {}
                print(
                    f"  OK {name}: +{imp.get('created', 0)} "
                    f"去重跳过 {imp.get('skipped', 0)} · {r.get('book')} U{r.get('unit')}"
                )
    finally:
        db.close()


if __name__ == "__main__":
    force = "--force" in sys.argv
    clear = "--clear-ledger" in sys.argv
    asyncio.run(main(force=force, clear_ledger=clear))
