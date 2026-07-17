from datetime import date

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ExchangeRateCreate(BaseModel):
    on_date: date
    base: str
    quote: str
    # 汇率必须为正(负数会静默翻转折算符号, 审计 #42), 且设上界挡手滑输入的天文数字。
    # 汇率表是全局共享的(家用场景故意保留), 校验是防污染的最后一道(审计 #26)。
    rate: float = Field(gt=0, le=1_000_000_000)

    @model_validator(mode="after")
    def _base_ne_quote(self):
        if self.base == self.quote:
            raise ValueError("base 与 quote 不能相同")
        return self


class ExchangeRateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    on_date: date
    base: str
    quote: str
    rate: float
    source: str
