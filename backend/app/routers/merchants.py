from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Category, Merchant, Transaction, User
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


class CatUsage(BaseModel):
    merchant_id: int
    count: int


@router.get("/usage-by-category", response_model=list[CatUsage])
async def usage_by_category(
    category_id: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """每个商家在指定分类下用过几次. 父类时把子类的也算上.
    前端用来给商家建议做排序: 你在出租车下用过 5 次 Uber, Uber 就该置顶,
    哪怕 Uber 的 default_category 是别的."""
    child_ids = (
        await session.execute(
            select(Category.id).where(Category.user_id == user.id, Category.parent_id == category_id)
        )
    ).scalars().all()
    cat_ids = [category_id, *child_ids]
    rows = (
        await session.execute(
            select(Transaction.merchant_id, func.count(Transaction.id))
            .where(
                Transaction.user_id == user.id,
                Transaction.merchant_id.is_not(None),
                Transaction.category_id.in_(cat_ids),
            )
            .group_by(Transaction.merchant_id)
        )
    ).all()
    return [CatUsage(merchant_id=int(mid), count=int(cnt)) for mid, cnt in rows]


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
