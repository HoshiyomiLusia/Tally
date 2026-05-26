"""add primary_currency_code column to user

Revision ID: 0005_user_primary_currency
Revises: 0004_attributed_wallet
Create Date: 2026-05-25
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005_user_primary_currency"
down_revision: Union[str, None] = "0004_attributed_wallet"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("user") as batch:
        batch.add_column(sa.Column("primary_currency_code", sa.String(8), nullable=True))
        batch.create_foreign_key(
            "fk_user_primary_currency",
            "currencies",
            ["primary_currency_code"],
            ["code"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("user") as batch:
        batch.drop_constraint("fk_user_primary_currency", type_="foreignkey")
        batch.drop_column("primary_currency_code")
