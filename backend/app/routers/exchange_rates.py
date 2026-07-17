from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import ExchangeRate, User
from ..schemas.exchange_rate import ExchangeRateCreate, ExchangeRateRead
from ..services.fx import refresh_rates

router = APIRouter(prefix="/exchange-rates", tags=["exchange_rates"])


@router.get("", response_model=list[ExchangeRateRead])
async def list_rates(
    _: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    # 审计#57: 只返回每个 (base,quote) 对的最新一条(按 on_date desc 取首条),
    # 避免全量历史(线上 3000+ 行)被前端拉取后 98% 丢弃。
    rows = (await session.execute(select(ExchangeRate).order_by(ExchangeRate.on_date.desc()))).scalars().all()
    latest: dict[tuple[str, str], ExchangeRate] = {}
    for r in rows:
        key = (r.base, r.quote)
        if key not in latest:
            latest[key] = r
    return list(latest.values())


@router.post("", response_model=ExchangeRateRead, status_code=status.HTTP_201_CREATED)
async def upsert_rate(
    payload: ExchangeRateCreate,
    _: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    existing = (
        await session.execute(
            select(ExchangeRate).where(
                ExchangeRate.on_date == payload.on_date,
                ExchangeRate.base == payload.base,
                ExchangeRate.quote == payload.quote,
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.rate = payload.rate
        existing.source = "manual"
        await session.commit()
        await session.refresh(existing)
        return existing
    r = ExchangeRate(source="manual", **payload.model_dump())
    session.add(r)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(409, "duplicate")
    await session.refresh(r)
    return r


@router.delete("/{rid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rate(
    rid: int,
    _: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    r = await session.get(ExchangeRate, rid)
    if not r:
        raise HTTPException(404)
    await session.delete(r)
    await session.commit()


@router.post("/refresh")
async def refresh(
    _: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    count = await refresh_rates(session)
    return {"updated": count}
