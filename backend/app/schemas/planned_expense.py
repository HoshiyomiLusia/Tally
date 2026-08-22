from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class PlannedExpenseCreate(BaseModel):
    name: str = Field(max_length=64)
    amount: int = Field(gt=0, le=1_000_000_000_000)
    currency_code: str
    due_date: date | None = None
    note: str = Field(default="", max_length=256)


class PlannedExpenseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    amount: int
    currency_code: str
    due_date: date | None
    note: str
