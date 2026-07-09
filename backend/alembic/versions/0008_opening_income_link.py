"""opening income link: transactions.opening_for_position_id + 回填

给"期初持仓"注入的对账收入挂上它所属的 position, 这样删持仓时能一并删掉, 净值不再虚高.
用单独的列(不是 position_id), 以免这笔 income 被当成该持仓的已实现盈亏.

Revision ID: 0008_opening_income_link
Revises: 0007_investments
Create Date: 2026-06-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008_opening_income_link"
down_revision: Union[str, None] = "0007_investments"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("transactions") as batch:
        batch.add_column(sa.Column("opening_for_position_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_transactions_opening_for_position_id", "positions",
            ["opening_for_position_id"], ["id"], ondelete="SET NULL",
        )
    # 回填存量: 期初注入的对账收入原本孤立, 按 (用户/钱包/金额/币种/日期) 找到对应的 invest_buy, 取其 position
    op.execute(
        """
        UPDATE transactions
        SET opening_for_position_id = (
            SELECT b.position_id FROM transactions b
            WHERE b.kind = 'invest_buy'
              AND b.user_id = transactions.user_id
              AND b.wallet_id = transactions.wallet_id
              AND b.amount = transactions.amount
              AND b.currency_code = transactions.currency_code
              AND b.occurred_on = transactions.occurred_on
              AND b.position_id IS NOT NULL
            LIMIT 1
        )
        WHERE kind = 'income'
          AND note = '期初持仓·额外资产(余额不变)'
          AND opening_for_position_id IS NULL
        """
    )


def downgrade() -> None:
    with op.batch_alter_table("transactions") as batch:
        batch.drop_constraint("fk_transactions_opening_for_position_id", type_="foreignkey")
        batch.drop_column("opening_for_position_id")
