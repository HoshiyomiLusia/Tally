from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

BudgetPeriod = Literal["monthly", "yearly"]


class BudgetCreate(BaseModel):
    category_id: int | None = None
    currency_code: str
    period: BudgetPeriod = "monthly"
    # 审计#71: 加上界防溢出
    amount: int = Field(gt=0, le=1_000_000_000_000)
    note: str = ""


class BudgetUpdate(BaseModel):
    # 审计#70: 补 Create 丢失的 gt=0 (否则 PATCH 负预算使 budget_progress 的 percent/remaining 成垃圾值); 审计#71 加上界
    amount: int | None = Field(default=None, gt=0, le=1_000_000_000_000)
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


class TotalBudgetSet(BaseModel):
    """设定总预算: 本位币最小单位; 0 = 不启用(清掉)。"""
    amount: int = Field(ge=0, le=1_000_000_000_000)


class TotalBudgetView(BaseModel):
    """一条总预算 + 本月进度。amount=0 表示没设。
    spent 是本月所有币种的支出折算到本位币后的合计(排除对账调整等内部分类)。"""
    amount: int
    currency_code: str
    spent: int
    remaining: int
    percent: float
    days_in_month: int
    days_elapsed: int
    # 参照与推算都用"你自己过去几个月的同期形状", 不做线性假设 ——
    # 支出天然压在月末(房租/订阅), 按天数线性推会严重低估。
    typical_spent: int                   # 过去 N 个月里, 到"月内同一天"通常已花掉多少
    projected: int                       # 月末推算 = 本月已花 + (历史整月均值 - 历史同期均值)
    history_months: int                  # 参与计算的历史月数; 0 = 没历史, 此时退回按天数线性
    missing_rate_currencies: list[str]   # 缺汇率、没能计入 spent 的币种
