from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Category, Transaction, User, Wallet
from ..schemas.dashboard import (
    CategoryBreakdownItem,
    CurrencyTotals,
    DashboardResponse,
    WalletBalanceItem,
)
from ..schemas.transaction import TransactionRead
from ..services.balances import (
    all_wallet_investment_summary,
    all_wallet_loan_summary,
    wallet_balances,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _month_bounds(d: date) -> tuple[date, date]:
    start = d.replace(day=1)
    if d.month == 12:
        next_m = d.replace(year=d.year + 1, month=1, day=1)
    else:
        next_m = d.replace(month=d.month + 1, day=1)
    return start, next_m


@router.get("", response_model=DashboardResponse)
async def get_dashboard(
    month: str | None = None,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    today = date.today()
    if month:
        anchor = date.fromisoformat(month + "-01") if len(month) == 7 else date.fromisoformat(month)
    else:
        anchor = today
    start, next_m = _month_bounds(anchor)

    wallets = (
        await session.execute(select(Wallet).where(Wallet.user_id == user.id).order_by(Wallet.sort_order, Wallet.id))
    ).scalars().all()
    balances = await wallet_balances(session, user.id)
    loans = await all_wallet_loan_summary(session, user.id)
    invests = await all_wallet_investment_summary(session, user.id)
    wallet_items = [
        WalletBalanceItem(
            wallet_id=w.id,
            wallet_name=w.name,
            currency_code=w.currency_code,
            balance=balances.get(w.id, w.initial_balance),
            type=w.type,
            archived=w.archived,
            loan_out_on_wallet=loans.get(w.id, (0, 0))[0],
            loan_repayment_on_wallet=loans.get(w.id, (0, 0))[1],
            invest_out_on_wallet=invests.get(w.id, (0, 0))[0],
            invest_in_on_wallet=invests.get(w.id, (0, 0))[1],
        )
        for w in wallets
    ]

    income_amt = case((Transaction.kind == "income", Transaction.amount), else_=0)
    expense_amt = case((Transaction.kind == "expense", Transaction.amount), else_=0)
    totals_rows = (
        await session.execute(
            select(
                Transaction.currency_code,
                func.sum(income_amt),
                func.sum(expense_amt),
            )
            .where(
                Transaction.user_id == user.id,
                Transaction.occurred_on >= start,
                Transaction.occurred_on < next_m,
            )
            .group_by(Transaction.currency_code)
        )
    ).all()
    month_totals = [
        CurrencyTotals(
            currency_code=code,
            income=int(inc or 0),
            expense=int(exp or 0),
            net=int(inc or 0) - int(exp or 0),
        )
        for code, inc, exp in totals_rows
    ]

    breakdown_rows = (
        await session.execute(
            select(
                Transaction.category_id,
                Category.name,
                Category.emoji,
                Transaction.currency_code,
                func.sum(Transaction.amount),
            )
            .join(Category, Category.id == Transaction.category_id, isouter=True)
            .where(
                Transaction.user_id == user.id,
                Transaction.kind == "expense",
                Transaction.occurred_on >= start,
                Transaction.occurred_on < next_m,
            )
            .group_by(Transaction.category_id, Category.name, Category.emoji, Transaction.currency_code)
            .order_by(func.sum(Transaction.amount).desc())
        )
    ).all()
    breakdown = [
        CategoryBreakdownItem(
            category_id=cid,
            category_name=name or "未分类",
            emoji=emoji or "",
            amount=int(amt or 0),
            currency_code=code,
        )
        for cid, name, emoji, code, amt in breakdown_rows
    ]

    recent = (
        await session.execute(
            select(Transaction)
            .where(Transaction.user_id == user.id)
            .order_by(Transaction.occurred_on.desc(), Transaction.id.desc())
            .limit(10)
        )
    ).scalars().all()

    return DashboardResponse(
        month=anchor.strftime("%Y-%m"),
        wallet_balances=wallet_items,
        month_totals=month_totals,
        category_breakdown=breakdown,
        recent_transactions=[TransactionRead.model_validate(t) for t in recent],
    )
