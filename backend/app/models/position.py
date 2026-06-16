from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base

POSITION_STATUS = ("open", "closed")


class Position(Base):
    """一个投资持仓 (仿借贷的"联系人"): 一笔买入开一个持仓, 卖出时按成本结算.
    成本/剩余由 invest_buy / invest_sell 交易聚合得出, 这里只存元信息."""

    __tablename__ = "positions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    currency_code: Mapped[str] = mapped_column(ForeignKey("currencies.code"))
    opened_on: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(16), default="open")
    note: Mapped[str] = mapped_column(String(256), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
