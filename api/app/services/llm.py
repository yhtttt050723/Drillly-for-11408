import asyncio
import json
import re
from pathlib import Path
from typing import Any

import httpx
from pypdf import PdfReader

from app.config import settings
from app.services.pdf_metadata import enrich_questions
from app.services.settings_store import get_effective_keys, get_effective_local_llm
from app.tools.pdf_render import render_chunk_images_b64

_TYPE_ALIASES = {
    "fill_blank": "subjective",
    "fill_in": "subjective",
    "blank": "subjective",
    "short_answer": "subjective",
    "essay": "subjective",
    "calculation": "subjective",
    "big_question": "subjective",
    "subjective": "subjective",
    "programming": "coding",
    "code": "coding",
}


def _normalize_questions(questions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in questions:
        q = dict(item)
        raw = str(q.get("type") or "").strip().lower().replace(" ", "_")
        q_type = _TYPE_ALIASES.get(raw)
        if not q_type:
            opts = q.get("options") or []
            q_type = "single_choice" if opts else "subjective"
        q["type"] = q_type
        stem = str(q.get("stem") or q.get("title") or "").strip()
        if not stem:
            continue
        q["stem"] = stem
        if q_type == "subjective":
            q.setdefault("options", [])
            ref = q.get("answer")
            if isinstance(ref, str):
                q["answer"] = [ref]
            q.setdefault("answer", q.get("answer") or [])
        elif q_type in ("single_choice", "multiple_choice") and not (q.get("options") or []):
            q["type"] = "subjective"
            q["options"] = []
            q.setdefault("answer", [])
        if q_type == "coding":
            raw = str(q.get("language") or "").lower()
            q.setdefault("language", raw if raw in ("c", "cpp") else "cpp")
        out.append(q)
    return out


_JSON_ESCAPE_RULES = """
【JSON 转义铁律 — 违反会导致整批失败、无法入库】
1. 只输出一个合法 JSON 对象，禁止用 ``` 包裹，禁止在 JSON 外写说明。
2. 所有字段值必须在双引号字符串内；字符串里每一个反斜杠 `\\` 只能用于合法 JSON 转义：
   `\\\\` `\\"` `\\/` `\\b` `\\f` `\\n` `\\r` `\\t` `\\uXXXX`（四位十六进制）。
3. **禁止**在字符串里写「单反斜杠 + 字母」的 LaTeX/路径，例如 \\sqrt \\alpha \\frac \\log \\times —— 在 JSON 里必须写成 **双反斜杠**：
   `\\\\sqrt` `\\\\alpha` `\\\\frac` `\\\\log n`。
4. **更推荐（减少出错）**：公式用 Unicode 或纯文字，不用反斜杠：
   - 好：`O(n log n)`、`√n`、`α≤β`、`时间复杂度 O(n^2)`
   - 好：`$O(n \\\\log n)$`（$ 内也须双反斜杠）
   - 坏：`\\sqrt{n}`、`\\alpha`（单反斜杠，解析必失败）
5. Windows 路径若出现，反斜杠一律写成 `\\\\`。
6. 禁止尾逗号；题量过多时 **宁可少题**，也要保证 JSON 完整闭合、可被 json.loads 解析。
7. 本批 questions 建议 **≤20 条**，避免输出过长被截断导致坏 JSON。"""

_JSON_RETRY_APPEND = """
【重要 · 上次输出无法解析】上次 JSON 在约第 31 行附近出现 Invalid \\escape（字符串内非法反斜杠）。
请本次严格遵守：
- stem / options / explanation 中 **不要** 使用单反斜杠 LaTeX；
- 一律改用 Unicode 或纯文字公式，或把每个 `\\` 写成 `\\\\`；
- 只输出可解析的 JSON，不要 markdown 代码块。"""


def _parse_prompt(
    *,
    page_start: int,
    page_end: int,
    source_filename: str,
    source_path: str,
    user_tags: list[str],
    text_block: str,
    vision: bool,
    json_retry_hint: bool = False,
) -> str:
    user_tag_line = "、".join(user_tags) if user_tags else "（无）"
    source_hint = "（看图识别，以下为页图）" if vision else text_block
    return f"""你是试卷解析助手。请根据以下 PDF 片段{"页面图片" if vision else "文本"}输出 JSON。

【来源信息（必须写入每题 metadata）】
- 文件名 source_pdf: {source_filename}
- 路径 source_path: {source_path}
- 页码范围: 第 {page_start}–{page_end} 页
- 用户已指定标签: {user_tag_line}

【PDF 内容】
{source_hint}

【输出格式】仅输出一个 JSON 对象，不要 markdown 代码块：
{{
  "pdf_tag": "大标签：整份 PDF 一个主题（2-6 字）",
  "questions": [
    {{
      "type": "single_choice | multiple_choice | coding | subjective",
      "title": "题号或短标题",
      "stem": "完整题干；公式优先 Unicode/纯文字，少用 LaTeX",
      "options": [{{"key": "A", "content": "..."}}],
      "answer": ["A"] 或主观题参考答案字符串,
      "explanation": "解析（可空）",
      "metadata": {{
        "difficulty": "easy | medium | hard",
        "source_pdf": "{source_filename}",
        "source_path": "{source_path}",
        "page": 题所在页码,
        "tag_group": "与大标签 pdf_tag 相同",
        "tags": ["小标签1", "小标签2"]
      }}
    }}
  ]
}}

要求：
- **必须逐题提取**：本片段内每一道题单独一条，含选择题、填空、判断、简答、计算、证明、**大题**；不得整页跳过。
- **题型**：有 A/B/C/D 选项用 single_choice 或 multiple_choice；编程用 coding；**无选项的简答/填空/大题/计算证明一律用 subjective**（options 设为 []）。
- 题干与选项尽量完整；看不清的字用 [?] 占位，但不要因此省略整题。
- **数学公式**：优先 `O(n log n)`、`√n` 等 **无反斜杠** 写法；若用 `$...$`，$ 内每个 LaTeX 反斜杠须写成 **双反斜杠**（如 `$O(n \\\\log n)$`），**禁止** `$\\sqrt{{n}}$` 这种单反斜杠形式。
- 代码题干用纯文本或 ``` 围栏描述，勿在 JSON 字符串里写未转义的 `\\`。
- pdf_tag / tag_group 只写一个大标签；metadata.tags 每题最多 2 个小标签。
- 每题必须有 source_pdf、source_path、page、tag_group、tags。
{_JSON_ESCAPE_RULES}
{"" if not json_retry_hint else _JSON_RETRY_APPEND}"""


def list_providers() -> list[dict]:
    keys = get_effective_keys()
    items = [
        {
            "id": "mock",
            "label": "Mock（无 Key 测试）",
            "model": "mock-v1",
            "available": True,
        },
    ]
    if keys["tongyi"]:
        items.append(
            {
                "id": "tongyi",
                "label": "通义千问",
                "model": settings.tongyi_model,
                "available": True,
            }
        )
    if keys["deepseek"]:
        items.append(
            {
                "id": "deepseek",
                "label": "DeepSeek",
                "model": settings.deepseek_model,
                "available": True,
            }
        )
    local = get_effective_local_llm()
    if local.get("model"):
        items.append(
            {
                "id": "local",
                "label": "本地模型 (Ollama 等)",
                "model": local["model"],
                "available": True,
            }
        )
    return items


async def complete_json_chat(
    provider: str,
    model: str | None,
    prompt: str,
    *,
    timeout: float = 120.0,
) -> Any:
    """OpenAI 兼容接口单次对话，尽量解析为 JSON 对象。"""
    keys = get_effective_keys()
    prov = (provider or "").strip()
    if prov == "mock":
        raise ValueError("Mock 不能用于 AI 单词补充，请配置本地或云端模型")
    if prov == "local":
        cfg = get_effective_local_llm()
        if not cfg.get("model"):
            raise ValueError("请先在「设置」中填写本地模型名称（如 qwen2.5:7b）")
        return await _post_chat_json(
            base_url=cfg["base_url"],
            api_key=cfg["api_key"],
            model=(model or cfg["model"]).strip(),
            prompt=prompt,
            images=None,
            timeout=timeout,
            json_mode=True,
            return_raw_on_fail=True,
        )
    if prov == "deepseek" and keys["deepseek"]:
        return await _post_chat_json(
            base_url="https://api.deepseek.com/v1",
            api_key=keys["deepseek"],
            model=(model or settings.deepseek_model).strip(),
            prompt=prompt,
            images=None,
            timeout=timeout,
            json_mode=True,
            return_raw_on_fail=True,
        )
    if prov == "tongyi" and keys["tongyi"]:
        return await _post_chat_json(
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            api_key=keys["tongyi"],
            model=(model or settings.tongyi_model).strip(),
            prompt=prompt,
            images=None,
            timeout=timeout,
            json_mode=True,
            return_raw_on_fail=True,
        )
    raise ValueError(f"模型不可用：{prov}（请在设置中配置 API Key 或本地模型）")


def _english_vocab_prompt(
    *,
    page_start: int,
    page_end: int,
    source_filename: str,
    text_block: str,
    vision: bool,
    unit_hint: str = "",
    book_hint: str = "",
    json_retry_hint: bool = False,
) -> str:
    book_line = book_hint.strip() or "（从 PDF 文件名或正文推断：基础词 / 必考词）"
    unit_line = unit_hint.strip() or "（未指定，可从 PDF 页眉/Unit 标题推断）"
    source_hint = "（看图识别词汇表，以下为页图）" if vision else text_block
    return f"""你是考研英语「默写单词」词汇表解析助手。请根据以下 PDF 片段{"页面图片" if vision else "文本"}，提取本页所有英文单词及中文释义，供默写练习入库。

【来源】
- 文件名: {source_filename}
- 页码: 第 {page_start}–{page_end} 页
- 书系（基础词 / 必考词，优先使用）: {book_line}
- Unit（优先使用）: {unit_line}

【PDF 内容】
{source_hint}

【输出格式】仅输出一个 JSON 对象，禁止 markdown 代码块：
{{
  "unit": "单元编号，如 15",
  "book": "基础词 或 必考词（与上方书系一致）",
  "words": [
    {{
      "word": "英文单词（原形，不要短语句子）",
      "meaning": "中文释义，可含词性如 v. 放弃；adj. 放弃的",
      "phonetic": "音标，可选，如 /əˈbændən/"
    }}
  ]
}}

要求：
- **本页出现的每一个词条都要提取**，含表格行、编号列表、两栏排版；不要整页跳过。
- word 只写英文单词；meaning 写中文；看不清用 [?] 占位。
- 忽略页眉页脚、纯页码、广告；不要输出重复 word。
- 本批 words 建议 ≤80 条；过多时保证 JSON 完整闭合。
{_JSON_ESCAPE_RULES}
{"" if not json_retry_hint else _JSON_RETRY_APPEND}"""


def _parse_words_payload(data: Any) -> tuple[list[dict[str, Any]], str]:
    unit = ""
    raw_words: list[Any] = []
    if isinstance(data, dict):
        unit = str(data.get("unit") or "").strip()
        raw_words = data.get("words") or data.get("items") or []
        if isinstance(raw_words, dict):
            raw_words = list(raw_words.values())
    elif isinstance(data, list):
        raw_words = data

    out: list[dict[str, Any]] = []
    if not isinstance(raw_words, list):
        return out, unit
    for item in raw_words:
        if isinstance(item, dict):
            w = str(item.get("word") or item.get("title") or "").strip()
            m = str(item.get("meaning") or item.get("definition") or "").strip()
            p = str(item.get("phonetic") or "").strip()
        elif isinstance(item, str) and "," in item:
            parts = item.split(",", 1)
            w, m = parts[0].strip(), parts[1].strip() if len(parts) > 1 else ""
            p = ""
        else:
            continue
        if w and re.search(r"[A-Za-z]", w):
            row: dict[str, Any] = {"word": w, "meaning": m}
            if p:
                row["phonetic"] = p
            out.append(row)
    return out, unit


async def parse_english_vocab_pdf_batch(
    provider: str,
    model: str | None,
    chunk_path: str,
    page_start: int,
    page_end: int,
    *,
    source_filename: str = "",
    unit_hint: str = "",
    book_hint: str = "",
    json_retry_hint: bool = False,
) -> dict[str, Any]:
    """复用 PDF 分批 + OpenAI 兼容接口，提示词改为提取默写单词。"""
    filename = source_filename or Path(chunk_path).name
    keys = get_effective_keys()
    pdf_text = _extract_chunk_text(chunk_path, page_start, page_end)
    text_len = len(pdf_text.strip())
    need_vision = text_len < settings.pdf_vision_text_threshold
    mode = "text"
    raw: Any = None

    def _prompt(vision: bool, text_block: str) -> str:
        return _english_vocab_prompt(
            page_start=page_start,
            page_end=page_end,
            source_filename=filename,
            text_block=text_block,
            vision=vision,
            unit_hint=unit_hint,
            book_hint=book_hint,
            json_retry_hint=json_retry_hint,
        )

    if provider == "mock":
        words = [
            {"word": "abandon", "meaning": "v. 放弃", "phonetic": "/əˈbændən/"},
            {"word": "inspect", "meaning": "v. 检查；视察"},
        ]
        return {
            "words": words,
            "unit": unit_hint or "1",
            "extract_mode": "mock",
            "text_chars": text_len,
        }

    if provider == "deepseek" and keys["deepseek"]:
        if need_vision:
            raise ValueError(
                "该 PDF 几乎无文本层。请改用「通义千问」（支持视觉识词）或换带可复制文字的词汇 PDF。"
            )
        raw = await _post_chat_json(
            base_url="https://api.deepseek.com/v1",
            api_key=keys["deepseek"],
            model=(model or settings.deepseek_model).strip(),
            prompt=_prompt(False, pdf_text if pdf_text else "（无文本层）"),
            images=None,
            timeout=180.0,
            json_mode=True,
            return_raw_on_fail=True,
        )
    elif provider == "tongyi" and keys["tongyi"]:
        base = "https://dashscope.aliyuncs.com/compatible-mode/v1"
        if need_vision:
            images = render_chunk_images_b64(chunk_path, max_pages=page_end - page_start + 1)
            if not images:
                raise ValueError("无法渲染 PDF 页图，请安装 pymupdf")
            raw = await _post_chat_json(
                base_url=base,
                api_key=keys["tongyi"],
                model=settings.tongyi_vision_model,
                prompt=_prompt(True, ""),
                images=images,
                timeout=360.0,
                json_mode=True,
                return_raw_on_fail=True,
            )
            mode = "vision"
        else:
            raw = await _post_chat_json(
                base_url=base,
                api_key=keys["tongyi"],
                model=(model or settings.tongyi_model).strip(),
                prompt=_prompt(False, pdf_text if pdf_text else "（无文本层）"),
                images=None,
                timeout=180.0,
                json_mode=True,
                return_raw_on_fail=True,
            )
    elif provider == "local":
        cfg = get_effective_local_llm()
        if not cfg.get("model"):
            raise ValueError("请先在设置中配置本地模型")
        if need_vision:
            raise ValueError("本地模型暂不支持扫描版 PDF，请用通义视觉或带文本层的 PDF")
        raw = await _post_chat_json(
            base_url=cfg["base_url"],
            api_key=cfg["api_key"],
            model=(model or cfg["model"]).strip(),
            prompt=_prompt(False, pdf_text if pdf_text else "（无文本层）"),
            images=None,
            timeout=180.0,
            json_mode=True,
            return_raw_on_fail=True,
        )
    else:
        raise ValueError(
            f"提供商不可用或未配置 Key: {provider}（默写 PDF 推荐 DeepSeek，请在设置页填写 Key）"
        )

    if isinstance(raw, dict) and raw.get("raw_text"):
        from app.services.word_dictation_import import parse_paste_lines

        words = parse_paste_lines(str(raw["raw_text"]))
        return {
            "words": words,
            "unit": unit_hint,
            "extract_mode": "fallback_text",
            "text_chars": text_len,
        }

    words, unit = _parse_words_payload(raw)
    book = ""
    if isinstance(raw, dict):
        book = str(raw.get("book") or "").strip()
    if unit_hint.strip():
        unit = unit_hint.strip()
    if book_hint.strip():
        book = book_hint.strip()
    for w in words:
        if book and not w.get("book"):
            w["book"] = book
        if unit and not w.get("unit"):
            w["unit"] = unit
    return {
        "words": words,
        "unit": unit,
        "book": book,
        "extract_mode": mode,
        "text_chars": text_len,
    }


def _extract_chunk_text(chunk_path: str, page_start: int, page_end: int) -> str:
    """Extract PDF text for one batch; limit scales with page count to reduce漏题."""
    path = Path(chunk_path)
    if not path.is_file():
        return ""
    try:
        reader = PdfReader(str(path))
        parts = [page.extract_text() or "" for page in reader.pages]
        text = "\n".join(parts).strip()
        if not text:
            return ""
        n_pages = max(1, page_end - page_start + 1)
        # 约 7k 字/页，上限 32k，避免多页一批时 14k 硬截断导致后半页题目丢失
        max_chars = min(32000, 7000 * n_pages)
        if len(text) > max_chars:
            text = (
                text[:max_chars]
                + f"\n\n[文本已截断：原长 {len(text)} 字，仅保留前 {max_chars} 字；"
                "请减小「每批页数」后重新导入该批次]"
            )
        return text
    except Exception:
        return ""


def _mock_questions(
    page_start: int,
    page_end: int,
    *,
    source_filename: str,
    source_path: str,
    user_tags: list[str],
) -> list[dict[str, Any]]:
    raw = [
        {
            "type": "single_choice",
            "title": f"示例单选（第 {page_start}–{page_end} 页）",
            "stem": r"已知 $f(x)=x^2$，则 $f'(2)=$",
            "options": [
                {"key": "A", "content": "$2$"},
                {"key": "B", "content": "$4$"},
                {"key": "C", "content": "$8$"},
                {"key": "D", "content": "$16$"},
            ],
            "answer": ["B"],
            "explanation": r"$f'(x)=2x$，故 $f'(2)=4$。",
            "metadata": {"difficulty": "easy", "page": page_start},
        },
        {
            "type": "coding",
            "title": "示例代码题",
            "stem": "读入两个整数，输出它们的和。",
            "answer": [],
            "language": "python",
            "explanation": "使用 `a+b` 即可。",
            "metadata": {"difficulty": "easy", "page": page_start},
        },
        {
            "type": "subjective",
            "title": "示例大题",
            "stem": "简述快速排序的基本思想。",
            "options": [],
            "answer": ["分治；选基准划分；递归排序"],
            "explanation": "",
            "metadata": {"difficulty": "medium", "page": page_start},
        },
    ]
    enriched, _ = enrich_questions(
        raw,
        source_filename=source_filename,
        source_path=source_path,
        user_tags=user_tags,
        page_start=page_start,
        page_end=page_end,
        pdf_tag=None,
    )
    return enriched


def _parse_model_payload(data: Any) -> tuple[list[dict[str, Any]], str | None]:
    pdf_tag: str | None = None
    if isinstance(data, dict):
        pdf_tag = data.get("pdf_tag") or data.get("batch_tag")
        if isinstance(pdf_tag, str):
            pdf_tag = pdf_tag.strip() or None
        questions = data.get("questions")
        if questions is None and "type" in data:
            return [data], pdf_tag
        if not isinstance(questions, list):
            raise ValueError("模型返回缺少 questions 数组")
        return questions, pdf_tag
    if isinstance(data, list):
        return data, None
    raise ValueError("模型返回不是题目数组")


async def parse_pdf_batch(
    provider: str,
    model: str | None,
    chunk_path: str,
    page_start: int,
    page_end: int,
    *,
    source_filename: str = "",
    source_path: str = "",
    user_tags: list[str] | None = None,
    json_retry_hint: bool = False,
) -> dict[str, Any]:
    """Parse a PDF chunk; returns questions + pdf_tag for task tagging."""
    tags = user_tags or []
    filename = source_filename or Path(chunk_path).name
    path = source_path or str(Path(chunk_path).resolve())

    if provider == "mock":
        questions = _mock_questions(
            page_start,
            page_end,
            source_filename=filename,
            source_path=path,
            user_tags=tags,
        )
        questions, pdf_tag = enrich_questions(
            questions,
            source_filename=filename,
            source_path=path,
            user_tags=tags,
            page_start=page_start,
            page_end=page_end,
        )
        return {
            "questions": questions,
            "pdf_tag": pdf_tag,
            "extract_mode": "mock",
            "text_chars": 0,
            "zero_hint": None,
        }

    keys = get_effective_keys()
    text_len = len(_extract_chunk_text(chunk_path, page_start, page_end).strip())
    need_vision = text_len < settings.pdf_vision_text_threshold
    mode = "text"
    raw: Any = None

    if provider == "deepseek" and keys["deepseek"]:
        if need_vision:
            raise ValueError(
                "该 PDF 几乎无文本层（扫描版/做题本）。请改用「通义千问」以启用视觉识别。"
            )
        raw = await _call_openai_compat(
            base_url="https://api.deepseek.com/v1",
            api_key=keys["deepseek"],
            model=model or settings.deepseek_model,
            chunk_path=chunk_path,
            page_start=page_start,
            page_end=page_end,
            source_filename=filename,
            source_path=path,
            user_tags=tags,
            json_retry_hint=json_retry_hint,
        )
    elif provider == "tongyi" and keys["tongyi"]:
        base = "https://dashscope.aliyuncs.com/compatible-mode/v1"
        if need_vision:
            raw = await _call_vision_openai_compat(
                base_url=base,
                api_key=keys["tongyi"],
                model=settings.tongyi_vision_model,
                chunk_path=chunk_path,
                page_start=page_start,
                page_end=page_end,
                source_filename=filename,
                source_path=path,
                user_tags=tags,
                json_retry_hint=json_retry_hint,
            )
            mode = "vision"
        else:
            raw = await _call_openai_compat(
                base_url=base,
                api_key=keys["tongyi"],
                model=model or settings.tongyi_model,
                chunk_path=chunk_path,
                page_start=page_start,
                page_end=page_end,
                source_filename=filename,
                source_path=path,
                user_tags=tags,
                json_retry_hint=json_retry_hint,
            )
    else:
        raise ValueError(f"提供商不可用或未配置 Key: {provider}")

    json_salvaged = bool(isinstance(raw, dict) and raw.pop("_json_salvaged", False))
    questions, pdf_tag = _parse_model_payload(raw)
    questions = _normalize_questions(questions)

    if (
        not questions
        and mode == "text"
        and need_vision
        and provider == "tongyi"
        and keys["tongyi"]
    ):
        raw = await _call_vision_openai_compat(
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            api_key=keys["tongyi"],
            model=settings.tongyi_vision_model,
            chunk_path=chunk_path,
            page_start=page_start,
            page_end=page_end,
            source_filename=filename,
            source_path=path,
            user_tags=tags,
        )
        mode = "vision"
        raw2 = raw
        json_salvaged = json_salvaged or bool(
            isinstance(raw2, dict) and raw2.pop("_json_salvaged", False)
        )
        questions, pdf_tag = _parse_model_payload(raw2)
        questions = _normalize_questions(questions)

    questions, pdf_tag = enrich_questions(
        questions,
        source_filename=filename,
        source_path=path,
        user_tags=tags,
        page_start=page_start,
        page_end=page_end,
        pdf_tag=pdf_tag,
    )
    hint = _zero_hint(mode, text_len, len(questions))
    if json_salvaged and questions:
        salvage_note = "模型 JSON 不完整，已尽力恢复部分题目，请核对本批"
        hint = f"{hint}；{salvage_note}" if hint else salvage_note
    return {
        "questions": questions,
        "pdf_tag": pdf_tag,
        "extract_mode": mode,
        "text_chars": text_len,
        "zero_hint": hint,
        "json_salvaged": json_salvaged,
    }


async def _call_openai_compat(
    base_url: str,
    api_key: str,
    model: str,
    chunk_path: str,
    page_start: int,
    page_end: int,
    source_filename: str,
    source_path: str,
    user_tags: list[str],
    *,
    json_retry_hint: bool = False,
) -> Any:
    pdf_text = _extract_chunk_text(chunk_path, page_start, page_end)
    text_block = pdf_text if pdf_text else "（无文本层）"
    prompt = _parse_prompt(
        page_start=page_start,
        page_end=page_end,
        source_filename=source_filename,
        source_path=source_path,
        user_tags=user_tags,
        text_block=text_block,
        vision=False,
        json_retry_hint=json_retry_hint,
    )
    return await _post_chat_json(
        base_url=base_url,
        api_key=api_key,
        model=model,
        prompt=prompt,
        images=None,
        timeout=120.0,
        json_mode=True,
    )


async def _call_vision_openai_compat(
    base_url: str,
    api_key: str,
    model: str,
    chunk_path: str,
    page_start: int,
    page_end: int,
    source_filename: str,
    source_path: str,
    user_tags: list[str],
    *,
    json_retry_hint: bool = False,
) -> Any:
    images = render_chunk_images_b64(chunk_path, max_pages=page_end - page_start + 1)
    if not images:
        raise ValueError(
            "PDF 无文本层且无法渲染页图。请安装 pymupdf：pip install pymupdf，并重启 Drillly API。"
        )
    prompt = _parse_prompt(
        page_start=page_start,
        page_end=page_end,
        source_filename=source_filename,
        source_path=source_path,
        user_tags=user_tags,
        text_block="",
        vision=True,
        json_retry_hint=json_retry_hint,
    )
    return await _post_chat_json(
        base_url=base_url,
        api_key=api_key,
        model=model,
        prompt=prompt,
        images=images,
        timeout=360.0,
        json_mode=True,
    )


async def _post_chat_json(
    *,
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    images: list[str] | None,
    timeout: float,
    json_mode: bool = False,
    return_raw_on_fail: bool = False,
) -> Any:
    if images:
        # 通义 VL：先图后文；须把 content 放进 messages（此前误发纯文本导致 400）
        content: list[dict[str, Any]] = []
        for b64 in images:
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                }
            )
        content.append({"type": "text", "text": prompt})
        messages = [{"role": "user", "content": content}]
        max_tokens = 16384
    else:
        messages = [{"role": "user", "content": prompt}]
        max_tokens = 16384

    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": 0.05,
        "max_tokens": max_tokens,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.post(
            f"{base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json=payload,
        )
        if r.status_code >= 400 and json_mode:
            payload.pop("response_format", None)
            r = await client.post(
                f"{base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json=payload,
            )
        if r.status_code >= 400:
            detail = (r.text or "")[:800]
            raise ValueError(
                f"模型 API {r.status_code}（{model}）：{detail or r.reason_phrase}"
            )
        r.raise_for_status()
        text = r.json()["choices"][0]["message"]["content"]
    try:
        return _loads_json_loose(text)
    except json.JSONDecodeError:
        if return_raw_on_fail:
            return {"raw_text": (text or "").strip()}
        raise


