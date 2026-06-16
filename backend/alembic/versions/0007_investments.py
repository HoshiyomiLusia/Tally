"""investments: positions table + transactions.position_id

Revision ID: 0007_investments
Revises: 0006_wallet_credit_limit
Create Date: 2026-06-16
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007_investments"
down_revision: Union[str, None] = "0006_wallet_credit_limit"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "positions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("currency_code", sa.String(), sa.ForeignKey("currencies.code"), nullable=False),
        sa.Column("opened_on", sa.Date(), nullable=False, index=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("note", sa.String(length=256), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
    )
    # 仿 0004: batch 内 add_column + 具名 create_foreign_key + create_index (内联匿名 FK 在 batch 重建时会失败)
    with op.batch_alter_table("transactions") as batch:
        batch.add_column(sa.Column("position_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_transactions_position_id", "positions", ["position_id"], ["id"], ondelete="SET NULL",
        )
        batch.create_index("ix_transactions_position_id", ["position_id"])


def downgrade() -> None:
    with op.batch_alter_table("transactions") as batch:
        batch.drop_index("ix_transactions_position_id")
        batch.drop_constraint("fk_transactions_position_id", type_="foreignkey")
        batch.drop_column("position_id")
    op.drop_table("positions")
