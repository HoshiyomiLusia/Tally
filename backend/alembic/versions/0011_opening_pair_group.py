"""审计 #122: 存量期初对(期初买入 + 配套对账收入)回填 split_group_id 显式配对

此前两腿只靠(钱包/金额/日期)指纹配对, 会与普通追加买入碰撞导致换钱包/删除时挪错/漏删。
新数据由 buy()/add_buy() 直接打组; 本迁移给存量回填: 每笔期初收入找同指纹 invest_buy,
恰好一笔才配对打组; 歧义(多笔同指纹)保守跳过, 运行时逻辑按指纹+歧义拒绝兜底。幂等。

Revision ID: 0011_opening_pair_group
Revises: 0010_fix_dangling_fks
Create Date: 2026-08-25
"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011_opening_pair_group"
down_revision: Union[str, None] = "0010_fix_dangling_fks"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    incomes = bind.execute(sa.text(
        "SELECT id, user_id, opening_for_position_id, wallet_id, amount, occurred_on FROM transactions "
        "WHERE opening_for_position_id IS NOT NULL AND split_group_id IS NULL"
    )).fetchall()
    for inc in incomes:
        buys = bind.execute(sa.text(
            "SELECT id FROM transactions WHERE user_id=:u AND position_id=:p AND kind='invest_buy' "
            "AND wallet_id=:w AND amount=:a AND occurred_on=:d AND split_group_id IS NULL"
        ), {"u": inc.user_id, "p": inc.opening_for_position_id, "w": inc.wallet_id,
            "a": inc.amount, "d": inc.occurred_on}).fetchall()
        if len(buys) != 1:
            continue  # 无配对或歧义: 跳过
        g = str(uuid.uuid4())
        bind.execute(sa.text("UPDATE transactions SET split_group_id=:g WHERE id=:i"), {"g": g, "i": inc.id})
        bind.execute(sa.text("UPDATE transactions SET split_group_id=:g WHERE id=:i"), {"g": g, "i": buys[0].id})


def downgrade() -> None:
    pass  # 显式配对信息无害, 不回退
