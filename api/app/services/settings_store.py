"""Persist API keys & paths to data/settings.json; sync to .env for server restart."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from app.config import API_ROOT, settings

SETTINGS_PATH = API_ROOT / "data" / "settings.json"
ENV_PATH = API_ROOT / ".env"

MASK = "********"


def _load_raw() -> dict[str, Any]:
    if not SETTINGS_PATH.exists():
        return {}
    try:
        return json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _save_raw(data: dict[str, Any]) -> None:
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _mask_key(key: str | None) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return MASK
    return key[:4] + MASK + key[-4:]


def get_effective_keys() -> dict[str, str]:
    raw = _load_raw()
    return {
        "tongyi": (raw.get("tongyi_api_key") or settings.tongyi_api_key or "").strip(),
        "deepseek": (raw.get("deepseek_api_key") or settings.deepseek_api_key or "").strip(),
    }


def get_effective_local_llm() -> dict[str, str]:
    raw = _load_raw()
    base = (raw.get("local_base_url") or settings.local_base_url or "").strip()
    model = (raw.get("local_model") or settings.local_model or "").strip()
    api_key = (raw.get("local_api_key") or settings.local_api_key or "ollama").strip()
    if base and not base.rstrip("/").endswith("/v1"):
        base = base.rstrip("/") + "/v1"
    return {"base_url": base, "model": model, "api_key": api_key or "ollama"}


def apply_keys_to_runtime() -> None:
    keys = get_effective_keys()
    if keys["tongyi"]:
        os.environ["TONGYI_API_KEY"] = keys["tongyi"]
        settings.tongyi_api_key = keys["tongyi"]
    if keys["deepseek"]:
        os.environ["DEEPSEEK_API_KEY"] = keys["deepseek"]
        settings.deepseek_api_key = keys["deepseek"]


def _update_env_file(updates: dict[str, str]) -> None:
    lines: list[str] = []
    if ENV_PATH.exists():
        lines = ENV_PATH.read_text(encoding="utf-8").splitlines()
    present = set()
    out: list[str] = []
    for line in lines:
        m = re.match(r"^([A-Z_]+)=", line)
        if m and m.group(1) in updates:
            key = m.group(1)
            if updates[key]:
                out.append(f"{key}={updates[key]}")
            present.add(key)
        else:
            out.append(line)
    for key, val in updates.items():
        if key not in present and val:
            out.append(f"{key}={val}")
    ENV_PATH.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")


def get_public_settings() -> dict[str, Any]:
    raw = _load_raw()
    keys = get_effective_keys()
    local = get_effective_local_llm()
    return {
        "tongyi_api_key_masked": _mask_key(keys["tongyi"]),
        "deepseek_api_key_masked": _mask_key(keys["deepseek"]),
        "tongyi_configured": bool(keys["tongyi"]),
        "deepseek_configured": bool(keys["deepseek"]),
        "local_base_url": local["base_url"],
        "local_model": local["model"],
        "local_api_key_masked": _mask_key(local["api_key"]) if local["api_key"] != "ollama" else "",
        "local_configured": bool(local["model"]),
        "llm_default_provider": raw.get("llm_default_provider") or settings.llm_default_provider,
        "pdf_inbox_dir": str(get_pdf_inbox_dir()),
        "english_vocab_inbox_dir": str(get_english_vocab_inbox_dir()),
        "pdf_pages_per_batch": int(
            raw.get("pdf_pages_per_batch") or settings.pdf_default_pages_per_batch
        ),
        "study_export_wrongbook": str(get_wrongbook_export_dir()),
        "study_video_progress_file": str(get_video_progress_file()),
        "study_word_time_board_file": str(
            Path(settings.study_root) / "学习资料" / "学习数据看板" / "背词时长数据.md"
        ),
    }


def update_settings(
    *,
    tongyi_api_key: str | None = None,
    deepseek_api_key: str | None = None,
    llm_default_provider: str | None = None,
    local_base_url: str | None = None,
    local_model: str | None = None,
    local_api_key: str | None = None,
    pdf_pages_per_batch: int | None = None,
) -> dict[str, Any]:
    raw = _load_raw()
    env_updates: dict[str, str] = {}

    if tongyi_api_key is not None and tongyi_api_key.strip() and tongyi_api_key != MASK:
        raw["tongyi_api_key"] = tongyi_api_key.strip()
        env_updates["TONGYI_API_KEY"] = raw["tongyi_api_key"]
    if deepseek_api_key is not None and deepseek_api_key.strip() and deepseek_api_key != MASK:
        raw["deepseek_api_key"] = deepseek_api_key.strip()
        env_updates["DEEPSEEK_API_KEY"] = raw["deepseek_api_key"]
    if llm_default_provider:
        raw["llm_default_provider"] = llm_default_provider
        env_updates["LLM_DEFAULT_PROVIDER"] = llm_default_provider
    if local_base_url is not None and local_base_url.strip():
        raw["local_base_url"] = local_base_url.strip()
    if local_model is not None:
        raw["local_model"] = local_model.strip()
    if local_api_key is not None and local_api_key.strip() and local_api_key != MASK:
        raw["local_api_key"] = local_api_key.strip()
    if pdf_pages_per_batch is not None:
        raw["pdf_pages_per_batch"] = pdf_pages_per_batch

    _save_raw(raw)
    if env_updates:
        _update_env_file(env_updates)
    apply_keys_to_runtime()
    return get_public_settings()


def init_settings_from_env() -> None:
    """On startup: load settings.json; seed from .env if missing."""
    raw = _load_raw()
    changed = False
    if not raw.get("tongyi_api_key") and settings.tongyi_api_key:
        raw["tongyi_api_key"] = settings.tongyi_api_key
        changed = True
    if not raw.get("deepseek_api_key") and settings.deepseek_api_key:
        raw["deepseek_api_key"] = settings.deepseek_api_key
        changed = True
    if changed:
        _save_raw(raw)
    apply_keys_to_runtime()


def get_pdf_inbox_dir() -> Path:
    raw = _load_raw()
    if raw.get("pdf_inbox_dir"):
        return Path(raw["pdf_inbox_dir"])
    return Path(settings.study_root) / "学习资料" / "做题" / "PDF待导入"


def get_english_vocab_inbox_dir() -> Path:
    raw = _load_raw()
    if raw.get("english_vocab_inbox_dir"):
        return Path(raw["english_vocab_inbox_dir"])
    return Path(settings.study_root) / "学习资料" / "做题" / "英文词汇PDF待导入"


def get_wrongbook_export_dir() -> Path:
    d = Path(settings.study_root) / "学习资料" / "做题" / "同步错题"
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_video_progress_file() -> Path:
    return Path(settings.study_root) / "学习资料" / "学习视频进度" / "视频进度看板数据.md"


def ensure_study_dirs() -> None:
    get_pdf_inbox_dir().mkdir(parents=True, exist_ok=True)
    get_english_vocab_inbox_dir().mkdir(parents=True, exist_ok=True)
    get_wrongbook_export_dir().mkdir(parents=True, exist_ok=True)
    (Path(settings.study_root) / "学习资料" / "学习数据看板").mkdir(parents=True, exist_ok=True)
