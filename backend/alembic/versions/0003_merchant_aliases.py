"""add aliases column to merchants

Revision ID: 0003_merchant_aliases
Revises: 0002_full_features
Create Date: 2026-05-24
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003_merchant_aliases"
down_revision: Union[str, None] = "0002_full_features"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("merchants") as batch:
        batch.add_column(sa.Column("aliases", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    with op.batch_alter_table("merchants") as batch:
        batch.drop_column("aliases")
