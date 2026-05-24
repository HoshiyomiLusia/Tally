"""One-shot migration:
  订阅 -> 固定账单 (rename parent)
  AI 服务 -> 会员订阅 (move txs + merchant defaults, then delete AI 服务)
  + add 服务 / API (via seed_user_defaults — idempotent)

Run inside the container:
    docker compose exec app python scripts/restructure_subscription.py
"""
import asyncio

from sqlalchemy import delete, select, update

from app.core.db import SessionLocal
from app.models import Category, Merchant, Transaction, User
from app.services.seed import seed_user_defaults


async def main() -> None:
    async with SessionLocal() as s:
        users = (await s.execute(select(User))).scalars().all()
        for u in users:
            parent = (
                await s.execute(
                    select(Category).where(
                        Category.user_id == u.id,
                        Category.parent_id.is_(None),
                        Category.kind == "expense",
                        Category.name.in_(("订阅", "固定账单")),
                    )
                )
            ).scalar_one_or_none()
            if parent is None:
                print(f"user={u.id}: no 订阅/固定账单 parent, skipping rename/merge")
            else:
                if parent.name == "订阅":
                    parent.name = "固定账单"
                    print(f"user={u.id}: renamed 订阅 -> 固定账单 (id={parent.id})")

                ai = (
                    await s.execute(
                        select(Category).where(
                            Category.user_id == u.id,
                            Category.parent_id == parent.id,
                            Category.name == "AI 服务",
                        )
                    )
                ).scalar_one_or_none()
                member = (
                    await s.execute(
                        select(Category).where(
                            Category.user_id == u.id,
                            Category.parent_id == parent.id,
                            Category.name == "会员订阅",
                        )
                    )
                ).scalar_one_or_none()
                if ai and member:
                    moved_tx = (
                        await s.execute(
                            update(Transaction)
                            .where(Transaction.user_id == u.id, Transaction.category_id == ai.id)
                            .values(category_id=member.id)
                        )
                    ).rowcount
                    moved_m = (
                        await s.execute(
                            update(Merchant)
                            .where(Merchant.user_id == u.id, Merchant.default_category_id == ai.id)
                            .values(default_category_id=member.id)
                        )
                    ).rowcount
                    await s.execute(delete(Category).where(Category.id == ai.id))
                    print(f"user={u.id}: AI 服务 -> 会员订阅 (txs={moved_tx}, merchants={moved_m})")
                elif ai and not member:
                    print(f"user={u.id}: AI 服务 exists but no 会员订阅 target, skipping (manual check needed)")
            await s.commit()

            await seed_user_defaults(s, u.id)
            print(f"user={u.id}: re-seeded defaults (will add 服务/API if missing)")
        print("done")


if __name__ == "__main__":
    asyncio.run(main())
