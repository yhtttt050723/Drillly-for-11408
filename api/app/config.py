from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

API_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=API_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    drillly_port: int = 5213
    drillly_db: str = "./data/drillly.db"
    study_root: str = str(API_ROOT.parent.parent)
    cors_origins: str = (
        "http://localhost:5210,http://localhost:5211,http://localhost:5212,"
        "http://127.0.0.1:5212"
    )

    tongyi_api_key: str = ""
    deepseek_api_key: str = ""
    llm_default_provider: str = "mock"
    tongyi_model: str = "qwen-plus"
    tongyi_vision_model: str = "qwen-vl-max"
    deepseek_model: str = "deepseek-chat"
    local_base_url: str = "http://127.0.0.1:11434/v1"
    local_model: str = ""
    local_api_key: str = "ollama"
    pdf_vision_text_threshold: int = 150

    pdf_max_mb: int = 80
    pdf_default_pages_per_batch: int = 2
    runner_timeout_sec: int = 10
    mingw_bin: str = ""

    @property
    def db_path(self) -> Path:
        p = Path(self.drillly_db)
        if not p.is_absolute():
            p = API_ROOT / p
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def media_dir(self) -> Path:
        d = API_ROOT / "media"
        d.mkdir(parents=True, exist_ok=True)
        return d

    @property
    def export_dir(self) -> Path:
        d = Path(self.study_root) / "学习资料" / "做题" / "export"
        d.mkdir(parents=True, exist_ok=True)
        return d

    @property
    def cors_origin_list(self) -> list[str]:
        return [x.strip() for x in self.cors_origins.split(",") if x.strip()]


settings = Settings()
