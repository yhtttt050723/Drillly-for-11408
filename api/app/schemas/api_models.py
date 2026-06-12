from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class TagOut(BaseModel):
    id: int
    name: str
    color: str

    model_config = {"from_attributes": True}


class TagCreate(BaseModel):
    name: str
    color: str = "#64748b"


class CategoryOut(BaseModel):
    id: int
    name: str
    color: str
    sort_order: int
    parent_id: int | None

    model_config = {"from_attributes": True}


class CategoryCreate(BaseModel):
    name: str
    color: str = "#2563eb"
    sort_order: int = 0
    parent_id: int | None = None


class PracticeStateOut(BaseModel):
    round1: bool = False
    round2: bool = False
    source_pdf: str = ""


class QuestionOut(BaseModel):
    id: int
    bank_id: int | None
    category_id: int | None
    type: str
    content: dict[str, Any]
    status: str
    tags: list[TagOut] = []
    category: CategoryOut | None = None
    practice: PracticeStateOut | None = None

    model_config = {"from_attributes": True}


class QuestionCreate(BaseModel):
    bank_id: int | None = None
    category_id: int | None = None
    type: str
    content: dict[str, Any]
    tag_ids: list[int] = Field(default_factory=list)


class QuestionPatch(BaseModel):
    type: str | None = None
    category_id: int | None = None
    content: dict[str, Any] | None = None
    tag_ids: list[int] | None = None


class SubmitBody(BaseModel):
    question_id: int
    answer: dict[str, Any]
    language: str | None = None
    duration_ms: int | None = None
    practice_round: int | None = None


class PracticeProgressBody(BaseModel):
    round: int
    done: bool = True


class SubmissionOut(BaseModel):
    id: int
    question_id: int
    answer: dict[str, Any]
    score: float
    is_correct: bool
    duration_ms: int | None
    created_at: datetime

    model_config = {"from_attributes": True}


class SubmitAnswerOut(BaseModel):
    submission: SubmissionOut
    practice: PracticeStateOut | None = None


class PracticeProgressUpdateOut(BaseModel):
    ok: bool = True
    question_id: int
    practice: PracticeStateOut


class RunnerExecuteBody(BaseModel):
    language: str
    code: str
    stdin: str = ""


class RunnerExecuteOut(BaseModel):
    stdout: str
    stderr: str
    exit_code: int
    timed_out: bool = False


class ParseBatchBody(BaseModel):
    provider: str = "mock"
    model: str | None = None


class ProviderOut(BaseModel):
    id: str
    label: str
    model: str
    available: bool
