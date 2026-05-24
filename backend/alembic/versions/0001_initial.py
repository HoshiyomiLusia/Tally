"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-05-24

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(length=32), unique=True, nullable=False, index=True),
        sa.Column("hashed_password", sa.String(length=128), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )

    op.create_table(
        "currencies",
        sa.Column("code", sa.String(length=8), primary_key=True),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("symbol", sa.String(length=8), nullable=False),
        sa.Column("decimal_digits", sa.Integer(), nullable=False, server_default="2"),
    )

    op.create_table(
        "wallets",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id", ondelete="CASCADE"), index=True),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column("currency_code", sa.String(length=8), sa.ForeignKey("currencies.code"), nullable=False),
        sa.Column("initial_balance", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("icon", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("color", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )

    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id", ondelete="CASCADE"), index=True),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("categories.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="expense"),
        sa.Column("emoji", sa.String(length=8), nullable=False, server_default=""),
        sa.Column("color", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "merchants",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id", ondelete="CASCADE"), index=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("default_category_id", sa.Integer(), sa.ForeignKey("categories.id", ondelete="SET NULL"), nullable=True),
        sa.Column("region", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("usage_count", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "transactions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id", ondelete="CASCADE"), index=True),
        sa.Column("wallet_id", sa.Integer(), sa.ForeignKey("wallets.id", ondelete="RESTRICT"), index=True),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("categories.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("merchant_id", sa.Integer(), sa.ForeignKey("merchants.id", ondelete="SET NULL"), nullable=True),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("currency_code", sa.String(length=8), sa.ForeignKey("currencies.code"), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="expense"),
        sa.Column("occurred_on", sa.Date(), nullable=False, index=True),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )

    op.create_table(
        "exchange_rates",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("on_date", sa.Date(), nullable=False, index=True),
        sa.Column("base", sa.String(length=8), sa.ForeignKey("currencies.code"), nullable=False),
        sa.Column("quote", sa.String(length=8), sa.ForeignKey("currencies.code"), nullable=False),
        sa.Column("rate", sa.Float(), nullable=False),
        sa.UniqueConstraint("on_date", "base", "quote", name="uq_rate_date_pair"),
    )


def downgrade() -> None:
    op.drop_table("exchange_rates")
    op.drop_table("transactions")
    op.drop_table("merchants")
    op.drop_table("categories")
    op.drop_table("wallets")
    op.drop_table("currencies")
    op.drop_table("user")
