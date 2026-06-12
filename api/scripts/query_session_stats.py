#!/usr/bin/env python3
"""查询 Drillly 指定时段做题本数据，供日报 MDC / 助手附挂。"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.database import SessionLocal  # noqa: E402
from app.services.session_stats import (  # noqa: E402
    format_stats_markdown,
    get_session_stats,
    parse_cst_datetime,
    parse_slot_range,
)


def main() -> int:
    ap = argparse.ArgumentParser(description="Drillly 时段统计（日报附挂）")
    ap.add_argument("--start", help="开始时间 CST，如 2026-06-09T22:10")
    ap.add_argument("--end", help="结束时间 CST，如 2026-06-10T01:07")
    ap.add_argument("--slot", help="时段 HH:MM—HH:MM（需配合 --date）")
    ap.add_argument("--date", help="时段起始日期 YYYY-MM-DD")
    ap.add_argument("--end-date", help="跨日结束日期 YYYY-MM-DD")
    ap.add_argument("--source-pdf", default="", help="仅统计某 PDF 来源")
    ap.add_argument("--slot-label", default="", help="日报段标签，如 段#1")
    ap.add_argument("--format", choices=["json", "md", "both"], default="both")
    args = ap.parse_args()

    try:
        if args.slot:
            if not args.date:
                ap.error("--slot 需要 --date")
            start, end = parse_slot_range(args.slot, date=args.date, end_date=args.end_date)
        elif args.start and args.end:
            start = parse_cst_datetime(args.start)
            end = parse_cst_datetime(args.end)
        else:
            ap.error("请提供 --start/--end 或 --slot + --date")
    except ValueError as e:
        print(f"错误: {e}", file=sys.stderr)
        return 1

    db = SessionLocal()
    try:
        stats = get_session_stats(
            db,
            start=start,
            end=end,
            source_pdf=args.source_pdf or None,
        )
    finally:
        db.close()

    if args.format in ("json", "both"):
        print(json.dumps(stats, ensure_ascii=False, indent=2))
    if args.format == "both":
        print()
    if args.format in ("md", "both"):
        print(format_stats_markdown(stats, slot_label=args.slot_label))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
