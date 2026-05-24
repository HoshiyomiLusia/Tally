from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Category, User
from ..schemas.category import CategoryCreate, CategoryRead, CategoryUpdate

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[CategoryRead])
async def list_categories(
    kind: str | None = None,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(Category).where(Category.user_id == user.id).order_by(Category.kind, Category.sort_order, Category.id)
    if kind:
        stmt = stmt.where(Category.kind == kind)
    return (await session.execute(stmt)).scalars().all()


@router.post("", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
async def create_category(
    payload: CategoryCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    if payload.parent_id is not None:
        parent = await session.get(Category, payload.parent_id)
        if not parent or parent.user_id != user.id:
            raise HTTPException(400, "invalid parent_id")
    c = Category(user_id=user.id, **payload.model_dump())
    session.add(c)
    await session.commit()
    await session.refresh(c)
    return c


@router.patch("/{cat_id}", response_model=CategoryRead)
async def update_category(
    cat_id: int,
    payload: CategoryUpdate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    c = await session.get(Category, cat_id)
    if not c or c.user_id != user.id:
        raise HTTPException(404)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    await session.commit()
    await session.refresh(c)
    return c


@router.delete("/{cat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(
    cat_id: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    c = await session.get(Category, cat_id)
    if not c or c.user_id != user.id:
        raise HTTPException(404)
    await session.delete(c)
    await session.commit()
