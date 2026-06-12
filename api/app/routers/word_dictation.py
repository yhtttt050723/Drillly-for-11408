from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.english_vocab_ledger import clear_all_records
from app.services.english_vocab_inbox import restore_inbox_from_processed
from app.services.word_dictation_import import (
    delete_all_words,
    import_from_pdf_questions,
    import_from_study,
    import_paste,
    preview_import,
)
from app.services.word_crud import (
    clear_word_wrong,
    create_word,
    delete_word,
    get_word,
    list_word_books,
    list_word_unit_tags,
    list_word_units,
    list_words,
    mark_word_wrong,
    reset_word_practice,
    update_word,
)
from app.services.word_tags import (
    list_word_tag_catalog,
    merge_word_entries,
    merge_word_tag_names,
    set_word_tags,
)
from app.services.word_study_time import (
    end_session,
    get_stats,
    get_today_stats,
    merge_into_daily_journal,
    start_session,
    sync_board_file,
    tick_session,
)
from app.services.word_wrong import word_wrong_stats
from app.services.word_llm import fetch_ollama_model_names, suggest_words

router = APIRouter(prefix="/api/words", tags=["words"])


class WordPasteImportBody(BaseModel):
    text: str = Field(..., description="每行一词或 word,释义")
    unit: str = Field("", description="Unit 编号，如 15")
    tag_group: str = Field("英语", description="主题大标签")
    source_label: str = Field("", description="出处说明")
    small_tags: list[str] = Field(default_factory=list)


class WordPdfImportBody(BaseModel):
    source_pdf: str = Field("", description="限定 PDF 来源文件名，空=全部英语相关题")
    tag_group: str = Field("英语")
    source_label: str = Field("")
    small_tags: list[str] = Field(default_factory=list)


class WordStudyImportBody(BaseModel):
    tag_group: str = Field("英语")
    source_label: str = Field("")
    small_tags: list[str] = Field(default_factory=list)


class WordSuggestBody(BaseModel):
    message: str = Field(..., description="补充需求，如：Unit15 形近词再补 8 个")
    provider: str | None = Field(None, description="local / tongyi / deepseek，空=设置默认")
    model: str | None = Field(None, description="覆盖默认模型名")
    unit: str = Field("", description="导入时写入 Unit 编号")
    context: str = Field("", description="已有词表，避免重复")
    auto_import: bool = Field(True, description="为 true 时直接写入默写词库")


class WordCreateBody(BaseModel):
    word: str
    meaning: str = ""
    unit: str = ""
    book: str = ""
    phonetic: str = ""
    hint: str = ""
    source_label: str = ""


class WordPatchBody(BaseModel):
    word: str | None = None
    meaning: str | None = None
    unit: str | None = None
    book: str | None = None
    phonetic: str | None = None
    hint: str | None = None
    source_label: str | None = None


class WordTagsBody(BaseModel):
    book: str = ""
    unit: str = ""
    small_tags: list[str] = Field(default_factory=list)
    keep_wrong_tag: bool = True


class WordMergeTagsBody(BaseModel):
    from_name: str = Field(..., description="小标签名，如 Unit15")
    to_name: str = Field(..., description="合并为")


class WordMergeEntriesBody(BaseModel):
    target_id: int
    source_id: int


class WordClearAllBody(BaseModel):
    clear_inbox_ledger: bool = True
    restore_inbox_pdfs: bool = True


class WordStudySessionBody(BaseModel):
    book: str = ""
    unit: str = ""


class WordStudyTickBody(BaseModel):
    delta_sec: int = Field(15, ge=1, le=120)
    book: str = ""
    unit: str = ""
    words_done_delta: int = Field(0, ge=0)


class WordStudyEndBody(BaseModel):
    sync_journal: bool = False


class WordStudyJournalBody(BaseModel):
    date: str = ""
    minutes: int = Field(0, ge=0)
    label: str = ""


@router.post("/clear-all/")
def post_clear_all_words(body: WordClearAllBody, db: Session = Depends(get_db)):
    """清空默写词库；可选重置英文 PDF 收件箱记录并移回 PDF。"""
    result = delete_all_words(db)
    if body.clear_inbox_ledger:
        result["ledger_cleared"] = clear_all_records()
    if body.restore_inbox_pdfs:
        result["inbox_restore"] = restore_inbox_from_processed()
    result["word_dictation_in_db"] = 0
    return result


@router.get("/")
def get_words(
    db: Session = Depends(get_db),
    q: str = "",
    unit: str = "",
    book: str = "",
    tag: str = "",
    wrong_only: str = "",
    limit: int = Query(50, ge=1, le=500),
    offset: int = 0,
):
    return list_words(
        db,
        q=q,
        unit=unit,
        book=book,
        tag=tag,
        wrong_only=wrong_only,
        limit=limit,
        offset=max(offset, 0),
    )


class WordResetPracticeBody(BaseModel):
    book: str = ""
    unit: str = ""
    tag: str = ""


@router.get("/unit-tags/")
def get_word_unit_tags(
    db: Session = Depends(get_db),
    book: str = "",
    unit: str = "",
):
    return {"tags": list_word_unit_tags(db, book=book, unit=unit)}


@router.post("/reset-practice/")
def post_reset_word_practice(body: WordResetPracticeBody, db: Session = Depends(get_db)):
    """重刷：归档后清除一刷/二刷标记（提交记录保留）。"""
    if not (body.book.strip() or body.unit.strip() or body.tag.strip()):
        raise HTTPException(400, "请指定 book、unit 或 tag 范围")
    return reset_word_practice(
        db,
        book=body.book.strip(),
        unit=body.unit.strip(),
        tag=body.tag.strip(),
    )


