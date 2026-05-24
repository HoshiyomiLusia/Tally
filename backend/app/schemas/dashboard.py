from pydantic import BaseModel

from .transaction import TransactionRead


class WalletBalanceItem(BaseModel):
    wallet_id: int
    wallet_name: str
    currency_code: str
    balance: int
    type: str
    archived: bool


class CurrencyTotals(BaseModel):
    currency_code: str
    income: int
    expense: int
    net: int


class CategoryBreakdownItem(BaseModel):
    category_id: int | None
    category_name: str
    emoji: str
    amount: int
    currency_code: str


class DashboardResponse(BaseModel):
    month: str
    wallet_balances: list[WalletBalanceItem]
    month_totals: list[CurrencyTotals]
    category_breakdown: list[CategoryBreakdownItem]
    recent_transactions: list[TransactionRead]
