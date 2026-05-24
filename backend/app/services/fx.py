import asyncio
import logging
from datetime import date

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.db import SessionLocal
from ..models import Currency, ExchangeRate

logger = logging.getLogger("tally.fx")

FRANKFURTER_BASE = "https://api.frankfurter.app"
SUPPORTED_BASES = ("JPY", "CNY", "USD", "EUR", "GBP", "HKD", "KRW", "SGD")


async def _fetch_for_base(client: httpx.AsyncClient, base: str) -> dict[str, float]:
    r = await client.get(f"{FRANKFURTER_BASE}/latest", params={"from": base})
    r.raise_for_status()
    return r.json().get("rates", {})


async def refresh_rates(session: AsyncSession) -> int:
    today = date.today()
    valid_codes = {c[0] for c in (await session.execute(select(Currency.code))).all()}

    existing_manual_pairs = {
        (b, q) for b, q in (
            await session.execute(
                select(ExchangeRate.base, ExchangeRate.quote).where(
                    ExchangeRate.on_date == today,
                    ExchangeRate.source == "manual",
                )
            )
        ).all()
    }

    written = 0
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        for base in SUPPORTED_BASES:
            if base not in valid_codes:
                continue
            try:
                rates = await _fetch_for_base(client, base)
            except Exception as e:
                logger.warning("frankfurter fetch failed for %s: %s", base, e)
                continue
            for quote, rate in rates.items():
                if quote not in valid_codes:
                    continue
                if (base, quote) in existing_manual_pairs:
                    continue
                row = (
                    await session.execute(
                        select(ExchangeRate).where(
                            ExchangeRate.on_date == today,
                            ExchangeRate.base == base,
                            ExchangeRate.quote == quote,
                        )
                    )
                ).scalar_one_or_none()
                if row:
                    if row.source == "auto":
                        row.rate = rate
                        written += 1
                else:
                    session.add(ExchangeRate(on_date=today, base=base, quote=quote, rate=rate, source="auto"))
                    written += 1
    await session.commit()
    return written


async def schedule_refresh(interval_seconds: int = 6 * 3600) -> None:
    while True:
        try:
            async with SessionLocal() as session:
                count = await refresh_rates(session)
                logger.info("fx refresh: %d rates updated", count)
        except Exception as e:
            logger.warning("fx scheduled refresh failed: %s", e)
        await asyncio.sleep(interval_seconds)
