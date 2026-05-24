"""full feature schema: contacts, budgets, attachments, split/recurring/transfer fields, exchange_rate source

Revision ID: 0002_full_features
Revises: 0001_initial
Create Date: 2026-05-24

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_full_features"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "contacts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id", ondelete="CASCADE"), index=True),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("color", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("note", sa.String(length=256), nullable=False, server_default=""),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )

    op.create_table(
        "budgets",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id", ondelete="CASCADE"), index=True),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("categories.id", ondelete="CASCADE"), nullable=True),
        sa.Column("currency_code", sa.String(length=8), sa.ForeignKey("currencies.code"), nullable=False),
        sa.Column("period", sa.String(length=16), nullable=False, server_default="monthly"),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("note", sa.String(length=256), nullable=False, server_default=""),
    )

    op.create_table(
        "attachments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id", ondelete="CASCADE"), index=True),
        sa.Column("transaction_id", sa.Integer(), sa.ForeignKey("transactions.id", ondelete="CASCADE"), index=True),
        sa.Column("original_name", sa.String(length=256), nullable=False),
        sa.Column("stored_name", sa.String(length=128), nullable=False),
        sa.Column("mime_type", sa.String(length=64), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )

    with op.batch_alter_table("transactions") as batch:
        batch.add_column(sa.Column("contact_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("split_group_id", sa.String(length=36), nullable=True))
        batch.add_column(sa.Column("is_recurring", sa.Boolean(), nullable=False, server_default=sa.text("0")))
        batch.add_column(sa.Column("recurrence_period_days", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("recurrence_group_id", sa.String(length=36), nullable=True))
        batch.add_column(sa.Column("transfer_pair_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_transactions_contact_id", "contacts", ["contact_id"], ["id"], ondelete="SET NULL")
        batch.create_foreign_key("fk_transactions_transfer_pair_id", "transactions", ["transfer_pair_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_transactions_split_group_id", "transactions", ["split_group_id"])
    op.create_index("ix_transactions_recurrence_group_id", "transactions", ["recurrence_group_id"])
    op.create_index("ix_transactions_contact_id", "transactions", ["contact_id"])

    with op.batch_alter_table("exchange_rates") as batch:
        batch.add_column(sa.Column("source", sa.String(length=16), nullable=False, server_default="manual"))


def downgrade() -> None:
    with op.batch_alter_table("exchange_rates") as batch:
        batch.drop_column("source")
    op.drop_index("ix_transactions_contact_id", "transactions")
    op.drop_index("ix_transactions_recurrence_group_id", "transactions")
    op.drop_index("ix_transactions_split_group_id", "transactions")
    with op.batch_alter_table("transactions") as batch:
        batch.drop_column("transfer_pair_id")
        batch.drop_column("recurrence_group_id")
        batch.drop_column("recurrence_period_days")
        batch.drop_column("is_recurring")
        batch.drop_column("split_group_id")
        batch.drop_column("contact_id")
    op.drop_table("attachments")
    op.drop_table("budgets")
    op.drop_table("contacts")
