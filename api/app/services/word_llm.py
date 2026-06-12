"""本地/云端 LLM 生成默写单词列表，并可直接写入 word_dictation 题库。"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy.orm import Session

from app.services.llm import complete_json_chat, list_providers
from app.services.settings_store import get_effective_local_llm, get_public_settings
from app.services.word_dictation_import import import_paste, parse_paste_lines

_WORD_JSON_PROMPT = """你是考研英语词汇助手。用户正在用「默写单词」功能复习，需要你补充一批单词。

请**只输出一个 JSON 对象**（不要用 ``` 包裹），格式严格如下：
{{"words":[{{"word":"英文单词","meaning":"中文释义（可含词性）"}}],"note":"可选的一两句说明"}}

要求：
- words 数组内每项必须有 word（英文）和 meaning（中文）
- 每次输出 **3～20** 个词，不要重复用户已列出的词
- meaning 简洁，适合默写前看释义、默写后对照
- word 用常见拼写，不要短语句子

{context_block}
用户补充需求：
{message}
"""


def _resolve_provider(provider: str | None) -> str:
    p = (provider or "").strip()
    if p:
        return p
    raw = get_public_settings()
    return str(raw.get("llm_default_provider") or "local")


def _parse_words_payload(data: Any) -> tuple[list[dict[str, str]], str]:
    note = ""
    if isinstance(data, dict):
        note = str(data.get("note") or "").strip()
        raw_words = data.get("words")
        if isinstance(raw_words, list):
            out: list[dict[str, str]] = []
            for item in raw_words:
                if isinstance(item, dict):
                    w = str(item.get("word") or "").strip()
                    m = str(item.get("meaning") or item.get("definition") or "").strip()
                elif isinstance(item, str):
                    w, m = item.strip(), ""
                else:
                    continue
                if w and re.search(r"[A-Za-z]", w):
                    out.append({"word": w, "meaning": m})
            if out:
                return out, note
        # 兼容模型直接返回数组
        if isinstance(data.get("items"), list):
            return _parse_words_payload({"words": data["items"], "note": note})
    if isinstance(data, list):
        return _parse_words_payload({"words": data})
    return [], note


def _fallback_parse_text(text: str) -> list[dict[str, str]]:
    return parse_paste_lines(text)


async def suggest_words(
    db: Session,
    *,
    message: str,
    provider: str | None = None,
    model: str | None = None,
    unit: str = "",
    context: str = "",
    auto_import: bool = True,
) -> dict[str, Any]:
    msg = (message or "").strip()
    if not msg:
        raise ValueError("请描述要补充的单词（例如：Unit15 错词形近词再补 8 个）")

    prov = _resolve_provider(provider)
    available = {p["id"] for p in list_providers() if p.get("available")}
    if prov not in available:
        raise ValueError(f"模型不可用：{prov}（请在设置中配置本地模型或 API Key）")

    ctx = (context or "").strip()
    context_block = ""
    if ctx:
        context_block = f"已有/参考词汇（勿重复）：\n{ctx}\n"

    prompt = _WORD_JSON_PROMPT.format(message=msg, context_block=context_block)
    raw = await complete_json_chat(prov, model, prompt, timeout=120.0)

    words, note = _parse_words_payload(raw)
    if not words and isinstance(raw, dict) and raw.get("raw_text"):
        words = _fallback_parse_text(str(raw["raw_text"]))
    if not words:
        # 最后尝试：把整段响应当粘贴文本
        import json

        words = _fallback_parse_text(json.dumps(raw, ensure_ascii=False) if raw else "")

    if not words:
        raise ValueError("模型未返回可识别的单词列表，请换表述或检查本地模型是否支持 JSON")

    result: dict[str, Any] = {
        "provider": prov,
        "model": model or _model_for_provider(prov),
        "words": words,
        "note": note,
        "paste_preview": "\n".join(
            f"{w['word']}, {w['meaning']}" if w.get("meaning") else w["word"] for w in words
        ),
    }

    if auto_import:
        paste = result["paste_preview"]
        imp = import_paste(
            db,
            text=paste,
            unit=unit.strip(),
            source_label=f"AI补充·{prov}",
            small_tags=["AI补充"],
        )
        result["imported"] = imp

    return result


def _model_for_provider(provider: str) -> str:
    if provider == "local":
        return get_effective_local_llm().get("model") or ""
    from app.config import settings

    if provider == "deepseek":
        return settings.deepseek_model
    if provider == "tongyi":
        return settings.tongyi_model
    return ""


async def fetch_ollama_model_names() -> list[str]:
    """探测本机 Ollama /api/tags。"""
    import httpx

    cfg = get_effective_local_llm()
    base = cfg["base_url"].rstrip("/")
    if base.endswith("/v1"):
        root = base[:-3]
    else:
        root = base.replace("/v1", "").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{root}/api/tags")
            r.raise_for_status()
            data = r.json()
    except Exception:
        return []
    names: list[str] = []
    for m in data.get("models") or []:
        name = m.get("name") if isinstance(m, dict) else None
        if name:
            names.append(str(name))
    return sorted(names)
