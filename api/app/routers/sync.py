from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.settings_store import (
    get_video_progress_file,
    get_wrongbook_export_dir,
)
from app.services.study_export import write_wrongbook_sync_file

router = APIRouter(prefix="/api/sync", tags=["sync"])


@router.get("/paths/")
def sync_paths():
    wrong = get_wrongbook_export_dir()
    video = get_video_progress_file()
    return {
        "wrongbook_export_dir": str(wrong),
        "video_progress_file": str(video),
        "video_progress_hint": "视频分 P 勾选由 video-dash 写入 BV 详情 md；看板读 视频进度看板数据.md",
        "reader_opens": "D:\\Study（Study Markdown Reader 打开此文件夹）",
    }


@router.post("/study/wrongbook/")
def sync_wrongbook_to_study(db: Session = Depends(get_db)):
    out_dir = get_wrongbook_export_dir()
    path = write_wrongbook_sync_file(db, out_dir)
    return {
        "ok": True,
        "path": str(path),
        "message": "已导出为 md-reader 错题本格式，请在 Reader 中打开 学习资料 文件夹刷新",
    }
