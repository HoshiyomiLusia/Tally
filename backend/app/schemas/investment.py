from datetime import date

from pydantic import BaseModel, Field


class PositionView(BaseModel):
    id: int
    name: str
    currency_code: str
    opened_on: date
    status: str
    cost_total: int       # 累计买入成本
    cost_remaining: int   # 当前持有成本 (Σbuy - Σsell)
    realized_pnl: int     # 已实现盈亏 (+赚 / -亏)
    note: str = ""


class PositionUpdate(BaseModel):
    """只改持仓元信息 (名称/开仓日期/备注), 不动金额与账务."""
    name: str | None = Field(default=None, min_length=1, max_length=64)
    opened_on: date | None = None
    note: str | None = Field(default=None, max_length=256)


class BuyRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    currency_code: str
    wallet_id: int
    amount: int = Field(gt=0)        # 买入成本 (从现金钱包转出)
    occurred_on: date
    note: str = ""
    opening: bool = False            # True = 已持有资产: 不扣钱包, 作为额外资产计入净值 (配一笔对账注入)


class SellRequest(BaseModel):
    position_id: int
    wallet_id: int                   # 卖出回款到哪个现金钱包
    cost_amount: int = Field(gt=0)   # 这次卖出对应的成本 (部分卖出可 < 剩余成本)
    proceeds: int = Field(ge=0)      # 卖出到手金额
    occurred_on: date
    note: str = ""


class InvestEventView(BaseModel):
    """投资历史里的一条事件: 买入 = 一笔; 卖出 = invest_sell + 盈亏 合成一条."""
    key: str
    position_id: int
    position_name: str
    currency_code: str
    occurred_on: date
    type: str             # "buy" | "sell"
    cost: int             # 买入成本 / 卖出对应成本
    proceeds: int | None = None   # 仅卖出: 到手金额
    pnl: int | None = None        # 仅卖出: 已实现盈亏 (+/-)
    note: str = ""