def _fix_json_invalid_escapes(text: str) -> str:
    """修复 JSON 字符串内非法反斜杠（如 LaTeX \\sqrt、\\alpha）。"""
    out: list[str] = []
    i = 0
    in_string = False
    while i < len(text):
        ch = text[i]
        if ch == '"':
            bs = 0
            j = i - 1
            while j >= 0 and text[j] == "\\":
                bs += 1
                j -= 1
            if bs % 2 == 0:
                in_string = not in_string
            out.append(ch)
            i += 1
            continue
        if in_string and ch == "\\" and i + 1 < len(text):
            nxt = text[i + 1]
            if nxt == "u" and i + 5 < len(text):
                hexpart = text[i + 2 : i + 6]
                valid_u = len(hexpart) == 4 and all(
                    c in "0123456789abcdefABCDEF" for c in hexpart
                )
            else:
                valid_u = False
            valid = nxt in '"\\/bfnrt' or valid_u
            if not valid:
                out.append("\\\\")
                i += 1
                continue
        out.append(ch)
        i += 1
    return "".join(out)


def _repair_json_text(text: str) -> str:
    """常见 LLM JSON 瑕疵：尾逗号、控制字符、非法转义、截断。"""
    t = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    t = _fix_json_invalid_escapes(t)
    t = re.sub(r",\s*}", "}", t)
    t = re.sub(r",\s*]", "]", t)
    return t


