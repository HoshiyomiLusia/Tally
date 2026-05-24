from datetime import date

from pydantic import BaseModel, ConfigDict


class ExchangeRateCreate(BaseModel):
    on_date: date
    base: str
    quote: str
    rate: float


class ExchangeRateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    on_date: date
    base: str
    quote: str
    rate: float