@router.get("/tags/catalog/")
def get_word_tags_catalog(db: Session = Depends(get_db)):
    return list_word_tag_catalog(db)


@router.get("/wrong-stats/")
def get_word_wrong_stats(db: Session = Depends(get_db)):
    return word_wrong_stats(db)


@router.post("/study-session/start/")
def post_word_study_start(body: WordStudySessionBody):
    return start_session(book=body.book, unit=body.unit)


@router.post("/study-session/tick/")
def post_word_study_tick(body: WordStudyTickBody):
    return tick_session(
        delta_sec=body.delta_sec,
        book=body.book,
        unit=body.unit,
        words_done_delta=body.words_done_delta,
    )


@router.post("/study-session/end/")
def post_word_study_end(body: WordStudyEndBody):
    return end_session(sync_journal=body.sync_journal)


@router.get("/study-session/today/")
def get_word_study_today():
    return get_today_stats()


@router.get("/study-session/stats/")
def get_word_study_stats(days: int = 14):
    return get_stats(days=days)


@router.get("/daily-stats/")
def get_word_daily_stats(db: Session = Depends(get_db), days: int = Query(14, ge=1, le=90)):
    from app.services.daily_word_stats import get_daily_word_stats

    return get_daily_word_stats(db, days=days)


@router.post("/study-session/sync-board/")
def post_word_study_sync_board():
    path = sync_board_file()
    return {"ok": True, "board_file": str(path)}


@router.post("/study-session/sync-journal/")
def post_word_study_sync_journal(body: WordStudyJournalBody):
    stats = get_today_stats()
    minutes = body.minutes or stats["today_minutes"]
    label = body.label.strip() or "英语·背词 Drillly"
    return merge_into_daily_journal(
        minutes=minutes,
        label=label,
        date_str=body.date.strip() or None,
    )


@router.post("/tags/merge/")
def post_merge_word_tags(body: WordMergeTagsBody, db: Session = Depends(get_db)):
    try:
        return merge_word_tag_names(db, from_name=body.from_name, to_name=body.to_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/merge/")
def post_merge_word_entries(body: WordMergeEntriesBody, db: Session = Depends(get_db)):
    try:
        return merge_word_entries(
            db, target_id=body.target_id, source_id=body.source_id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/units/")
def get_word_units(db: Session = Depends(get_db)):
    return {"units": list_word_units(db)}


@router.get("/books/")
def get_word_books(db: Session = Depends(get_db)):
    return {"books": list_word_books(db)}


@router.get("/preview/")
def get_preview(db: Session = Depends(get_db)):
    return preview_import(db)


@router.post("/import-paste/")
def run_import_paste(body: WordPasteImportBody, db: Session = Depends(get_db)):
    if not body.text.strip():
        raise HTTPException(400, "text 不能为空")
    return import_paste(
        db,
        text=body.text,
        unit=body.unit.strip(),
        tag_group=body.tag_group.strip(),
        source_label=body.source_label.strip(),
        small_tags=body.small_tags,
    )


@router.post("/import-study/")
def run_import_study(body: WordStudyImportBody, db: Session = Depends(get_db)):
    return import_from_study(
        db,
        tag_group=body.tag_group.strip(),
        source_label=body.source_label.strip(),
        small_tags=body.small_tags,
    )


@router.post("/import-pdf/")
def run_import_pdf(body: WordPdfImportBody, db: Session = Depends(get_db)):
    return import_from_pdf_questions(
        db,
        source_pdf=body.source_pdf.strip(),
        tag_group=body.tag_group.strip(),
        source_label=body.source_label.strip(),
        small_tags=body.small_tags,
    )


@router.post("/suggest/")
async def run_word_suggest(body: WordSuggestBody, db: Session = Depends(get_db)):
    try:
        return await suggest_words(
            db,
            message=body.message,
            provider=body.provider,
            model=body.model,
            unit=body.unit.strip(),
            context=body.context,
            auto_import=body.auto_import,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/local-models/")
async def get_local_models():
    return {"models": await fetch_ollama_model_names()}


@router.get("/{word_id}/")
def get_word_by_id(word_id: int, db: Session = Depends(get_db)):
    return get_word(db, word_id)


@router.post("/")
def post_word(body: WordCreateBody, db: Session = Depends(get_db)):
    try:
        return create_word(
            db,
            word=body.word,
            meaning=body.meaning,
            unit=body.unit,
            book=body.book,
            phonetic=body.phonetic,
            hint=body.hint,
            source_label=body.source_label,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.patch("/{word_id}/")
def patch_word(word_id: int, body: WordPatchBody, db: Session = Depends(get_db)):
    try:
        return update_word(
            db,
            word_id,
            word=body.word,
            meaning=body.meaning,
            unit=body.unit,
            book=body.book,
            phonetic=body.phonetic,
            hint=body.hint,
            source_label=body.source_label,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.put("/{word_id}/tags/")
def put_word_tags(word_id: int, body: WordTagsBody, db: Session = Depends(get_db)):
    try:
        return set_word_tags(
            db,
            word_id,
            book=body.book,
            unit=body.unit,
            small_tags=body.small_tags,
            keep_wrong_tag=body.keep_wrong_tag,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/{word_id}/mark-wrong/")
def post_mark_word_wrong(word_id: int, db: Session = Depends(get_db)):
    return mark_word_wrong(db, word_id)


@router.post("/{word_id}/clear-wrong/")
def post_clear_word_wrong(word_id: int, db: Session = Depends(get_db)):
    return clear_word_wrong(db, word_id)


@router.delete("/{word_id}/")
def remove_word(word_id: int, db: Session = Depends(get_db)):
    return delete_word(db, word_id)
