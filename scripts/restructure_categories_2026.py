"""分类重构 (按用户最终拍板):
  - 餐饮 -> 饮食, 并把 超市/便利店 从 购物 挪进来
  - 其他订阅 -> 其他固定账单
  - 其他 +手续费; 服务 +邮寄快递/维修/洗衣干洗/打印复印/证件办理; 娱乐 +展会活动/KTV酒吧
  - 卡拉OK / 邮寄 商家归到新子类

幂等, 不动任何已有账单的 category_id (只重命名/改父级/加类/改商家默认分类).
Run:
    docker compose exec app python restructure_categories_2026.py
"""
import asyncio

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models import Category, Merchant, User
from app.services.seed import seed_user_defaults


async def top(s, uid, name):
    return (await s.execute(select(Category).where(
        Category.user_id == uid, Category.kind == "expense",
        Category.name == name, Category.parent_id.is_(None),
    ))).scalar_one_or_none()


async def child(s, uid, parent_id, name):
    return (await s.execute(select(Category).where(
        Category.user_id == uid, Category.kind == "expense",
        Category.name == name, Category.parent_id == parent_id,
    ))).scalar_one_or_none()


async def migrate_user(s, uid):
    # 1. 餐饮 -> 饮食
    if not await top(s, uid, "饮食"):
        canyin = await top(s, uid, "餐饮")
        if canyin:
            canyin.name = "饮食"
            await s.flush()
    yinshi = await top(s, uid, "饮食")

    # 2. 超市 / 便利店: 购物 -> 饮食
    gouwu = await top(s, uid, "购物")
    if gouwu and yinshi:
        for nm in ("超市", "便利店"):
            c = await child(s, uid, gouwu.id, nm)
            if c:
                c.parent_id = yinshi.id
        await s.flush()

    # 3. 其他订阅 -> 其他固定账单
    gd = await top(s, uid, "固定账单")
    if gd and not await child(s, uid, gd.id, "其他固定账单"):
        sub = await child(s, uid, gd.id, "其他订阅")
        if sub:
            sub.name = "其他固定账单"
            await s.flush()

    # 4. 增量补齐新子类 (手续费 / 服务5项 / 娱乐2项), 用幂等 seeder
    await seed_user_defaults(s, uid)

    # 5. 商家归类修正
    remap = {
        "カラオケ館": "KTV酒吧", "ビッグエコー": "KTV酒吧",
        "郵便局": "邮寄快递", "クロネコヤマト": "邮寄快递",
    }
    cat_by_name = {
        c.name: c.id for c in (await s.execute(select(Category).where(
            Category.user_id == uid, Category.kind == "expense"))).scalars().all()
    }
    for mname, cname in remap.items():
        m = (await s.execute(select(Merchant).where(
            Merchant.user_id == uid, Merchant.name == mname))).scalar_one_or_none()
        if m and cname in cat_by_name:
            m.default_category_id = cat_by_name[cname]
    await s.commit()


async def main():
    async with SessionLocal() as s:
        users = (await s.execute(select(User))).scalars().all()
    for u in users:
        async with SessionLocal() as s:
            await migrate_user(s, u.id)
        print(f"user={u.id} migrated")
    print("done")


if __name__ == "__main__":
    asyncio.run(main())
