import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Category, Merchant, Transaction, User, Wallet
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
    back: int = 0,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """预计扣款窗口 [今天-back, 今天+days].
    days>0 看未来即将到期; back>0 看过去 back 天内已预计扣款 (方便回头补记账)."""
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
    floor = today - timedelta(days=back)
    seen: dict[tuple[str | None, int | None], Transaction] = {}
    for t in rows:
        key = (t.recurrence_group_id, t.id if t.recurrence_group_id is None else None)
        existing = seen.get(key)
        if existing is None or t.occurred_on > existing.occurred_on:
            seen[key] = t

    out: list[Transaction] = []
    for t in seen.values():
        if not t.recurrence_period_days:
            continue
        next_due = t.occurred_on + timedelta(days=t.recurrence_period_days)
        if floor <= next_due <= horizon:
            out.append(t)
    out.sort(key=lambda x: x.occurred_on + timedelta(days=x.recurrence_period_days or 0))
    return out


class ConfirmChargeRequest(BaseModel):
    amount: int
    occurred_on: date
    wallet_id: int
    note: str | None = None


@router.post("/{tx_id}/confirm", response_model=TransactionRead, status_code=201)
async def confirm_charge(
    tx_id: int,
    payload: ConfirmChargeRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """确认某笔周期账单本期实际扣款: 照模板生成一笔真实账单 (金额/日期/账户可改),
    并让新旧同组, 这样下次预测自动顺延一个周期, 过期那条不再反复出现."""
    src = (
        await session.execute(
            select(Transaction).where(
                Transaction.id == tx_id,
                Transaction.user_id == user.id,
                Transaction.is_recurring == True,  # noqa: E712
            )
        )
    ).scalar_one_or_none()
    if src is None:
        raise HTTPException(404, "recurring transaction not found")
    if payload.amount <= 0:
        raise HTTPException(400, "amount must be positive")
    wallet = (
        await session.execute(
            select(Wallet).where(Wallet.id == payload.wallet_id, Wallet.user_id == user.id)
        )
    ).scalar_one_or_none()
    if wallet is None:
        raise HTTPException(404, "wallet not found")
    if wallet.currency_code != src.currency_code:
        raise HTTPException(400, "currency must match the bill")

    # 单条(无 group)的话给新旧都打上同一 group, 预测以最新一条为准, 不会重复
    group_id = src.recurrence_group_id
    if group_id is None:
        group_id = str(uuid.uuid4())
        src.recurrence_group_id = group_id

    t = Transaction(
        user_id=user.id,
        wallet_id=payload.wallet_id,
        category_id=src.category_id,
        merchant_id=src.merchant_id,
        amount=payload.amount,
        currency_code=src.currency_code,
        kind=src.kind,
        occurred_on=payload.occurred_on,
        note=src.note if payload.note is None else payload.note,
        is_recurring=True,
        recurrence_period_days=src.recurrence_period_days,
        recurrence_group_id=group_id,
    )
    session.add(t)
    if src.merchant_id:
        m = await session.get(Merchant, src.merchant_id)
        if m and m.user_id == user.id:
            m.usage_count += 1
    await session.commit()
    await session.refresh(t)
    return t


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
    merchant_id: int | None = None
    merchant_name: str = ""
    note: str = ""
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
    merchants_map = {m.id: m for m in (await session.execute(select(Merchant).where(Merchant.user_id == user.id))).scalars().all()}

    monthly: list[MonthlyRecurringItem] = []
    yearly: list[MonthlyRecurringItem] = []
    m_tot: dict[str, int] = {}
    y_tot: dict[str, int] = {}

    for t in rows:
        wallet = wallets.get(t.wallet_id)
        cat = cats.get(t.category_id) if t.category_id else None
        merchant = merchants_map.get(t.merchant_id) if t.merchant_id else None
        is_yearly = t.recurrence_period_days == 365
        is_monthly_freq = t.recurrence_period_days == 30 or t.recurrence_period_days is None or not is_yearly
        item = MonthlyRecurringItem(
            transaction_id=t.id,
            occurred_on=t.occurred_on,
            name=(merchant.name if merchant else None) or t.note or (cat.name if cat else None) or "未命名",
            category_id=t.category_id,
            category_name=cat.name if cat else "未分类",
            category_emoji=cat.emoji if cat else "",
            merchant_id=t.merchant_id,
            merchant_name=merchant.name if merchant else "",
            note=t.note or "",
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
