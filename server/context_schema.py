from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID
from urllib.parse import urlparse
from pydantic import BaseModel, Field, field_validator, model_validator

SelectionMode = Literal["selection", "region", "page"]
ContentFormat = Literal["markdown", "json"]

class SourceInfo(BaseModel):
    site: str = Field(min_length=1)
    url: str
    title: str = Field(min_length=1)
    captured_at: datetime

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("url must be an absolute HTTP(S) URL")
        return value

class SelectionInfo(BaseModel):
    mode: SelectionMode
    heading: str = ""
    text: str = Field(min_length=1)

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("text must not be blank")
        return value

class ContentInfo(BaseModel):
    format: ContentFormat
    text: str = Field(min_length=1)
    blocks: list[dict] = Field(default_factory=list)

class PrivacyInfo(BaseModel):
    redacted_fields: list[str] = Field(default_factory=list)

class ContextEnvelope(BaseModel):
    schema_version: Literal["1.0"]
    source: SourceInfo
    selection: SelectionInfo
    content: ContentInfo
    privacy: PrivacyInfo = Field(default_factory=PrivacyInfo)

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: ContentInfo) -> ContentInfo:
        if not value.text.strip():
            raise ValueError("content text must not be blank")
        return value


ResponseLanguage = Literal['zh-CN', 'zh-TW', 'en', 'bilingual']


class TaskItem(BaseModel):
    id: str = Field(pattern=r'^[a-zA-Z0-9-]{1,64}$')
    number: int = Field(ge=1, le=20)
    source: SourceInfo
    mode: SelectionMode
    content: str = Field(min_length=1, max_length=100000)
    purpose: str = Field(max_length=1000)
    instruction: str = Field(max_length=2000)
    response_language: ResponseLanguage
    reference: bool = False

    @model_validator(mode='after')
    def validate_task(self):
        if not self.content.strip():
            raise ValueError('Empty material')
        if not self.reference and (not self.purpose.strip() or not self.instruction.strip()):
            raise ValueError('Task requires purpose and instruction')
        if len(self.source.url) > 8192 or len(self.source.title) > 2000:
            raise ValueError('Source metadata too long')
        return self


class TaskBatch(BaseModel):
    schema_version: Literal['2.0']
    kind: Literal['task_batch']
    request_id: UUID
    created_at: datetime
    response_language: ResponseLanguage
    overall_instruction: str = Field(default='', max_length=4000)
    items: list[TaskItem] = Field(min_length=1, max_length=20)

    @model_validator(mode='after')
    def validate_items(self):
        if len({item.id for item in self.items}) != len(self.items):
            raise ValueError('Duplicate material IDs')
        if [item.number for item in self.items] != list(range(1, len(self.items)+1)):
            raise ValueError('Material numbers must follow batch order')
        if sum(len(item.content) for item in self.items) > 200000:
            raise ValueError('Batch exceeds 200000 characters')
        return self


ApprovedContext = Annotated[ContextEnvelope | TaskBatch, Field(discriminator='schema_version')]
