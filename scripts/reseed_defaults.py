"""把最新的 EXPENSE_TREE / INCOME_TREE / MERCHANTS 增量补给所有现有用户.

seed_user_defaults 是 idempotent ADD-only —— 只会插入 (parent, name, kind)
组合不存在的分类, 已有的一律不动. 安全跑.

新加的"投资"大类 + 子类会自动出现.

Run:
    docker compose exec app python scripts/reseed_defaults.py
"""
import asyncio

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models import User
from app.services.seed import seed_user_defaults


async def main() -> None:
    async with SessionLocal() as s:
        users = (await s.execute(select(User))).scalars().all()
        for u in users:
            await seed_user_defaults(s, u.id)
            print(f"user={u.id}: re-seed done")
        print("all done")


if __name__ == "__main__":
    asyncio.run(main())
