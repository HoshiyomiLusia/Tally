from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ContactCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    color: str = ""
    note: str = ""


class ContactUpdate(BaseModel):
    # 审计#70: 对齐 Create 的 max_length=64, 防改档时写入超长名
    name: str | None = Field(default=None, max_length=64)
    color: str | None = None
    note: str | None = None
    archived: bool | None = None


class ContactRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    color: str
    note: str
    archived: bool
    created_at: datetime
