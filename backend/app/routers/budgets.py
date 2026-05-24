from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Budget, Category, Transaction, User
from ..schemas.budget import BudgetCreate, BudgetProgress, BudgetRead, BudgetUpdate

router = APIRouter(prefix="/budgets", tags=["budgets"])


def _month_bounds(d: date) -> tuple[date, date]:
    start = d.replace(day=1)
    next_m = date(d.year + 1, 1, 1) if d.month == 12 else date(d.year, d.month + 1, 1)
    return start, next_m


def _year_bounds(d: date) -> tuple[date, date]:
    return date(d.year, 1, 1), date(d.year + 1, 1, 1)


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
