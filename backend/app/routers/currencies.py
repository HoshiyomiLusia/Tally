from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Currency, User
from ..schemas.currency import CurrencyRead

router = APIRouter(prefix="/currencies", tags=["currencies"])


@router.get("", response_model=list[CurrencyRead])
async def list_currencies(
    _: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    rows = (await session.execute(select(Currency).order_by(Currency.code))).scalars().all()
    return rows
