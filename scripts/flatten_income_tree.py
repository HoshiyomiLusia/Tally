"""One-shot migration: turn the old "收入" parent into flat top-level income
categories. Children of "收入" become top-level (parent_id = NULL); the now-empty
"收入" parent is deleted. Safe to re-run — looks up by name + kind + null-parent.

Run inside the container:
    docker compose exec app python scripts/flatten_income_tree.py
"""
import asyncio

from sqlalchemy import select, update, delete

from app.core.db import SessionLocal
from app.models import Category


async def main() -> None:
    async with SessionLocal() as s:
        roots = (
            await s.execute(
                select(Category).where(
                    Category.kind == "income",
                    Category.parent_id.is_(None),
                    Category.name == "收入",
                )
            )
        ).scalars().all()
        if not roots:
            print("no 收入 parents found; nothing to do")
            return
        for r in roots:
            kids = (
                await s.execute(
                    select(Category).where(Category.parent_id == r.id)
                )
            ).scalars().all()
            print(f"user={r.user_id} 收入(id={r.id}) → {len(kids)} children moved to top-level")
            await s.execute(
                update(Category)
                .where(Category.parent_id == r.id)
                .values(parent_id=None)
            )
            await s.execute(delete(Category).where(Category.id == r.id))
        await s.commit()
        print("done")


if __name__ == "__main__":
    asyncio.run(main())
