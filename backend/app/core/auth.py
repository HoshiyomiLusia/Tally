from datetime import datetime, timedelta, timezone
from typing import Annotated

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import get_session
from ..models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")
ALGO = "HS256"


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except ValueError:
        return False


def create_access_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(seconds=settings.jwt_lifetime_seconds)
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=ALGO)


async def current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    session: AsyncSession = Depends(get_session),
) -> User:
    err = HTTPException(status.HTTP_401_UNAUTHORIZED, "Unauthorized", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGO])
        user_id = int(payload.get("sub") or 0)
    except (jwt.PyJWTError, ValueError):
        raise err
    if not user_id:
        raise err
    user = await session.get(User, user_id)
    if not user or not user.is_active:
        raise err
    return user
