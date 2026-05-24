"""add attributed_wallet_id column to transactions

Revision ID: 0004_attributed_wallet
Revises: 0003_merchant_aliases
Create Date: 2026-05-24
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004_attributed_wallet"
down_revision: Union[str, None] = "0003_merchant_aliases"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("transactions") as batch:
        batch.add_column(sa.Column("attributed_wallet_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_transactions_attributed_wallet_id",
            "wallets",
            ["attributed_wallet_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("transactions") as batch:
        batch.drop_constraint("fk_transactions_attributed_wallet_id", type_="foreignkey")
        batch.drop_column("attributed_wallet_id")
