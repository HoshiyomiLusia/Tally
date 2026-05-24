from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

WalletType = Literal["cash", "bank", "credit_card", "e_wallet", "virtual"]


class WalletCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    type: WalletType
    currency_code: str
    initial_balance: int = 0
    icon: str = ""
    color: str = ""


class WalletUpdate(BaseModel):
    name: str | None = None
    type: WalletType | None = None
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
    icon: str
    color: str
    archived: bool
    sort_order: int
    created_at: datetime
    balance: int = 0
