from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Transaction, Wallet


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


async def all_wallet_loan_summary(session: AsyncSession, user_id: int) -> dict[int, tuple[int, int]]:
    """Per-wallet (loan_out_total, loan_repayment_total) for ALL wallets at once.
    Avoids the N+1 of calling wallet_loan_summary in a loop."""
    rows = (
        await session.execute(
            select(Transaction.wallet_id, Transaction.kind, func.sum(Transaction.amount))
            .where(
                Transaction.user_id == user_id,
                Transaction.kind.in_(("loan_out", "loan_repayment")),
            )
            .group_by(Transaction.wallet_id, Transaction.kind)
        )
    ).all()
    out: dict[int, list[int]] = {}
    for wid, kind, total in rows:
        bucket = out.setdefault(wid, [0, 0])
        if kind == "loan_out":
            bucket[0] = int(total or 0)
        else:
            bucket[1] = int(total or 0)
    return {wid: (b[0], b[1]) for wid, b in out.items()}


async def wallet_loan_summary(session: AsyncSession, user_id: int, wallet_id: int) -> tuple[int, int]:
    """For per-wallet reconciliation in Model A.

    Returns (loan_out_total, loan_repayment_total) on this specific wallet.
    physical_balance = system_balance - loan_out_total + loan_repayment_total
    """
    loan_out = (
        await session.execute(
            select(func.sum(Transaction.amount)).where(
                Transaction.user_id == user_id,
                Transaction.wallet_id == wallet_id,
                Transaction.kind == "loan_out",
            )
        )
    ).scalar() or 0
    loan_in = (
        await session.execute(
            select(func.sum(Transaction.amount)).where(
                Transaction.user_id == user_id,
                Transaction.wallet_id == wallet_id,
                Transaction.kind == "loan_repayment",
            )
        )
    ).scalar() or 0
    return int(loan_out), int(loan_in)
