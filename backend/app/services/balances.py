from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Transaction, Wallet


# 借贷调整归属: 优先看 attributed_wallet_id, 没有就用原 wallet_id
def _loan_wallet():
    return func.coalesce(Transaction.attributed_wallet_id, Transaction.wallet_id)


async def wallet_balances(session: AsyncSession, user_id: int) -> dict[int, int]:
    """Wallet balance in Model A: initial + income + transfer_in - expense - transfer_out.
    loan_out and loan_repayment do NOT affect the wallet (intentional)."""
    signed = case(
        (Transaction.kind.in_(("income", "transfer_in")), Transaction.amount),
        (Transaction.kind.in_(("expense", "transfer_out")), -Transaction.amount),
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


async def loan_balances(session: AsyncSession, user_id: int) -> dict[tuple[int, str], int]:
    """Loan balance per (contact_id, currency): negative = contact owes me, positive = I owe them.

    loan_out increases the debit (more negative).
    loan_repayment reduces the debit (toward zero / positive)."""
    signed = case(
        (Transaction.kind == "loan_out", -Transaction.amount),
        (Transaction.kind == "loan_repayment", Transaction.amount),
        else_=0,
    )
    rows = (
        await session.execute(
            select(Transaction.contact_id, Transaction.currency_code, func.sum(signed))
            .where(Transaction.user_id == user_id, Transaction.contact_id.is_not(None))
            .group_by(Transaction.contact_id, Transaction.currency_code)
        )
    ).all()
    return {(cid, code): int(s or 0) for cid, code, s in rows if s}


async def investment_balances(session: AsyncSession, user_id: int) -> dict[tuple[int, str], int]:
    """每 (position_id, currency) 的剩余成本: Σinvest_buy - Σinvest_sell.
    >0 = 还持有这么多本金; ==0 = 已清仓."""
    signed = case(
        (Transaction.kind == "invest_buy", Transaction.amount),
        (Transaction.kind == "invest_sell", -Transaction.amount),
        else_=0,
    )
    rows = (
        await session.execute(
            select(Transaction.position_id, Transaction.currency_code, func.sum(signed))
            .where(Transaction.user_id == user_id, Transaction.position_id.is_not(None))
            .group_by(Transaction.position_id, Transaction.currency_code)
        )
    ).all()
    return {(pid, code): int(s or 0) for pid, code, s in rows if s}


async def all_wallet_investment_summary(session: AsyncSession, user_id: int) -> dict[int, tuple[int, int]]:
    """每钱包 (invest_buy_total, invest_sell_total) —— 投资买入像借出一样压低物理余额,
    卖出像还款一样抬回物理余额. 不与"借出"混在一起."""
    rows = (
        await session.execute(
            select(Transaction.wallet_id, Transaction.kind, func.sum(Transaction.amount))
            .where(
                Transaction.user_id == user_id,
                Transaction.kind.in_(("invest_buy", "invest_sell")),
            )
            .group_by(Transaction.wallet_id, Transaction.kind)
        )
    ).all()
    out: dict[int, list[int]] = {}
    for wid, kind, total in rows:
        bucket = out.setdefault(int(wid), [0, 0])
        if kind == "invest_buy":
            bucket[0] = int(total or 0)
        else:
            bucket[1] = int(total or 0)
    return {wid: (b[0], b[1]) for wid, b in out.items()}


async def wallet_investment_summary(session: AsyncSession, user_id: int, wallet_id: int) -> tuple[int, int]:
    """单钱包 (invest_buy_total, invest_sell_total)."""
    invest_out = (await session.execute(
        select(func.sum(Transaction.amount)).where(
            Transaction.user_id == user_id, Transaction.wallet_id == wallet_id,
            Transaction.kind == "invest_buy",
        )
    )).scalar() or 0
    invest_in = (await session.execute(
        select(func.sum(Transaction.amount)).where(
            Transaction.user_id == user_id, Transaction.wallet_id == wallet_id,
            Transaction.kind == "invest_sell",
        )
    )).scalar() or 0
    return int(invest_out), int(invest_in)


async def all_wallet_loan_summary(session: AsyncSession, user_id: int) -> dict[int, tuple[int, int]]:
    """Per-wallet (loan_out_total, loan_repayment_total) for ALL wallets at once,
    按 attributed_wallet_id (没设就用 wallet_id) 归集 —— 让"名义转移"生效."""
    aw = _loan_wallet().label("aw")
    rows = (
        await session.execute(
            select(aw, Transaction.kind, func.sum(Transaction.amount))
            .where(
                Transaction.user_id == user_id,
                Transaction.kind.in_(("loan_out", "loan_repayment")),
            )
            .group_by(aw, Transaction.kind)
        )
    ).all()
    out: dict[int, list[int]] = {}
    for wid, kind, total in rows:
        bucket = out.setdefault(int(wid), [0, 0])
        if kind == "loan_out":
            bucket[0] = int(total or 0)
        else:
            bucket[1] = int(total or 0)
    return {wid: (b[0], b[1]) for wid, b in out.items()}


async def wallet_loan_summary(session: AsyncSession, user_id: int, wallet_id: int) -> tuple[int, int]:
    """Per-wallet (loan_out_total, loan_repayment_total), 按 attributed wallet 归集."""
    aw = _loan_wallet()
    loan_out = (
        await session.execute(
            select(func.sum(Transaction.amount)).where(
                Transaction.user_id == user_id,
                aw == wallet_id,
                Transaction.kind == "loan_out",
            )
        )
    ).scalar() or 0
    loan_in = (
        await session.execute(
            select(func.sum(Transaction.amount)).where(
                Transaction.user_id == user_id,
                aw == wallet_id,
                Transaction.kind == "loan_repayment",
            )
        )
    ).scalar() or 0
    return int(loan_out), int(loan_in)
