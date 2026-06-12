from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.settings_store import (
    ensure_study_dirs,
    get_public_settings,
    update_settings,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingsPatch(BaseModel):
    tongyi_api_key: str | None = None
    deepseek_api_key: str | None = None
    llm_default_provider: str | None = None
    local_base_url: str | None = None
    local_model: str | None = None
    local_api_key: str | None = None
    pdf_pages_per_batch: int | None = Field(None, ge=1, le=20)


@router.get("/")
def get_settings():
    ensure_study_dirs()
    return get_public_settings()


@router.patch("/")
def patch_settings(body: SettingsPatch):
    return update_settings(
        tongyi_api_key=body.tongyi_api_key,
        deepseek_api_key=body.deepseek_api_key,
        llm_default_provider=body.llm_default_provider,
        local_base_url=body.local_base_url,
        local_model=body.local_model,
        local_api_key=body.local_api_key,
        pdf_pages_per_batch=body.pdf_pages_per_batch,
    )
