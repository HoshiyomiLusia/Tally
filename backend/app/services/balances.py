from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Transaction, Wallet


async def wallet_balances(session: AsyncSession, user_id: int) -> dict[int, int]:
    signed = case(
        (Transaction.kind == "income", Transaction.amount),
        (Transaction.kind == "expense", -Transaction.amount),
        else_=0,
    )
    rows = (
        await session.execute(
            select(Transaction.wallet_id, func.sum(signed))
            .where(Transaction.user_id == user_id)
            .group_by(Transaction.wallet_id)
        )
    ).all()
    sums = {wid: int(s or 0) for wid, s in rows}

    wallet_rows = (await session.execute(select(Wallet).where(Wallet.user_id == user_id))).scalars().all()
    return {w.id: w.initial_balance + sums.get(w.id, 0) for w in wallet_rows}
