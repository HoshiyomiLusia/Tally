"""add credit_limit column to wallets (信用卡额度)

Revision ID: 0006_wallet_credit_limit
Revises: 0005_user_primary_currency
Create Date: 2026-06-12
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006_wallet_credit_limit"
down_revision: Union[str, None] = "0005_user_primary_currency"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("wallets") as batch:
        batch.add_column(sa.Column("credit_limit", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("wallets") as batch:
        batch.drop_column("credit_limit")
