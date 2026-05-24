from datetime import date

from sqlalchemy import Date, Float, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base


class ExchangeRate(Base):
    __tablename__ = "exchange_rates"
    __table_args__ = (UniqueConstraint("on_date", "base", "quote", name="uq_rate_date_pair"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    on_date: Mapped[date] = mapped_column(Date, index=True)
    base: Mapped[str] = mapped_column(ForeignKey("currencies.code"))
    quote: Mapped[str] = mapped_column(ForeignKey("currencies.code"))
    rate: Mapped[float] = mapped_column(Float)
