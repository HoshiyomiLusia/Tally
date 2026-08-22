"""planned_expenses: 预定支出便签表(独立于账务, 不进余额/统计)

Revision ID: 0009_planned_expenses
Revises: 0008_opening_income_link
Create Date: 2026-07-18
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009_planned_expenses"
down_revision: Union[str, None] = "0008_opening_income_link"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "planned_expenses",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("currency_code", sa.String(), sa.ForeignKey("currencies.code"), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("note", sa.String(length=256), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_table("planned_expenses")