def _extract_balanced_bracket(s: str, open_ch: str, close_ch: str, start: int) -> str | None:
    if start >= len(s) or s[start] != open_ch:
        return None
    depth = 0
    in_str = False
    escape = False
    for i in range(start, len(s)):
        c = s[i]
        if escape:
            escape = False
            continue
        if c == "\\" and in_str:
            escape = True
            continue
        if c == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return s[start : i + 1]
    return None


def _salvage_questions_from_text(text: str) -> list[dict[str, Any]]:
    """模型返回超长/损坏 JSON 时，尽量捞出 questions 数组里的完整题目对象。"""
    m = re.search(r'"questions"\s*:\s*\[', text, re.IGNORECASE)
    if not m:
        return []
    arr_start = m.end() - 1
    arr_body = _extract_balanced_bracket(text, "[", "]", arr_start)
    if not arr_body:
        partial = text[arr_start:]
        last_brace = partial.rfind("}")
        if last_brace > 1:
            arr_body = partial[: last_brace + 1] + "]"
        else:
            return []

    repaired = _repair_json_text(arr_body)
    try:
        items = json.loads(repaired)
        if isinstance(items, list):
            return [x for x in items if isinstance(x, dict)]
    except json.JSONDecodeError:
        pass

    # 按「}, {」切分对象（题干里一般没有该模式）
    inner = repaired.strip()[1:-1].strip()
    if not inner:
        return []
    chunks = re.split(r"\}\s*,\s*\{", inner)
    out: list[dict[str, Any]] = []
    for i, ch in enumerate(chunks):
        piece = ch.strip()
        if i > 0:
            piece = "{" + piece
        if i < len(chunks) - 1:
            piece = piece + "}"
        elif not piece.endswith("}"):
            piece = piece + "}"
        piece = _repair_json_text(piece)
        try:
            obj = json.loads(piece)
            if isinstance(obj, dict) and (obj.get("stem") or obj.get("title")):
                out.append(obj)
        except json.JSONDecodeError:
            continue
    return out


