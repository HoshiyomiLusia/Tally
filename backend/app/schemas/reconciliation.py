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
    # 审计 #97: 与交易金额同口径加上下界, 否则极端值落库后 SUM 溢出让钱包/首页/统计接口全部 500
    actual_balance: int = Field(ge=-1_000_000_000_000, le=1_000_000_000_000)
    occurred_on: date
    note: str = ""


class ReconciliationResult(BaseModel):
    diff: int
    transaction_id: int | None
