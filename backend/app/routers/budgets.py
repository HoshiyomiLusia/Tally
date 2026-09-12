from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Budget, Category, Currency, Transaction, User
from ..schemas.budget import BudgetCreate, BudgetProgress, BudgetRead, BudgetUpdate, TotalBudgetSet, TotalBudgetView
from ..services.fx import base_converter, resolve_base_currency
from ..services.internal_cats import internal_cat_ids, not_internal

router = APIRouter(prefix="/budgets", tags=["budgets"])


def _month_bounds(d: date) -> tuple[date, date]:
    start = d.replace(day=1)
    next_m = date(d.year + 1, 1, 1) if d.month == 12 else date(d.year, d.month + 1, 1)
    return start, next_m


def _year_bounds(d: date) -> tuple[date, date]:
    return date(d.year, 1, 1), date(d.year + 1, 1, 1)


# ── 总预算 ────────────────────────────────────────────────────────────────
# 只有一条: 本位币金额 + 本月所有币种支出折算后的进度。用户要的是"一条总预算一条进度条",
# 不做分币种、不做分类预算(旧的 CRUD 接口保留, 界面上不再暴露)。
async def _find_total(session: AsyncSession, user: User, base: str) -> Budget | None:
    rows = (await session.execute(
        select(Budget).where(Budget.user_id == user.id, Budget.category_id.is_(None)).order_by(Budget.id)
    )).scalars().all()
    for b in rows:                       # 优先本位币那条
        if b.currency_code == base and b.active:
            return b
    return rows[0] if rows else None


@router.get("/total", response_model=TotalBudgetView)
async def get_total_budget(
    on_date: date | None = None,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    base = await resolve_base_currency(session, user)
    anchor = on_date or date.today()
    start, end = _month_bounds(anchor)
    b = await _find_total(session, user, base)
    amount = b.amount if (b and b.active) else 0

    conv, missing = await base_converter(session, base)
    skip_cats = await internal_cat_ids(session, user.id)
    rows = (await session.execute(
        select(Transaction.currency_code, func.sum(Transaction.amount)).where(and_(
            Transaction.user_id == user.id,
            Transaction.kind == "expense",
            Transaction.occurred_on >= start,
            Transaction.occurred_on < end,
            not_internal(skip_cats),
        )).group_by(Transaction.currency_code)
    )).all()
    spent = sum(conv(int(amt or 0), code) for code, amt in rows)

    days_in_month = (end - start).days
    days_elapsed = min(max((anchor - start).days + 1, 1), days_in_month)
    projected = int(round(spent / days_elapsed * days_in_month)) if days_elapsed else spent
    return TotalBudgetView(
        amount=amount, currency_code=base, spent=spent,
        remaining=amount - spent, percent=(spent / amount) if amount else 0.0,
        days_in_month=days_in_month, days_elapsed=days_elapsed, projected=projected,
        missing_rate_currencies=sorted(missing),
    )


@router.put("/total", response_model=TotalBudgetView)
async def set_total_budget(
    payload: TotalBudgetSet,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """写总预算。amount=0 表示不启用。会把该用户旧的多条预算收敛成这一条(用户已确认只要一条总预算)。"""
    base = await resolve_base_currency(session, user)
    olds = (await session.execute(
        select(Budget).where(Budget.user_id == user.id, Budget.category_id.is_(None))
    )).scalars().all()
    keep = None
    for b in olds:
        if keep is None and b.currency_code == base:
            keep = b
        else:
            await session.delete(b)
    if payload.amount <= 0:
        if keep is not None:
            await session.delete(keep)
    elif keep is not None:
        keep.amount, keep.active, keep.period, keep.note = payload.amount, True, "monthly", "总预算"
    else:
        session.add(Budget(user_id=user.id, category_id=None, currency_code=base,
                           period="monthly", amount=payload.amount, active=True, note="总预算"))
    await session.commit()
    return await get_total_budget(None, user, session)


@router.get("", response_model=list[BudgetRead])
async def list_budgets(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    rows = (await session.execute(select(Budget).where(Budget.user_id == user.id).order_by(Budget.id))).scalars().all()
    return rows


@router.post("", response_model=BudgetRead, status_code=status.HTTP_201_CREATED)
async def create_budget(
    payload: BudgetCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    if payload.category_id is not None:
        c = await session.get(Category, payload.category_id)
        if not c or c.user_id != user.id:
            raise HTTPException(400, "invalid category")
    # 审计 #130: 同 wallets —— 未知币种提前 400, 不落到 FK IntegrityError 500
    if not await session.get(Currency, payload.currency_code):
        raise HTTPException(400, "invalid currency_code")
    b = Budget(user_id=user.id, **payload.model_dump())
    session.add(b)
    await session.commit()
    await session.refresh(b)
    return b


@router.patch("/{bid}", response_model=BudgetRead)
async def update_budget(
    bid: int,
    payload: BudgetUpdate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    b = await session.get(Budget, bid)
    if not b or b.user_id != user.id:
        raise HTTPException(404)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(b, k, v)
    await session.commit()
    await session.refresh(b)
    return b


@router.delete("/{bid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_budget(
    bid: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    b = await session.get(Budget, bid)
    if not b or b.user_id != user.id:
        raise HTTPException(404)
    await session.delete(b)
    await session.commit()


@router.get("/progress", response_model=list[BudgetProgress])
async def budget_progress(
    on_date: date | None = None,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    anchor = on_date or date.today()
    budgets = (await session.execute(select(Budget).where(Budget.user_id == user.id, Budget.active == True))).scalars().all()  # noqa: E712
    cats = {c.id: c for c in (await session.execute(select(Category).where(Category.user_id == user.id))).scalars().all()}
    skip_cats = await internal_cat_ids(session, user.id)

    results: list[BudgetProgress] = []
    for b in budgets:
        if b.period == "monthly":
            start, end = _month_bounds(anchor)
        else:
            start, end = _year_bounds(anchor)
        conds = [
            Transaction.user_id == user.id,
            Transaction.kind == "expense",
            Transaction.currency_code == b.currency_code,
            Transaction.occurred_on >= start,
            Transaction.occurred_on < end,
            not_internal(skip_cats),
        ]
        if b.category_id is not None:
            child_ids = [cid for cid, c in cats.items() if c.parent_id == b.category_id]
            target_ids = [b.category_id, *child_ids]
            conds.append(Transaction.category_id.in_(target_ids))
        spent = (await session.execute(select(func.sum(Transaction.amount)).where(and_(*conds)))).scalar() or 0
        spent = int(spent)
        cat_name = cats[b.category_id].name if b.category_id and b.category_id in cats else "总预算"
        results.append(BudgetProgress(
            budget_id=b.id,
            category_id=b.category_id,
            category_name=cat_name,
            currency_code=b.currency_code,
            period=b.period,
            budget_amount=b.amount,
            spent=spent,
            remaining=b.amount - spent,
            percent=(spent / b.amount) if b.amount else 0,
        ))
    return results
