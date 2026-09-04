"""审计 #133: 单人全额代付的分摊组只有一条借出腿, 清掉它的 split_group_id 让它成为可编辑的独立借出

Revision ID: 0012_solo_lend_ungroup
Revises: 0011_opening_pair_group
Create Date: 2026-09-05
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0012_solo_lend_ungroup"
down_revision: Union[str, None] = "0011_opening_pair_group"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 只动"组内恰好一条腿且是 loan_out"的组; 卖出组(盈亏为 0 时也只有一条 invest_sell)不在此列
    op.execute(
        "UPDATE transactions SET split_group_id = NULL WHERE kind = 'loan_out' AND split_group_id IN ("
        "  SELECT split_group_id FROM transactions WHERE split_group_id IS NOT NULL "
        "  GROUP BY split_group_id HAVING COUNT(*) = 1)"
    )


def downgrade() -> None:
    pass
