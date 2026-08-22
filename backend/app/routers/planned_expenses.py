from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Currency, PlannedExpense, User
from ..schemas.planned_expense import PlannedExpenseCreate, PlannedExpenseRead

router = APIRouter(prefix="/planned-expenses", tags=["planned_expenses"])


@router.get("", response_model=list[PlannedExpenseRead])
async def list_planned(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    rows = (
        await session.execute(
            select(PlannedExpense)
            .where(PlannedExpense.user_id == user.id)
            .order_by(PlannedExpense.due_date.is_(None), PlannedExpense.due_date, PlannedExpense.id)
        )
    ).scalars().all()
    return rows


@router.post("", response_model=PlannedExpenseRead, status_code=status.HTTP_201_CREATED)
async def create_planned(
    payload: PlannedExpenseCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    if not await session.get(Currency, payload.currency_code):
        raise HTTPException(400, "invalid currency_code")
    p = PlannedExpense(user_id=user.id, **payload.model_dump())
    session.add(p)
    await session.commit()
    await session.refresh(p)
    return p


@router.delete("/{pid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_planned(
    pid: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    p = await session.get(PlannedExpense, pid)
    if not p or p.user_id != user.id:
        raise HTTPException(404)
    await session.delete(p)
    await session.commit()
