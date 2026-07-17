from sqlalchemy import or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Category, Transaction

# 内部账务调整分类: 这些"花销/收入"是账务平衡分录, 不算真实消费/收入,
# 统计 / 预算 / 首页月度收支一律剔除. 加新的内部分类就在这里加名字.
INTERNAL_CATEGORY_NAMES = ("对账调整",)

# 系统分类: 被 reconcile / 投资结算 / 坏账核销按"名字"反查 id(_pnl_cat 等).
# 一旦被改名或删除, 那些查找会静默返回 None、分录落成"未分类"并污染统计(见审计 #24/#38/#48),
# 且删除后 not_internal 因查不到而 fail-open. 故禁止用户改这些分类的名字或删除它们.
SYSTEM_CATEGORY_NAMES = ("对账调整", "坏账损失", "投资收益", "投资亏损")


async def internal_cat_ids(session: AsyncSession, user_id: int) -> list[int]:
    rows = (
        await session.execute(
            select(Category.id).where(
                Category.user_id == user_id,
                Category.name.in_(INTERNAL_CATEGORY_NAMES),
            )
        )
    ).scalars().all()
    return list(rows)


def not_internal(skip_cats: list[int]):
    """WHERE 子句: 排除内部分类, 但保留"未分类"(category_id IS NULL).
    直接写 `~category_id.in_(skip)` 会踩 SQL 的 `NULL NOT IN (...)` = NULL 坑,
    把未分类的真实交易也一并丢掉 —— 所以显式放行 NULL."""
    if not skip_cats:
        return true()
    return or_(Transaction.category_id.is_(None), Transaction.category_id.notin_(skip_cats))
