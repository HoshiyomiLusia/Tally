"""Rename AI product entries to company-name merchants for existing users.

Mapping: old product name -> new company name + aliases to add.
If both old and new exist for a user, merge: move tx/contact refs from old -> new,
delete old, ensure new has the alias backfill.

Run inside the container:
    docker compose exec app python scripts/rename_ai_merchants.py
"""
import asyncio

from sqlalchemy import delete, select, update

from app.core.db import SessionLocal
from app.models import Merchant, Transaction, User


RENAMES = [
    # (old_name, new_name, extra_aliases_csv)
    ("ChatGPT", "OpenAI", "ChatGPT,GPT,chat gpt,openai.com"),
    ("Claude", "Anthropic", "Claude,クロード,claude.ai,anthropic.com"),
    ("Gemini", "Google AI", "Gemini,Bard,Google Gemini,Google One"),
    ("GitHub Copilot", "GitHub", "Github,Copilot,GitHub Copilot,git"),
    ("Cursor", "Anysphere", "Cursor,cursor.sh"),
]


def merge_aliases(existing: str, addition: str) -> str:
    have = {a.strip() for a in (existing or "").split(",") if a.strip()}
    for a in addition.split(","):
        a = a.strip()
        if a:
            have.add(a)
    return ",".join(sorted(have))


async def main() -> None:
    async with SessionLocal() as s:
        users = (await s.execute(select(User))).scalars().all()
        for u in users:
            for old, new, extra in RENAMES:
                old_m = (
                    await s.execute(
                        select(Merchant).where(Merchant.user_id == u.id, Merchant.name == old)
                    )
                ).scalar_one_or_none()
                if old_m is None:
                    continue
                new_m = (
                    await s.execute(
                        select(Merchant).where(Merchant.user_id == u.id, Merchant.name == new)
                    )
                ).scalar_one_or_none()
                if new_m is None:
                    # Just rename in place
                    old_m.name = new
                    old_m.aliases = merge_aliases(old_m.aliases, extra)
                    print(f"user={u.id}: renamed {old!r} -> {new!r}")
                else:
                    # Merge: move tx refs, bump usage_count, delete old
                    moved = (
                        await s.execute(
                            update(Transaction)
                            .where(Transaction.user_id == u.id, Transaction.merchant_id == old_m.id)
                            .values(merchant_id=new_m.id)
                        )
                    ).rowcount
                    new_m.usage_count = (new_m.usage_count or 0) + (old_m.usage_count or 0)
                    new_m.aliases = merge_aliases(new_m.aliases, extra)
                    await s.execute(delete(Merchant).where(Merchant.id == old_m.id))
                    print(f"user={u.id}: merged {old!r} -> {new!r} (txs={moved})")
            await s.commit()
        print("done")


if __name__ == "__main__":
    asyncio.run(main())
