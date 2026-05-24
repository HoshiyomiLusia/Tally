"""把 医疗 父类下的子类 (看病诊断/药品/保险) 全部挪到 生活 父类下,
然后删 医疗 父类.

Run inside the container:
    docker compose exec app python scripts/merge_medical_into_life.py
"""
import asyncio

from sqlalchemy import delete, select, update

from app.core.db import SessionLocal
from app.models import Category, Merchant, User


async def main() -> None:
    async with SessionLocal() as s:
        users = (await s.execute(select(User))).scalars().all()
        for u in users:
            med = (
                await s.execute(
                    select(Category).where(
                        Category.user_id == u.id,
                        Category.parent_id.is_(None),
                        Category.kind == "expense",
                        Category.name == "医疗",
                    )
                )
            ).scalar_one_or_none()
            life = (
                await s.execute(
                    select(Category).where(
                        Category.user_id == u.id,
                        Category.parent_id.is_(None),
                        Category.kind == "expense",
                        Category.name == "生活",
                    )
                )
            ).scalar_one_or_none()
            if not med:
                print(f"user={u.id}: no 医疗 parent")
                continue
            if not life:
                print(f"user={u.id}: 医疗 exists but no 生活 parent — skip")
                continue
            moved = (
                await s.execute(
                    update(Category)
                    .where(Category.user_id == u.id, Category.parent_id == med.id)
                    .values(parent_id=life.id)
                )
            ).rowcount
            # 商家若直接挂在 医疗 父类上 (非常少见, 但稳一手), 也改指 生活
            moved_m = (
                await s.execute(
                    update(Merchant)
                    .where(Merchant.user_id == u.id, Merchant.default_category_id == med.id)
                    .values(default_category_id=life.id)
                )
            ).rowcount
            await s.execute(delete(Category).where(Category.id == med.id))
            print(f"user={u.id}: 医疗 -> 生活 (children={moved}, merchants={moved_m})")
        await s.commit()
        print("done")


if __name__ == "__main__":
    asyncio.run(main())
