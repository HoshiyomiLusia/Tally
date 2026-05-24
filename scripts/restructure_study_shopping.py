"""分类调整:
  学习 整个干掉
    书籍 + 学习用品 合并 -> 学习用品 (放到 购物 下)
    课程考试 -> 服务 下
  购物 子类重命名:
    生鲜食材 -> 超市
    超市日用 -> 生活用品

Run inside the container:
    docker compose exec app python scripts/restructure_study_shopping.py
"""
import asyncio

from sqlalchemy import delete, select, update

from app.core.db import SessionLocal
from app.models import Category, Merchant, Transaction, User


async def main() -> None:
    async with SessionLocal() as s:
        users = (await s.execute(select(User))).scalars().all()
        for u in users:
            cats = (
                await s.execute(
                    select(Category).where(Category.user_id == u.id, Category.kind == "expense")
                )
            ).scalars().all()
            top = {c.name: c for c in cats if c.parent_id is None}

            shopping = top.get("购物")
            study = top.get("学习")
            service = top.get("服务")
            if not shopping:
                print(f"user={u.id}: no 购物 parent, skip")
                continue

            if service is None:
                service = Category(
                    user_id=u.id, parent_id=None, name="服务", kind="expense",
                    emoji="🛎️", sort_order=99,
                )
                s.add(service)
                await s.flush()
                print(f"user={u.id}: created 服务 parent (id={service.id})")

            if study:
                kids = [c for c in cats if c.parent_id == study.id]
                study_item = next((c for c in kids if c.name == "学习用品"), None)
                book = next((c for c in kids if c.name == "书籍"), None)
                course = next((c for c in kids if c.name == "课程考试"), None)

                # 1. 找/造 学习用品-under-购物 (做合并目标)
                target = next(
                    (c for c in cats if c.parent_id == shopping.id and c.name == "学习用品"),
                    None,
                )
                if target is None and study_item is not None:
                    study_item.parent_id = shopping.id
                    target = study_item
                    study_item = None  # consumed
                    print(f"user={u.id}: re-parented 学习用品 to 购物")
                elif target is None and study_item is None:
                    target = Category(
                        user_id=u.id, parent_id=shopping.id, name="学习用品",
                        kind="expense", emoji="✏️", sort_order=99,
                    )
                    s.add(target)
                    await s.flush()
                    print(f"user={u.id}: created 学习用品 under 购物 (id={target.id})")

                # 2. 已经有 学习用品-under-购物 并且 学习/学习用品 也还在 -> 合并
                if study_item is not None and target is not None:
                    await s.execute(
                        update(Transaction)
                        .where(Transaction.user_id == u.id, Transaction.category_id == study_item.id)
                        .values(category_id=target.id)
                    )
                    await s.execute(
                        update(Merchant)
                        .where(Merchant.user_id == u.id, Merchant.default_category_id == study_item.id)
                        .values(default_category_id=target.id)
                    )
                    await s.execute(delete(Category).where(Category.id == study_item.id))
                    print(f"user={u.id}: merged 学习/学习用品 into 购物/学习用品")

                # 3. 书籍 -> 学习用品(在购物下)
                if book is not None and target is not None:
                    n_tx = (
                        await s.execute(
                            update(Transaction)
                            .where(Transaction.user_id == u.id, Transaction.category_id == book.id)
                            .values(category_id=target.id)
                        )
                    ).rowcount
                    n_m = (
                        await s.execute(
                            update(Merchant)
                            .where(Merchant.user_id == u.id, Merchant.default_category_id == book.id)
                            .values(default_category_id=target.id)
                        )
                    ).rowcount
                    await s.execute(delete(Category).where(Category.id == book.id))
                    print(f"user={u.id}: merged 书籍 -> 学习用品 (txs={n_tx}, merchants={n_m})")

                # 4. 课程考试 -> 服务
                if course is not None:
                    course.parent_id = service.id
                    print(f"user={u.id}: re-parented 课程考试 to 服务")

                # 5. 学习 parent 应该空了, 干掉
                remaining = (
                    await s.execute(
                        select(Category).where(Category.user_id == u.id, Category.parent_id == study.id)
                    )
                ).scalars().all()
                if remaining:
                    print(f"user={u.id}: 学习 still has children {[c.name for c in remaining]}, NOT deleting")
                else:
                    await s.execute(delete(Category).where(Category.id == study.id))
                    print(f"user={u.id}: deleted 学习 parent")

            # 6. 购物 子类重命名
            for ch in [c for c in cats if c.parent_id == shopping.id]:
                if ch.name == "生鲜食材":
                    ch.name = "超市"
                    print(f"user={u.id}: renamed 生鲜食材 -> 超市")
                elif ch.name == "超市日用":
                    ch.name = "生活用品"
                    print(f"user={u.id}: renamed 超市日用 -> 生活用品")

            await s.commit()
        print("done")


if __name__ == "__main__":
    asyncio.run(main())
