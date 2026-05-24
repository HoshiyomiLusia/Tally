from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base

TRANSACTION_KINDS = ("expense", "income", "transfer_out", "transfer_in", "loan_out", "loan_repayment")


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), index=True)
    wallet_id: Mapped[int] = mapped_column(ForeignKey("wallets.id", ondelete="RESTRICT"), index=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"), nullable=True, index=True)
    merchant_id: Mapped[int | None] = mapped_column(ForeignKey("merchants.id", ondelete="SET NULL"), nullable=True)
    contact_id: Mapped[int | None] = mapped_column(ForeignKey("contacts.id", ondelete="SET NULL"), nullable=True, index=True)
    amount: Mapped[int] = mapped_column(Integer)
    currency_code: Mapped[str] = mapped_column(ForeignKey("currencies.code"))
    kind: Mapped[str] = mapped_column(String(16), default="expense")
    occurred_on: Mapped[date] = mapped_column(Date, index=True)
    note: Mapped[str] = mapped_column(Text, default="")
    split_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    is_recurring: Mapped[bool] = mapped_column(Boolean, default=False)
    recurrence_period_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recurrence_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    transfer_pair_id: Mapped[int | None] = mapped_column(ForeignKey("transactions.id", ondelete="SET NULL"), nullable=True)
    # 仅用于 loan_out / loan_repayment 的"名义归属"覆盖: 历史 wallet_id 不动,
    # 但聚合借贷调整时按 COALESCE(attributed_wallet_id, wallet_id) 计算.
    # 让用户可以把 Suica 上的借贷在不动账单的前提下挪到 三菱 名下显示.
    attributed_wallet_id: Mapped[int | None] = mapped_column(ForeignKey("wallets.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
