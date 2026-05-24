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
    """Add any missing default categories/merchants for this user. Idempotent —
    safe to re-run after seed_data updates to pick up new defaults."""

    existing_cats = (await session.execute(select(Category).where(Category.user_id == user_id))).scalars().all()
    by_key: dict[tuple[int | None, str, str], int] = {(c.parent_id, c.name, c.kind): c.id for c in existing_cats}

    for kind, tree in (("expense", EXPENSE_TREE), ("income", INCOME_TREE)):
        for parent_order, (parent_name, parent_emoji, children) in enumerate(tree):
            parent_key = (None, parent_name, kind)
            if parent_key in by_key:
                parent_id = by_key[parent_key]
            else:
                p = Category(user_id=user_id, parent_id=None, name=parent_name, kind=kind, emoji=parent_emoji, sort_order=parent_order)
                session.add(p)
                await session.flush()
                parent_id = p.id
                by_key[parent_key] = parent_id
            for child_order, (child_name, child_emoji) in enumerate(children):
                child_key = (parent_id, child_name, kind)
                if child_key in by_key:
                    continue
                child = Category(user_id=user_id, parent_id=parent_id, name=child_name, kind=kind, emoji=child_emoji, sort_order=child_order)
                session.add(child)
                await session.flush()
                by_key[child_key] = child.id

    cat_id_by_name = {
        c.name: c.id
        for c in (await session.execute(select(Category).where(Category.user_id == user_id))).scalars().all()
    }
    existing_merchants = {
        m.name for m in (await session.execute(select(Merchant).where(Merchant.user_id == user_id))).scalars().all()
    }
    existing_merchant_objs = {
        m.name: m
        for m in (await session.execute(select(Merchant).where(Merchant.user_id == user_id))).scalars().all()
    }
    for entry in MERCHANTS:
        name, default_cat, region = entry[0], entry[1], entry[2]
        aliases = entry[3] if len(entry) > 3 else ""
        if name in existing_merchants:
            # Backfill aliases on existing merchant if currently empty
            ex = existing_merchant_objs.get(name)
            if ex is not None and not ex.aliases and aliases:
                ex.aliases = aliases
            continue
        session.add(Merchant(
            user_id=user_id,
            name=name,
            default_category_id=cat_id_by_name.get(default_cat),
            region=region,
            aliases=aliases,
        ))

    await session.commit()
