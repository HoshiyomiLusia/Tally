from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Category, Currency, Merchant
from .seed_data import CURRENCIES, EXPENSE_TREE, INCOME_TREE, MERCHANTS


async def seed_currencies(session: AsyncSession) -> None:
    existing = (await session.execute(select(Currency.code))).scalars().all()
    if set(existing) >= {c[0] for c in CURRENCIES}:
        return
    have = set(existing)
    for code, name, symbol, digits in CURRENCIES:
        if code in have:
            continue
        session.add(Currency(code=code, name=name, symbol=symbol, decimal_digits=digits))
    await session.commit()


async def seed_user_defaults(session: AsyncSession, user_id: int) -> None:
    existing = (await session.execute(select(Category).where(Category.user_id == user_id))).scalars().first()
    if existing is not None:
        return

    cat_lookup: dict[str, int] = {}

    for kind, tree in (("expense", EXPENSE_TREE), ("income", INCOME_TREE)):
        for parent_order, (parent_name, parent_emoji, children) in enumerate(tree):
            parent = Category(
                user_id=user_id,
                parent_id=None,
                name=parent_name,
                kind=kind,
                emoji=parent_emoji,
                sort_order=parent_order,
            )
            session.add(parent)
            await session.flush()
            cat_lookup[parent_name] = parent.id
            for child_order, (child_name, child_emoji) in enumerate(children):
                child = Category(
                    user_id=user_id,
                    parent_id=parent.id,
                    name=child_name,
                    kind=kind,
                    emoji=child_emoji,
                    sort_order=child_order,
                )
                session.add(child)
                await session.flush()
                cat_lookup[child_name] = child.id

    for name, default_cat, region in MERCHANTS:
        session.add(
            Merchant(
                user_id=user_id,
                name=name,
                default_category_id=cat_lookup.get(default_cat),
                region=region,
            )
        )

    await session.commit()
