from datetime import date, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Category, Currency, ExchangeRate, Merchant, Transaction, User, Wallet
from ..services.balances import wallet_balances

router = APIRouter(prefix="/stats", tags=["stats"])


class MonthlyPoint(BaseModel):
    month: str
    currency_code: str
    income: int
    expense: int


class DailyPoint(BaseModel):
    on_date: date
    currency_code: str
    amount: int


class CategoryTrendPoint(BaseModel):
    month: str
    category_id: int | None
    category_name: str
    currency_code: str
    amount: int


class TopTx(BaseModel):
    id: int
    occurred_on: date
    amount: int
    currency_code: str
    category_name: str
    note: str


class CrossCurrencyTotal(BaseModel):
    base_currency: str
    total: int
    breakdown: list[dict]


class CurrencySummary(BaseModel):
    currency_code: str
    income: int
    expense: int
    net: int
    income_prev: int
    expense_prev: int
    days_in_month: int
    avg_daily_expense: int


class SummaryResponse(BaseModel):
    month: str
    per_currency: list[CurrencySummary]


class CategoryCompare(BaseModel):
    category_id: int | None
    category_name: str
    emoji: str
    currency_code: str
    current: int
    previous: int
    delta: int


class TopMerchant(BaseModel):
    merchant_id: int | None
    merchant_name: str
    currency_code: str
    total: int
    count: int


