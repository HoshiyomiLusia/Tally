from datetime import date, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Category, Transaction, User, Wallet
from ..schemas.transaction import TransactionRead

router = APIRouter(prefix="/recurring", tags=["recurring"])


class RecurringGroup(BaseModel):
    group_id: str | None
    representative_id: int
    name: str
    category_id: int | None
    category_name: str
    category_emoji: str
    wallet_id: int
    wallet_name: str
    currency_code: str
    period_days: int | None
    count: int
    total_amount: int
    avg_amount: int
    last_amount: int
    last_on: date
    next_due: date | None


@router.get("/upcoming", response_model=list[TransactionRead])
async def upcoming(
    days: int = 14,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    rows = (
        await session.execute(
            select(Transaction).where(
                Transaction.user_id == user.id,
                Transaction.is_recurring == True,  # noqa: E712
                Transaction.recurrence_period_days.is_not(None),
            )
        )
    ).scalars().all()

    today = date.today()
    horizon = today + timedelta(days=days)
    seen: dict[tuple[str | None, int | None], Transaction] = {}
    for t in rows:
        key = (t.recurrence_group_id, t.id if t.recurrence_group_id is None else None)
        existing = seen.get(key)
        if existing is None or t.occurred_on > existing.occurred_on:
            seen[key] = t

    upcoming_list: list[Transaction] = []
    for t in seen.values():
        if not t.recurrence_period_days:
            continue
        next_due = t.occurred_on + timedelta(days=t.recurrence_period_days)
        if today <= next_due <= horizon:
            upcoming_list.append(t)
    upcoming_list.sort(key=lambda x: x.occurred_on + timedelta(days=x.recurrence_period_days or 0))
    return upcoming_list


@router.get("/groups", response_model=list[RecurringGroup])
async def list_groups(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    rows = (
        await session.execute(
            select(Transaction).where(
                Transaction.user_id == user.id,
                Transaction.is_recurring == True,  # noqa: E712
            )
        )
    ).scalars().all()

    wallets = {w.id: w for w in (await session.execute(select(Wallet).where(Wallet.user_id == user.id))).scalars().all()}
    cats = {c.id: c for c in (await session.execute(select(Category).where(Category.user_id == user.id))).scalars().all()}

    bucket: dict[tuple, list[Transaction]] = {}
    for t in rows:
        key = (t.recurrence_group_id, None) if t.recurrence_group_id else ("__single__", t.id)
        bucket.setdefault(key, []).append(t)

    out: list[RecurringGroup] = []
    today = date.today()
    for key, txs in bucket.items():
        txs.sort(key=lambda x: x.occurred_on)
        latest = txs[-1]
        wallet = wallets.get(latest.wallet_id)
        cat = cats.get(latest.category_id) if latest.category_id else None
        period = latest.recurrence_period_days
        next_due = latest.occurred_on + timedelta(days=period) if period else None
        name = (latest.note or cat.name if cat else None) or "未命名周期账单"
        total = sum(t.amount for t in txs)
        avg = total // max(1, len(txs))
        out.append(RecurringGroup(
            group_id=latest.recurrence_group_id,
            representative_id=latest.id,
            name=name,
            category_id=latest.category_id,
            category_name=cat.name if cat else "未分类",
            category_emoji=cat.emoji if cat else "",
            wallet_id=latest.wallet_id,
            wallet_name=wallet.name if wallet else "?",
            currency_code=latest.currency_code,
            period_days=period,
            count=len(txs),
            total_amount=total,
            avg_amount=avg,
            last_amount=latest.amount,
            last_on=latest.occurred_on,
            next_due=next_due,
        ))
    out.sort(key=lambda g: (g.next_due is None, g.next_due or today, g.name))
    return out


class MonthlyRecurringItem(BaseModel):
    transaction_id: int
    occurred_on: date
    name: str
    category_id: int | None
    category_name: str
    category_emoji: str
    wallet_id: int
    wallet_name: str
    currency_code: str
    amount: int
    frequency: str  # "monthly" | "yearly" | "other"


class MonthlyRecurringResponse(BaseModel):
    month: str
    monthly_items: list[MonthlyRecurringItem]
    yearly_items: list[MonthlyRecurringItem]
    monthly_totals: dict[str, int]
    yearly_totals: dict[str, int]


@router.get("/by-month", response_model=MonthlyRecurringResponse)
async def by_month(
    month: str | None = None,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    today = date.today()
    anchor = date.fromisoformat(month + "-01") if month and len(month) == 7 else today
    m_start = anchor.replace(day=1)
    m_end = date(anchor.year + 1, 1, 1) if anchor.month == 12 else date(anchor.year, anchor.month + 1, 1)
    y_start = date(anchor.year, 1, 1)
    y_end = date(anchor.year + 1, 1, 1)

    rows = (
        await session.execute(
            select(Transaction).where(
                Transaction.user_id == user.id,
                Transaction.is_recurring == True,  # noqa: E712
                Transaction.kind == "expense",
                Transaction.occurred_on >= y_start,
                Transaction.occurred_on < y_end,
            )
        )
    ).scalars().all()

    wallets = {w.id: w for w in (await session.execute(select(Wallet).where(Wallet.user_id == user.id))).scalars().all()}
    cats = {c.id: c for c in (await session.execute(select(Category).where(Category.user_id == user.id))).scalars().all()}

    monthly: list[MonthlyRecurringItem] = []
    yearly: list[MonthlyRecurringItem] = []
    m_tot: dict[str, int] = {}
    y_tot: dict[str, int] = {}

    for t in rows:
        wallet = wallets.get(t.wallet_id)
        cat = cats.get(t.category_id) if t.category_id else None
        is_yearly = t.recurrence_period_days == 365
        is_monthly_freq = t.recurrence_period_days == 30 or t.recurrence_period_days is None or not is_yearly
        item = MonthlyRecurringItem(
            transaction_id=t.id,
            occurred_on=t.occurred_on,
            name=(t.note or (cat.name if cat else None) or "未命名"),
            category_id=t.category_id,
            category_name=cat.name if cat else "未分类",
            category_emoji=cat.emoji if cat else "",
            wallet_id=t.wallet_id,
            wallet_name=wallet.name if wallet else "?",
            currency_code=t.currency_code,
            amount=t.amount,
            frequency="yearly" if is_yearly else ("monthly" if t.recurrence_period_days == 30 else "other"),
        )
        if is_yearly:
            yearly.append(item)
            y_tot[t.currency_code] = y_tot.get(t.currency_code, 0) + t.amount
        elif m_start <= t.occurred_on < m_end:
            monthly.append(item)
            m_tot[t.currency_code] = m_tot.get(t.currency_code, 0) + t.amount

    monthly.sort(key=lambda x: x.occurred_on)
    yearly.sort(key=lambda x: x.occurred_on)

    return MonthlyRecurringResponse(
        month=m_start.strftime("%Y-%m"),
        monthly_items=monthly,
        yearly_items=yearly,
        monthly_totals=m_tot,
        yearly_totals=y_tot,
    )
