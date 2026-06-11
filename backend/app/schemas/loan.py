from datetime import date

from pydantic import BaseModel, Field


class SplitParticipant(BaseModel):
    contact_id: int
    share: int = Field(ge=0)


class SplitCreateRequest(BaseModel):
    wallet_id: int
    category_id: int | None = None
    merchant_id: int | None = None
    amount: int = Field(gt=0)
    currency_code: str
    occurred_on: date
    note: str = ""
    is_recurring: bool = False
    recurrence_period_days: int | None = None
    recurrence_source_id: int | None = None
    my_share: int = Field(ge=0)
    participants: list[SplitParticipant] = Field(min_length=1)


class LoanAccountView(BaseModel):
    contact_id: int
    contact_name: str
    currency_code: str
    balance: int
    loan_out_total: int
    loan_repayment_total: int


class RepaymentRequest(BaseModel):
    contact_id: int
    currency_code: str
    wallet_id: int
    amount: int = Field(gt=0)
    occurred_on: date
    note: str = ""


class WriteOffRequest(BaseModel):
    contact_id: int
    currency_code: str
    wallet_id: int
    amount: int = Field(gt=0)
    occurred_on: date
    note: str = ""
