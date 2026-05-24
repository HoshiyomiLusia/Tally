from sqlalchemy import String, Integer
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base


class Currency(Base):
    __tablename__ = "currencies"

    code: Mapped[str] = mapped_column(String(8), primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    symbol: Mapped[str] = mapped_column(String(8))
    decimal_digits: Mapped[int] = mapped_column(Integer, default=2)
