from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import create_access_token, current_user, hash_password, verify_password
from ..core.config import settings
from ..core.db import get_session
from ..models import Currency
from ..models.user import User
from ..schemas.user import RegisterRequest, TokenResponse, UserResponse, UserUpdateRequest
from ..services.seed import seed_user_defaults

router = APIRouter(prefix="/auth", tags=["auth"])
users_router = APIRouter(prefix="/users", tags=["users"])


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, session: AsyncSession = Depends(get_session)):
    if not settings.allow_registration:
        raise HTTPException(403, "registration is disabled")
    existing = (await session.execute(select(User).where(User.username == payload.username))).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "username already taken")
    user = User(username=payload.username, hashed_password=hash_password(payload.password))
    session.add(user)
    await session.flush()  # 拿到 user.id 但先不提交, 让 seed 的提交把 user + 默认数据一起落库(原子, 审计 #93)
    await seed_user_defaults(session, user.id)  # 内部 commit; 若 seed 中途失败, 未提交的 user 一并回滚, 不留坏账号
    await session.refresh(user)
    return user


@router.post("/login", response_model=TokenResponse)
async def login(form: OAuth2PasswordRequestForm = Depends(), session: AsyncSession = Depends(get_session)):
    user = (await session.execute(select(User).where(User.username == form.username))).scalar_one_or_none()
    if not user or not user.is_active or not verify_password(form.password, user.hashed_password):
        raise HTTPException(401, "invalid credentials")
    return TokenResponse(access_token=create_access_token(user.id))


@users_router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(current_user)):
    return user


@users_router.patch("/me", response_model=UserResponse)
async def update_me(
    payload: UserUpdateRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    if payload.primary_currency_code is not None:
        # 空字符串 = 清除偏好
        if payload.primary_currency_code == "":
            user.primary_currency_code = None
        else:
            exists = (
                await session.execute(
                    select(Currency.code).where(Currency.code == payload.primary_currency_code)
                )
            ).scalar_one_or_none()
            if not exists:
                raise HTTPException(400, f"unknown currency: {payload.primary_currency_code}")
            user.primary_currency_code = payload.primary_currency_code
    await session.commit()
    await session.refresh(user)
    return user