def _loads_json_loose(text: str) -> Any:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

    fixed = _fix_json_invalid_escapes(text)
    attempts = [
        _repair_json_text(fixed),
        fixed,
        _repair_json_text(text),
        text,
    ]
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        slice_raw = text[start : end + 1]
        slice_fixed = _fix_json_invalid_escapes(slice_raw)
        attempts.append(_repair_json_text(slice_fixed))
        attempts.append(_repair_json_text(slice_raw))

    seen: set[str] = set()
    last_err: json.JSONDecodeError | None = None
    for candidate in attempts:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        try:
            return json.loads(candidate)
        except json.JSONDecodeError as e:
            last_err = e

    for salvage_src in (fixed, text):
        salvaged = _salvage_questions_from_text(salvage_src)
        if salvaged:
            break
    else:
        salvaged = []
    if salvaged:
        pdf_tag = None
        tm = re.search(r'"pdf_tag"\s*:\s*"([^"]*)"', salvage_src)
        if tm:
            pdf_tag = tm.group(1).strip() or None
        return {"questions": salvaged, "pdf_tag": pdf_tag, "_json_salvaged": True}

    if last_err:
        raise last_err
    raise json.JSONDecodeError("无法解析模型 JSON", text, 0)


async def parse_pdf_batch_resilient(
    *args: Any,
    max_attempts: int = 3,
    **kwargs: Any,
) -> dict[str, Any]:
    """Retry on network/JSON errors with backoff."""
    last: Exception | None = None
    for attempt in range(max_attempts):
        try:
            return await parse_pdf_batch(
                *args, **kwargs, json_retry_hint=attempt > 0
            )
        except (
            httpx.HTTPError,
            httpx.TimeoutException,
            json.JSONDecodeError,
            ValueError,
            KeyError,
        ) as e:
            last = e
            if attempt + 1 >= max_attempts:
                break
            await asyncio.sleep(2**attempt)
    assert last is not None
    raise last


def _zero_hint(mode: str, text_chars: int, question_count: int) -> str | None:
    if question_count > 0:
        return None
    if mode == "vision":
        return "视觉识别未抽到题目，可能该页无题或版式特殊"
    if text_chars < settings.pdf_vision_text_threshold:
        return "文本层为空（扫描版），已尝试视觉；若仍为 0 请检查通义 Key 与 qwen-vl 模型"
    return "文本过短或模型返回空 questions，可改为每批 1 页重试"
