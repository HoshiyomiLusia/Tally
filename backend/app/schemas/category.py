from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

CategoryKind = Literal["expense", "income"]


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    parent_id: int | None = None
    kind: CategoryKind = "expense"
    emoji: str = ""
    color: str = ""
    sort_order: int = 0


class CategoryUpdate(BaseModel):
    # 审计#70: 对齐 Create 的 max_length=64, 防改档时写入超长名
    name: str | None = Field(default=None, max_length=64)
    parent_id: int | None = None
    emoji: str | None = None
    color: str | None = None
    sort_order: int | None = None


class CategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    parent_id: int | None
    kind: CategoryKind
    emoji: str
    color: str
    sort_order: int
