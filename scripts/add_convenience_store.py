"""购物 下新增 便利店 子类, 并把便利店商家的默认分类从 线下餐饮 改到 便利店.

- seed_user_defaults 已经会补出"便利店"子类 (idempotent), 这里先跑它.
- 然后把指定商家的 default_category_id 指到 便利店 (仅当它当前指向 线下餐饮,
  避免覆盖用户自己改过的). 历史交易的 category_id 一律不动.

Run:
    docker compose exec app python scripts/add_convenience_store.py
"""
import asyncio

from sqlalchemy import select, update

from app.core.db import SessionLocal
from app.models import Category, Merchant, User
from app.services.seed import seed_user_defaults


CONV_MERCHANTS = {"FamilyMart", "Lawson", "ミニストップ", "全家", "罗森", "便利蜂", "7-11"}


async def main() -> None:
    async with SessionLocal() as s:
        users = (await s.execute(select(User))).scalars().all()
        for u in users:
            await seed_user_defaults(s, u.id)

            conv = (
                await s.execute(
                    select(Category).where(
                        Category.user_id == u.id,
                        Category.kind == "expense",
                        Category.name == "便利店",
                    )
                )
            ).scalar_one_or_none()
            dining = (
                await s.execute(
                    select(Category).where(
                        Category.user_id == u.id,
                        Category.kind == "expense",
                        Category.name == "线下餐饮",
                    )
                )
            ).scalar_one_or_none()
            if not conv:
                print(f"user={u.id}: 便利店 子类未建出, skip")
                continue

            dining_id = dining.id if dining else None
            moved = (
                await s.execute(
                    update(Merchant)
                    .where(
                        Merchant.user_id == u.id,
                        Merchant.name.in_(CONV_MERCHANTS),
                        # 只动还指着 线下餐饮 (或没设) 的, 别覆盖用户手改过的
                        (Merchant.default_category_id == dining_id) if dining_id is not None else Merchant.default_category_id.is_(None),
                    )
                    .values(default_category_id=conv.id)
                )
            ).rowcount
            print(f"user={u.id}: 便利店(id={conv.id}); 商家默认分类改指 {moved} 个")
            await s.commit()
        print("done")


if __name__ == "__main__":
    asyncio.run(main())
