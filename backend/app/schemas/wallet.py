from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

WalletType = Literal["cash", "bank", "credit_card", "e_wallet", "virtual"]


class WalletCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    type: WalletType
    currency_code: str
    # 审计#71: 期初余额可正可负, 上下界防溢出
    initial_balance: int = Field(default=0, ge=-1_000_000_000_000, le=1_000_000_000_000)
    # 审计#71: 授信额度非负且加上界防溢出
    credit_limit: int | None = Field(default=None, ge=0, le=1_000_000_000_000)
    icon: str = ""
    color: str = ""


class WalletUpdate(BaseModel):
    # 审计#70: 对齐 Create 的 max_length=64, 防改档时写入超长名
    name: str | None = Field(default=None, max_length=64)
    type: WalletType | None = None
    # 审计#71: 与 Create 对齐, 授信额度非负且加上界防溢出
    credit_limit: int | None = Field(default=None, ge=0, le=1_000_000_000_000)
    icon: str | None = None
    color: str | None = None
    archived: bool | None = None
    sort_order: int | None = None


class WalletRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    type: WalletType
    currency_code: str
    initial_balance: int
    credit_limit: int | None = None
    icon: str
    color: str
    archived: bool
    sort_order: int
    created_at: datetime
    balance: int = 0
    loan_out_on_wallet: int = 0
    loan_repayment_on_wallet: int = 0
    invest_out_on_wallet: int = 0
    invest_in_on_wallet: int = 0
