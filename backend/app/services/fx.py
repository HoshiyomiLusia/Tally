import asyncio
import logging
from datetime import date

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.db import SessionLocal
from ..models import Currency, ExchangeRate, Wallet

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


async def base_converter(session: AsyncSession, base: str):
    """返回 (conv, missing): conv(amt, code) 把任意币种的最小单位金额折算到 base(含小数位差),
    missing 是换算不出来的币种集合。与 stats.cross_currency_total 同一套口径(正向优先, 反向取倒数)。"""
    digits = {c: d for c, d in (await session.execute(select(Currency.code, Currency.decimal_digits))).all()}
    base_d = digits.get(base, 2)
    rows = (
        await session.execute(
            select(ExchangeRate.base, ExchangeRate.quote, ExchangeRate.rate)
            .order_by(ExchangeRate.on_date.desc())
        )
    ).all()
    rates: dict[tuple[str, str], float] = {}
    for b, q, r in rows:                      # 显式录入的正向汇率优先
        if (b, q) not in rates:
            rates[(b, q)] = r
    for b, q, r in rows:                      # 只给缺失方向补倒数(审计 #41)
        if r and (q, b) not in rates:
            rates[(q, b)] = 1.0 / r
    missing: set[str] = set()

    def conv(amt: int, code: str) -> int:
        if code == base:
            return amt
        rate = rates.get((code, base)) or 0.0
        if rate == 0.0:
            if amt:
                missing.add(code)
            return 0
        return int(round(amt * rate * (10 ** (base_d - digits.get(code, 2)))))

    return conv, missing


async def resolve_base_currency(session: AsyncSession, user) -> str:
    """本位币: 用户设了就用; 没设(注册时不写, 库里确有 None 的账号)就取余额最大的那个钱包的币种, 再退回 JPY。
    没有这个兜底, 任何按本位币聚合的接口对未设主币种的账号会 500。"""
    if user.primary_currency_code:
        return user.primary_currency_code
    row = (
        await session.execute(
            select(Wallet.currency_code)
            .where(Wallet.user_id == user.id, Wallet.archived == False)  # noqa: E712
            .order_by(Wallet.initial_balance.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return row or "JPY"
