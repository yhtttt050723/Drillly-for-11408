# -*- coding: utf-8 -*-
"""清空 Drillly 题库并恢复 PDF 收件箱，便于重新导入。

用法（先关闭正在运行的 API 窗口）：
  cd drillly\\api
  .venv\\Scripts\\python scripts\\reset_all.py
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_ROOT))

from app.services.settings_store import get_pdf_inbox_dir  # noqa: E402

DB = API_ROOT / "data" / "drillly.db"
LEDGER = API_ROOT / "data" / "inbox_imported.json"
MEDIA_IMPORTS = API_ROOT / "data" / "media" / "imports"


def _unlink_db() -> None:
    for path in (DB, DB.with_suffix(".db-wal"), DB.with_suffix(".db-shm")):
        if path.exists():
            try:
                path.unlink()
                print(f"已删除: {path.name}")
            except PermissionError as e:
                raise PermissionError(
                    f"{path} 仍被占用。请先关闭 Drillly API 窗口，或运行 reset-db.bat（会自动结束 5213 端口进程）。"
                ) from e


def main() -> None:
    if DB.exists() or DB.with_suffix(".db-wal").exists():
        _unlink_db()
    else:
        print("数据库不存在，跳过")

    if LEDGER.exists():
        LEDGER.unlink()
        print(f"已删除导入记录: {LEDGER}")

    if MEDIA_IMPORTS.exists():
        shutil.rmtree(MEDIA_IMPORTS)
        print(f"已清空: {MEDIA_IMPORTS}")

    inbox = get_pdf_inbox_dir()
    done = inbox / "已处理"
    if done.is_dir():
        for pdf in done.glob("*.pdf"):
            target = inbox / pdf.name
            if target.exists():
                target = inbox / f"reset_{pdf.name}"
            shutil.move(str(pdf), str(target))
            print(f"PDF 移回收件箱: {target.name}")

    inbox.mkdir(parents=True, exist_ok=True)
    print()
    print("重置完成。请重新启动 API，在「PDF 导入」页一键处理收件箱。")
    print(f"收件箱: {inbox}")


if __name__ == "__main__":
    main()
