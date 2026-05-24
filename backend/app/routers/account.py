from fastapi import APIRouter, Depends, status
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Category, Merchant, Transaction, User, Wallet
from ..services.seed import seed_user_defaults

router = APIRouter(prefix="/account", tags=["account"])


@router.post("/reset", status_code=status.HTTP_204_NO_CONTENT)
async def reset_my_data(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    await session.execute(delete(Transaction).where(Transaction.user_id == user.id))
    await session.execute(delete(Wallet).where(Wallet.user_id == user.id))
    await session.execute(delete(Merchant).where(Merchant.user_id == user.id))
    await session.execute(delete(Category).where(Category.user_id == user.id))
    await session.commit()
    await seed_user_defaults(session, user.id)
