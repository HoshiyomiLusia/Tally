from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

BudgetPeriod = Literal["monthly", "yearly"]


class BudgetCreate(BaseModel):
    category_id: int | None = None
    currency_code: str
    period: BudgetPeriod = "monthly"
    amount: int = Field(gt=0)
    note: str = ""


class BudgetUpdate(BaseModel):
    amount: int | None = None
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
