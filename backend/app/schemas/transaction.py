from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

TransactionKind = Literal["expense", "income", "transfer"]


class TransactionCreate(BaseModel):
    wallet_id: int
    category_id: int | None = None
    merchant_id: int | None = None
    amount: int
    currency_code: str
    kind: TransactionKind = "expense"
    occurred_on: date
    note: str = ""


class TransactionUpdate(BaseModel):
    wallet_id: int | None = None
    category_id: int | None = None
    merchant_id: int | None = None
    amount: int | None = None
    kind: TransactionKind | None = None
    occurred_on: date | None = None
    note: str | None = None


class TransactionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    wallet_id: int
    category_id: int | None
    merchant_id: int | None
    amount: int
    currency_code: str
    kind: TransactionKind
    occurred_on: date
    note: str
    created_at: datetime


class TransactionFilter(BaseModel):
    start: date | None = None
    end: date | None = None
    wallet_id: int | None = None
    category_id: int | None = None
    currency_code: str | None = None
    kind: TransactionKind | None = None
    q: str | None = None
    limit: int = Field(default=100, ge=1, le=500)
    offset: int = 0
