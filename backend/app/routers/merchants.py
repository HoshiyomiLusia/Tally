from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Merchant, User
from ..schemas.merchant import MerchantCreate, MerchantRead, MerchantUpdate

router = APIRouter(prefix="/merchants", tags=["merchants"])


@router.get("", response_model=list[MerchantRead])
async def list_merchants(
    q: str | None = None,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(Merchant).where(Merchant.user_id == user.id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Merchant.name.ilike(like), Merchant.aliases.ilike(like)))
    stmt = stmt.order_by(Merchant.usage_count.desc(), Merchant.name)
    return (await session.execute(stmt)).scalars().all()


@router.post("", response_model=MerchantRead, status_code=status.HTTP_201_CREATED)
async def create_merchant(
    payload: MerchantCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    m = Merchant(user_id=user.id, **payload.model_dump())
    session.add(m)
    await session.commit()
    await session.refresh(m)
    return m


@router.patch("/{mid}", response_model=MerchantRead)
async def update_merchant(
    mid: int,
    payload: MerchantUpdate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    m = await session.get(Merchant, mid)
    if not m or m.user_id != user.id:
        raise HTTPException(404)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(m, k, v)
    await session.commit()
    await session.refresh(m)
    return m


@router.delete("/{mid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_merchant(
    mid: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    m = await session.get(Merchant, mid)
    if not m or m.user_id != user.id:
        raise HTTPException(404)
    await session.delete(m)
    await session.commit()
