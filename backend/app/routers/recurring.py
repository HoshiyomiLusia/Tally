import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends
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


class ForecastItem(BaseModel):
    transaction: TransactionRead
    due: date          # confirmed=本期实际扣款日, due/predicted=预测扣款日
    status: str        # "confirmed" 已确认 | "due" 过期待确认 | "predicted" 未来预测


@router.get("/upcoming", response_model=list[ForecastItem])
async def upcoming(
    days: int = 14,
    back: int = 7,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """周期账单预测窗口 [今天-back, 今天+days], 每个账单可能给出两类条目:
      - confirmed: 最近一期真实扣款已记录(occurred_on 落在回看窗口内) -> 绿色已确认
      - due/predicted: 下一期预测扣款日, 过期未记 = due(待确认), 未来 = predicted
    这样点了"确认扣款"后, 该期从 due 变成 confirmed 留在原地, 而不是消失."""
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

    items: list[ForecastItem] = []
    for t in seen.values():
        if not t.recurrence_period_days:
            continue
        # 本期已记录的真实扣款 (最新一笔落在回看窗内)
        if floor <= t.occurred_on <= today:
            items.append(ForecastItem(transaction=t, due=t.occurred_on, status="confirmed"))
        # 下一期预测
        next_due = t.occurred_on + timedelta(days=t.recurrence_period_days)
        if floor <= next_due <= horizon:
            items.append(ForecastItem(
                transaction=t, due=next_due,
                status="due" if next_due <= today else "predicted",
            ))
    items.sort(key=lambda x: x.due)
    return items


async def resolve_recurrence_group(session: AsyncSession, user: User, source_id: int | None) -> str | None:
    """确认周期账单本期扣款时, 让新账单并入来源账单的 recurrence_group ——
    来源原本是单条没分组的, 就顺手给它补一个 group, 这样预测永远以最新一条为准,
    过期那条不再反复出现. 返回 group_id (无来源/来源非法则 None)."""
    if source_id is None:
        return None
    src = (
        await session.execute(
            select(Transaction).where(
                Transaction.id == source_id,
                Transaction.user_id == user.id,
                Transaction.is_recurring == True,  # noqa: E712
            )
        )
    ).scalar_one_or_none()
    if src is None:
        return None
    if src.recurrence_group_id is None:
        src.recurrence_group_id = str(uuid.uuid4())
        await session.flush()
    return src.recurrence_group_id


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
