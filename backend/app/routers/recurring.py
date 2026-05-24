from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Transaction, User
from ..schemas.transaction import TransactionRead

router = APIRouter(prefix="/recurring", tags=["recurring"])


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
