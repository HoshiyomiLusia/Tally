from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete as sql_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Category, Currency, ExchangeRate, Merchant, Transaction, User, Wallet
from ..schemas.transaction import TransactionCreate, TransactionFilter, TransactionRead, TransactionUpdate

router = APIRouter(prefix="/transactions", tags=["transactions"])


class TransferCreate(BaseModel):
    from_wallet_id: int
    to_wallet_id: int
    from_amount: int
    to_amount: int
    occurred_on: date
    note: str = ""


class FxPreview(BaseModel):
    from_currency: str
    to_currency: str
    from_amount: int
    to_amount: int
    rate: float | None
    on_date: date | None


class FrequentItem(BaseModel):
    wallet_id: int
    wallet_name: str
    category_id: int | None
    category_name: str
    category_emoji: str
    merchant_id: int | None
    merchant_name: str
    amount: int
    currency_code: str
    count: int
    last_on: date


async def _check_wallet(session: AsyncSession, user: User, wallet_id: int) -> Wallet:
    w = await session.get(Wallet, wallet_id)
    if not w or w.user_id != user.id:
        raise HTTPException(400, "invalid wallet_id")
    return w


@router.get("", response_model=list[TransactionRead])
async def list_transactions(
    f: TransactionFilter = Depends(),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(Transaction).where(Transaction.user_id == user.id)
    if f.start:
        stmt = stmt.where(Transaction.occurred_on >= f.start)
    if f.end:
        stmt = stmt.where(Transaction.occurred_on <= f.end)
    if f.wallet_id:
        stmt = stmt.where(Transaction.wallet_id == f.wallet_id)
    if f.category_id:
        child_ids = (
            await session.execute(
                select(Category.id).where(Category.user_id == user.id, Category.parent_id == f.category_id)
            )
        ).scalars().all()
        cat_ids = [f.category_id, *child_ids]
        stmt = stmt.where(Transaction.category_id.in_(cat_ids))
    if f.currency_code:
        stmt = stmt.where(Transaction.currency_code == f.currency_code)
    if f.kind:
        stmt = stmt.where(Transaction.kind == f.kind)
    if f.contact_id is not None:
        stmt = stmt.where(Transaction.contact_id == f.contact_id)
    if f.is_recurring is not None:
        stmt = stmt.where(Transaction.is_recurring == f.is_recurring)
    if f.q:
        stmt = stmt.where(Transaction.note.ilike(f"%{f.q}%"))
    stmt = stmt.order_by(Transaction.occurred_on.desc(), Transaction.id.desc()).limit(f.limit).offset(f.offset)
    return (await session.execute(stmt)).scalars().all()


@router.post("", response_model=TransactionRead, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    payload: TransactionCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    wallet = await _check_wallet(session, user, payload.wallet_id)
    if payload.currency_code != wallet.currency_code:
        raise HTTPException(400, "currency must match wallet")
    if payload.amount <= 0:
        raise HTTPException(400, "amount must be positive")

    data = payload.model_dump()
    t = Transaction(user_id=user.id, **data)
    session.add(t)
    if payload.merchant_id:
        m = await session.get(Merchant, payload.merchant_id)
        if m and m.user_id == user.id:
            m.usage_count += 1
    await session.commit()
    await session.refresh(t)
    return t


@router.get("/frequent", response_model=list[FrequentItem])
async def frequent(
    min_count: int = 3,
    limit: int = 12,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    # 按 (钱包, 分类, 商家, 币种) 分组——故意不把 amount 算进 key, 因为
    # 同一家商店每次金额几乎都不一样, 一旦带上 amount 几乎永远凑不到 min_count.
    # 商家可以是 NULL (像自动贩卖机这种没商家的会聚成一组), 但至少要有分类——
    # 否则只是"花了 150 円"没意义.
    rows = (
        await session.execute(
            select(
                Transaction.wallet_id,
                Transaction.category_id,
                Transaction.merchant_id,
                Transaction.currency_code,
                func.count(Transaction.id),
                func.max(Transaction.occurred_on),
            )
            .where(
                Transaction.user_id == user.id,
                Transaction.kind == "expense",
                Transaction.category_id.is_not(None),
            )
            .group_by(
                Transaction.wallet_id,
                Transaction.category_id,
                Transaction.merchant_id,
                Transaction.currency_code,
            )
            .having(func.count(Transaction.id) >= min_count)
            .order_by(func.count(Transaction.id).desc(), func.max(Transaction.occurred_on).desc())
            .limit(limit)
        )
    ).all()
    if not rows:
        return []

    wallets = {w.id: w for w in (await session.execute(select(Wallet).where(Wallet.user_id == user.id))).scalars().all()}
    cats = {c.id: c for c in (await session.execute(select(Category).where(Category.user_id == user.id))).scalars().all()}
    merchants = {m.id: m for m in (await session.execute(select(Merchant).where(Merchant.user_id == user.id))).scalars().all()}

    out: list[FrequentItem] = []
    for wid, cid, mid, code, cnt, last_on in rows:
        w = wallets.get(wid)
        c = cats.get(cid) if cid else None
        m = merchants.get(mid) if mid else None
        if not w:
            continue
        recent_amt = (
            await session.execute(
                select(Transaction.amount)
                .where(
                    Transaction.user_id == user.id,
                    Transaction.wallet_id == wid,
                    Transaction.category_id == cid,
                    Transaction.merchant_id == mid,
                    Transaction.currency_code == code,
                    Transaction.kind == "expense",
                )
                .order_by(Transaction.occurred_on.desc(), Transaction.id.desc())
                .limit(1)
            )
        ).scalar() or 0
        out.append(FrequentItem(
            wallet_id=wid, wallet_name=w.name,
            category_id=cid, category_name=c.name if c else "未分类", category_emoji=c.emoji if c else "",
            merchant_id=mid, merchant_name=m.name if m else "",
            amount=int(recent_amt), currency_code=code,
            count=int(cnt), last_on=last_on,
        ))
    return out


@router.get("/fx-preview", response_model=FxPreview)
async def fx_preview(
    from_currency: str,
    to_currency: str,
    from_amount: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    if from_currency == to_currency:
        return FxPreview(
            from_currency=from_currency, to_currency=to_currency,
            from_amount=from_amount, to_amount=from_amount, rate=1.0, on_date=None,
        )
    digits = {c: d for c, d in (await session.execute(select(Currency.code, Currency.decimal_digits))).all()}
    fd = digits.get(from_currency, 2)
    td = digits.get(to_currency, 2)

    r = (
        await session.execute(
            select(ExchangeRate.rate, ExchangeRate.on_date)
            .where(ExchangeRate.base == from_currency, ExchangeRate.quote == to_currency)
            .order_by(ExchangeRate.on_date.desc())
            .limit(1)
        )
    ).first()
    if r is None:
        # try reverse pair
        rev = (
            await session.execute(
                select(ExchangeRate.rate, ExchangeRate.on_date)
                .where(ExchangeRate.base == to_currency, ExchangeRate.quote == from_currency)
                .order_by(ExchangeRate.on_date.desc())
                .limit(1)
            )
        ).first()
        if rev is None:
            return FxPreview(
                from_currency=from_currency, to_currency=to_currency,
                from_amount=from_amount, to_amount=0, rate=None, on_date=None,
            )
        rate = 1.0 / rev[0] if rev[0] else 0.0
        on_d = rev[1]
    else:
        rate = float(r[0])
        on_d = r[1]

    to_amount = int(round(from_amount * rate * (10 ** (td - fd))))
    return FxPreview(
        from_currency=from_currency, to_currency=to_currency,
        from_amount=from_amount, to_amount=to_amount, rate=rate, on_date=on_d,
    )


@router.post("/transfer", response_model=list[TransactionRead], status_code=status.HTTP_201_CREATED)
async def create_transfer(
    payload: TransferCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    if payload.from_wallet_id == payload.to_wallet_id:
        raise HTTPException(400, "from and to wallet must differ")
    if payload.from_amount <= 0 or payload.to_amount <= 0:
        raise HTTPException(400, "amounts must be positive")
    src = await _check_wallet(session, user, payload.from_wallet_id)
    dst = await _check_wallet(session, user, payload.to_wallet_id)

    out_tx = Transaction(
        user_id=user.id,
        wallet_id=src.id,
        amount=payload.from_amount,
        currency_code=src.currency_code,
        kind="transfer_out",
        occurred_on=payload.occurred_on,
        note=payload.note,
    )
    in_tx = Transaction(
        user_id=user.id,
        wallet_id=dst.id,
        amount=payload.to_amount,
        currency_code=dst.currency_code,
        kind="transfer_in",
        occurred_on=payload.occurred_on,
        note=payload.note,
    )
    session.add(out_tx)
    session.add(in_tx)
    await session.flush()
    out_tx.transfer_pair_id = in_tx.id
    in_tx.transfer_pair_id = out_tx.id
    await session.commit()
    await session.refresh(out_tx)
    await session.refresh(in_tx)
    return [out_tx, in_tx]


@router.get("/{tid}", response_model=TransactionRead)
async def get_transaction(
    tid: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    t = await session.get(Transaction, tid)
    if not t or t.user_id != user.id:
        raise HTTPException(404)
    return t


@router.patch("/{tid}", response_model=TransactionRead)
async def update_transaction(
    tid: int,
    payload: TransactionUpdate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    t = await session.get(Transaction, tid)
    if not t or t.user_id != user.id:
        raise HTTPException(404)
    updates = payload.model_dump(exclude_unset=True)
    if "wallet_id" in updates:
        await _check_wallet(session, user, updates["wallet_id"])
    if "amount" in updates and updates["amount"] is not None and updates["amount"] <= 0:
        raise HTTPException(400, "amount must be positive")
    for k, v in updates.items():
        setattr(t, k, v)
    await session.commit()
    await session.refresh(t)
    return t


@router.delete("/{tid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(
    tid: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    t = await session.get(Transaction, tid)
    if not t or t.user_id != user.id:
        raise HTTPException(404)
    if t.split_group_id:
        await session.execute(
            sql_delete(Transaction).where(
                Transaction.user_id == user.id,
                Transaction.split_group_id == t.split_group_id,
            )
        )
    elif t.transfer_pair_id:
        await session.execute(
            sql_delete(Transaction).where(
                Transaction.user_id == user.id,
                Transaction.id.in_([t.id, t.transfer_pair_id]),
            )
        )
    else:
        await session.delete(t)
    await session.commit()
