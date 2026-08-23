"""审计 #96: 开启 SQLite 外键前清理历史悬空引用

此前外键从未强制, 删分类/商家/联系人等会留下悬空 id. 把可空引用置 NULL, 孤儿子分类提升为一级,
引用已删分类的预算删除. 幂等, 可重复执行.

Revision ID: 0010_fix_dangling_fks
Revises: 0009_planned_expenses
Create Date: 2026-08-23
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0010_fix_dangling_fks"
down_revision: Union[str, None] = "0009_planned_expenses"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (表, 列, 父表) — 可空引用, 悬空则置 NULL
NULLABLE_REFS = [
    ("merchants", "default_category_id", "categories"),
    ("transactions", "category_id", "categories"),
    ("transactions", "merchant_id", "merchants"),
    ("transactions", "contact_id", "contacts"),
    ("transactions", "position_id", "positions"),
    ("transactions", "opening_for_position_id", "positions"),
    ("transactions", "transfer_pair_id", "transactions"),
    ("transactions", "attributed_wallet_id", "wallets"),
    ("categories", "parent_id", "categories"),   # 孤儿子分类 -> 提升为一级
    ("user", "primary_currency_code", "currencies"),
]


def upgrade() -> None:
    for tbl, col, parent in NULLABLE_REFS:
        pk = "code" if parent == "currencies" else "id"
        op.execute(
            f"UPDATE {tbl} SET {col} = NULL WHERE {col} IS NOT NULL "
            f"AND NOT EXISTS (SELECT 1 FROM {parent} p WHERE p.{pk} = {tbl}.{col})"
        )
    # budgets.category_id 是 CASCADE 语义: 分类没了预算也没意义, 删掉
    op.execute(
        "DELETE FROM budgets WHERE category_id IS NOT NULL "
        "AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.id = budgets.category_id)"
    )
    # 附件的交易没了 -> 附件行删掉(文件由应用层清理, 这里只保证引用完整)
    op.execute(
        "DELETE FROM attachments WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = attachments.transaction_id)"
    )


def downgrade() -> None:
    pass  # 数据清理不可逆, 也无需回退
