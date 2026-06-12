from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base

WALLET_TYPES = ("cash", "bank", "credit_card", "e_wallet", "virtual")


class Wallet(Base):
    __tablename__ = "wallets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    type: Mapped[str] = mapped_column(String(16))
    currency_code: Mapped[str] = mapped_column(ForeignKey("currencies.code"))
    initial_balance: Mapped[int] = mapped_column(Integer, default=0)
    credit_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 信用卡额度 (最小单位); 仅信用卡有意义
    icon: Mapped[str] = mapped_column(String(16), default="")
    color: Mapped[str] = mapped_column(String(16), default="")
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
