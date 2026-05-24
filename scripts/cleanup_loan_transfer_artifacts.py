"""清理上一版 move-loans 实现错误生成的"借贷调整转移"配对 transfer 交易.

之前的实现会创建 transfer_out / transfer_in 配对, note 以
"借贷调整转移:" 开头. 这次重设计成纯 attribution 后, 这些虚假转账不应
存在, 否则会双倍影响余额.

Run inside the container (会有 dry-run 打印再 commit):
    docker compose exec app python scripts/cleanup_loan_transfer_artifacts.py
"""
import asyncio

from sqlalchemy import delete, select

from app.core.db import SessionLocal
from app.models import Transaction


NOTE_PREFIX = "借贷调整转移:"


async def main() -> None:
    async with SessionLocal() as s:
        bad = (
            await s.execute(
                select(Transaction).where(
                    Transaction.kind.in_(("transfer_in", "transfer_out")),
                    Transaction.note.like(f"{NOTE_PREFIX}%"),
                )
            )
        ).scalars().all()
        if not bad:
            print("无需要清理的伪转账")
            return
        print(f"找到 {len(bad)} 条 (按 user 分):")
        for t in bad:
            print(f"  user={t.user_id} id={t.id} wallet={t.wallet_id} kind={t.kind} amount={t.amount} {t.currency_code} note={t.note!r}")
        # 直接删, 因为这是上一版逻辑产生的人为伪数据
        ids = [t.id for t in bad]
        await s.execute(delete(Transaction).where(Transaction.id.in_(ids)))
        await s.commit()
        print(f"已删除 {len(ids)} 条")


if __name__ == "__main__":
    asyncio.run(main())
