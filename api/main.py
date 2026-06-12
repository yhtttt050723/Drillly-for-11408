from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings as app_settings
from app.database import init_db
from app.routers import import_pdf, practice, questions, runner, sync, word_dictation, wrong_questions
from app.routers import settings as settings_router
from app.services.settings_store import ensure_study_dirs, init_settings_from_env


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    init_settings_from_env()
    ensure_study_dirs()
    yield


app = FastAPI(title="Drillly API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=app_settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(questions.router)
app.include_router(practice.router)
app.include_router(import_pdf.router)
app.include_router(runner.router)
app.include_router(settings_router.router)
app.include_router(sync.router)
app.include_router(wrong_questions.router)
app.include_router(word_dictation.router)

app.mount(
    "/api/media",
    StaticFiles(directory=app_settings.media_dir),
    name="media",
)


@app.get("/api/health/")
def health():
    from app.database import SessionLocal
    from app.models import Question

    db = SessionLocal()
    try:
        n = db.query(Question).count()
    finally:
        db.close()
    return {"ok": True, "service": "drillly-api", "question_count": n}
