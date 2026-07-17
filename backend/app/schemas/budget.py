from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

BudgetPeriod = Literal["monthly", "yearly"]


class BudgetCreate(BaseModel):
    category_id: int | None = None
    currency_code: str
    period: BudgetPeriod = "monthly"
    # 审计#71: 加上界防溢出
    amount: int = Field(gt=0, le=1_000_000_000_000)
    note: str = ""


class BudgetUpdate(BaseModel):
    # 审计#70: 补 Create 丢失的 gt=0 (否则 PATCH 负预算使 budget_progress 的 percent/remaining 成垃圾值); 审计#71 加上界
    amount: int | None = Field(default=None, gt=0, le=1_000_000_000_000)
    active: bool | None = None
    note: str | None = None


class BudgetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category_id: int | None
    currency_code: str
    period: BudgetPeriod
    amount: int
    active: bool
    note: str


class BudgetProgress(BaseModel):
    budget_id: int
    category_id: int | None
    category_name: str
    currency_code: str
    period: BudgetPeriod
    budget_amount: int
    spent: int
    remaining: int
    percent: float