def _add_months(d: date, n: int) -> date:
    m = d.month - 1 + n
    return date(d.year + m // 12, m % 12 + 1, 1)


def _month_bounds(anchor: date) -> tuple[date, date]:
    start = anchor.replace(day=1)
    end = _add_months(start, 1)
    return start, end


@router.get("/summary", response_model=SummaryResponse)
async def summary(
    month: str | None = None,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    today = date.today()
    anchor = date.fromisoformat(month + "-01") if month and len(month) == 7 else today
    cur_start, cur_end = _month_bounds(anchor)
    prev_start, prev_end = _month_bounds(_add_months(cur_start, -1))

    income = case((Transaction.kind == "income", Transaction.amount), else_=0)
    expense = case((Transaction.kind == "expense", Transaction.amount), else_=0)

    cur_rows = (
        await session.execute(
            select(Transaction.currency_code, func.sum(income), func.sum(expense))
            .where(
                Transaction.user_id == user.id,
                Transaction.occurred_on >= cur_start,
                Transaction.occurred_on < cur_end,
                Transaction.kind.in_(("income", "expense")),
            )
            .group_by(Transaction.currency_code)
        )
    ).all()
    prev_rows = (
        await session.execute(
            select(Transaction.currency_code, func.sum(income), func.sum(expense))
            .where(
                Transaction.user_id == user.id,
                Transaction.occurred_on >= prev_start,
                Transaction.occurred_on < prev_end,
                Transaction.kind.in_(("income", "expense")),
            )
            .group_by(Transaction.currency_code)
        )
    ).all()

    days_in_cur = (cur_end - cur_start).days
    days_elapsed = min(days_in_cur, max(1, (min(today, cur_end - timedelta(days=1)) - cur_start).days + 1)) if today >= cur_start else days_in_cur

    prev_map = {c: (int(i or 0), int(e or 0)) for c, i, e in prev_rows}
    codes = {c for c, _, _ in cur_rows} | set(prev_map.keys())
    out: list[CurrencySummary] = []
    cur_map = {c: (int(i or 0), int(e or 0)) for c, i, e in cur_rows}
    for code in sorted(codes):
        cur_i, cur_e = cur_map.get(code, (0, 0))
        prev_i, prev_e = prev_map.get(code, (0, 0))
        avg = cur_e // max(1, days_elapsed)
        out.append(CurrencySummary(
            currency_code=code,
            income=cur_i, expense=cur_e, net=cur_i - cur_e,
            income_prev=prev_i, expense_prev=prev_e,
            days_in_month=days_in_cur,
            avg_daily_expense=avg,
        ))

    return SummaryResponse(month=cur_start.strftime("%Y-%m"), per_currency=out)


@router.get("/category-compare", response_model=list[CategoryCompare])
async def category_compare(
    month: str | None = None,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    today = date.today()
    anchor = date.fromisoformat(month + "-01") if month and len(month) == 7 else today
    cur_start, cur_end = _month_bounds(anchor)
    prev_start, prev_end = _month_bounds(_add_months(cur_start, -1))

    async def fetch(start, end):
        rows = (
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
                    Transaction.occurred_on < end,
                )
                .group_by(Transaction.category_id, Category.name, Category.emoji, Transaction.currency_code)
            )
        ).all()
        return {(cid, code): (name, emoji, int(amt or 0)) for cid, name, emoji, code, amt in rows}

    cur = await fetch(cur_start, cur_end)
    prev = await fetch(prev_start, prev_end)
    keys = set(cur.keys()) | set(prev.keys())
    out: list[CategoryCompare] = []
    for cid, code in keys:
        cur_name, cur_emoji, cur_amt = cur.get((cid, code), (None, "", 0))
        prev_name, prev_emoji, prev_amt = prev.get((cid, code), (None, "", 0))
        out.append(CategoryCompare(
            category_id=cid,
            category_name=cur_name or prev_name or "未分类",
            emoji=cur_emoji or prev_emoji or "",
            currency_code=code,
            current=cur_amt,
            previous=prev_amt,
            delta=cur_amt - prev_amt,
        ))
    out.sort(key=lambda x: (-x.current, -x.previous))
    return out


@router.get("/top-merchants", response_model=list[TopMerchant])
async def top_merchants(
    limit: int = 10,
    month: str | None = None,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    today = date.today()
    anchor = date.fromisoformat(month + "-01") if month and len(month) == 7 else today
    start, end = _month_bounds(anchor)

    rows = (
        await session.execute(
            select(
                Transaction.merchant_id,
                Merchant.name,
                Transaction.currency_code,
                func.sum(Transaction.amount),
                func.count(Transaction.id),
            )
            .join(Merchant, Merchant.id == Transaction.merchant_id, isouter=True)
            .where(
                Transaction.user_id == user.id,
                Transaction.kind == "expense",
                Transaction.occurred_on >= start,
                Transaction.occurred_on < end,
                Transaction.merchant_id.is_not(None),
            )
            .group_by(Transaction.merchant_id, Merchant.name, Transaction.currency_code)
            .order_by(func.sum(Transaction.amount).desc())
            .limit(limit)
        )
    ).all()
    return [
        TopMerchant(merchant_id=mid, merchant_name=name or "?", currency_code=c, total=int(amt or 0), count=int(cnt or 0))
        for mid, name, c, amt, cnt in rows
    ]


@router.get("/monthly-trend", response_model=list[MonthlyPoint])
async def monthly_trend(
    months: int = 12,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    today = date.today()
    start = _add_months(today.replace(day=1), -(months - 1))
    income_amt = case((Transaction.kind == "income", Transaction.amount), else_=0)
    expense_amt = case((Transaction.kind == "expense", Transaction.amount), else_=0)
    rows = (
        await session.execute(
            select(
                func.strftime("%Y-%m", Transaction.occurred_on).label("ym"),
                Transaction.currency_code,
                func.sum(income_amt),
                func.sum(expense_amt),
            )
            .where(
                Transaction.user_id == user.id,
                Transaction.occurred_on >= start,
                Transaction.kind.in_(("income", "expense")),
            )
            .group_by("ym", Transaction.currency_code)
            .order_by("ym")
        )
    ).all()
    return [MonthlyPoint(month=ym, currency_code=c, income=int(inc or 0), expense=int(exp or 0)) for ym, c, inc, exp in rows]


@router.get("/daily", response_model=list[DailyPoint])
async def daily(
    start: date | None = None,
    end: date | None = None,
    kind: str = "expense",
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    today = date.today()
    if not end:
        end = today
    if not start:
        start = end - timedelta(days=90)
    rows = (
        await session.execute(
            select(Transaction.occurred_on, Transaction.currency_code, func.sum(Transaction.amount))
            .where(
                Transaction.user_id == user.id,
                Transaction.kind == kind,
                Transaction.occurred_on >= start,
                Transaction.occurred_on <= end,
            )
            .group_by(Transaction.occurred_on, Transaction.currency_code)
            .order_by(Transaction.occurred_on)
        )
    ).all()
    return [DailyPoint(on_date=d, currency_code=c, amount=int(a or 0)) for d, c, a in rows]


@router.get("/category-trend", response_model=list[CategoryTrendPoint])
async def category_trend(
    months: int = 6,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    today = date.today()
    start = _add_months(today.replace(day=1), -(months - 1))
    rows = (
        await session.execute(
            select(
                func.strftime("%Y-%m", Transaction.occurred_on).label("ym"),
                Transaction.category_id,
                Category.name,
                Transaction.currency_code,
                func.sum(Transaction.amount),
            )
            .join(Category, Category.id == Transaction.category_id, isouter=True)
            .where(
                Transaction.user_id == user.id,
                Transaction.occurred_on >= start,
                Transaction.kind == "expense",
            )
            .group_by("ym", Transaction.category_id, Category.name, Transaction.currency_code)
            .order_by("ym")
        )
    ).all()
    return [
        CategoryTrendPoint(month=ym, category_id=cid, category_name=name or "未分类", currency_code=c, amount=int(a or 0))
        for ym, cid, name, c, a in rows
    ]


@router.get("/top", response_model=list[TopTx])
async def top_transactions(
    limit: int = 10,
    start: date | None = None,
    end: date | None = None,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    stmt = (
        select(Transaction.id, Transaction.occurred_on, Transaction.amount, Transaction.currency_code, Category.name, Transaction.note)
        .join(Category, Category.id == Transaction.category_id, isouter=True)
        .where(Transaction.user_id == user.id, Transaction.kind == "expense")
        .order_by(Transaction.amount.desc())
        .limit(limit)
    )
    if start:
        stmt = stmt.where(Transaction.occurred_on >= start)
    if end:
        stmt = stmt.where(Transaction.occurred_on <= end)
    rows = (await session.execute(stmt)).all()
    return [TopTx(id=i, occurred_on=d, amount=int(a), currency_code=c, category_name=n or "未分类", note=note) for i, d, a, c, n, note in rows]


@router.get("/cross-currency-total", response_model=CrossCurrencyTotal)
async def cross_currency_total(
    base: str = "JPY",
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    balances = await wallet_balances(session, user.id)
    wallets = (await session.execute(select(Wallet).where(Wallet.user_id == user.id, Wallet.archived == False))).scalars().all()  # noqa: E712

    digits = {c: d for c, d in (await session.execute(select(Currency.code, Currency.decimal_digits))).all()}
    base_d = digits.get(base, 2)

    by_currency: dict[str, int] = {}
    for w in wallets:
        by_currency[w.currency_code] = by_currency.get(w.currency_code, 0) + balances.get(w.id, w.initial_balance)

    rate_rows = (
        await session.execute(
            select(ExchangeRate.base, ExchangeRate.quote, ExchangeRate.rate, ExchangeRate.on_date)
            .order_by(ExchangeRate.on_date.desc())
        )
    ).all()
    rates: dict[tuple[str, str], float] = {}
    for b, q, r, d in rate_rows:
        if (b, q) not in rates:
            rates[(b, q)] = r
        if (q, b) not in rates:
            rates[(q, b)] = 1.0 / r if r else 0.0

    total = 0
    breakdown = []
    for code, amt in by_currency.items():
        code_d = digits.get(code, 2)
        if code == base:
            conv = amt
            rate = 1.0
        else:
            rate = rates.get((code, base)) or 0.0
            conv = int(amt * rate * (10 ** (base_d - code_d)))
        total += conv
        breakdown.append({"currency_code": code, "balance": amt, "rate": rate, "converted": conv})
    return CrossCurrencyTotal(base_currency=base, total=total, breakdown=breakdown)
