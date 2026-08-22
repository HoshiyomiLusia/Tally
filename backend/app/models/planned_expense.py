from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base


class PlannedExpense(Base):
    """预定支出: 未来的一次性大额支出(如学费). 完全独立于账务 —— 不进钱包余额、不进收支统计,
    仅供首页"一键扣预定"算出真实可用额度 + 小便签列出。"""

    __tablename__ = "planned_expenses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    amount: Mapped[int] = mapped_column(Integer)  # 最小单位
    currency_code: Mapped[str] = mapped_column(ForeignKey("currencies.code"))
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    note: Mapped[str] = mapped_column(String(256), default="")
