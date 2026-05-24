from datetime import date

from pydantic import BaseModel, Field


class ReconciliationView(BaseModel):
    wallet_id: int
    currency_code: str
    system_balance: int
    loan_out_on_wallet: int
    loan_repayment_on_wallet: int
    expected_physical: int


class ReconciliationRequest(BaseModel):
    actual_balance: int
    occurred_on: date
    note: str = ""


class ReconciliationResult(BaseModel):
    diff: int
    transaction_id: int | None
