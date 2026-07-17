from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import case, delete as sql_delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Category, Currency, ExchangeRate, Merchant, Position, Transaction, User, Wallet
from ..schemas.transaction import TransactionCreate, TransactionFilter, TransactionRead, TransactionUpdate
from .recurring import resolve_recurrence_group

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


async def _apply_filters(stmt, f: TransactionFilter, user: User, session: AsyncSession):
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
        like = f"%{f.q}%"
        # 关键词同时匹配 备注 OR 商家(名称 / 别名)
        merchant_ids = (
            await session.execute(
                select(Merchant.id).where(
                    Merchant.user_id == user.id,
                    or_(Merchant.name.ilike(like), Merchant.aliases.ilike(like)),
                )
            )
        ).scalars().all()
        cond = Transaction.note.ilike(like)
        if merchant_ids:
            cond = or_(cond, Transaction.merchant_id.in_(merchant_ids))
        stmt = stmt.where(cond)
    return stmt


@router.get("", response_model=list[TransactionRead])
async def list_transactions(
    f: TransactionFilter = Depends(),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(Transaction).where(Transaction.user_id == user.id)
    stmt = await _apply_filters(stmt, f, user, session)
    stmt = stmt.order_by(Transaction.occurred_on.desc(), Transaction.id.desc()).limit(f.limit).offset(f.offset)
    return (await session.execute(stmt)).scalars().all()


class CountResponse(BaseModel):
    total: int


@router.get("/count", response_model=CountResponse)
async def count_transactions(
    f: TransactionFilter = Depends(),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(func.count(Transaction.id)).where(Transaction.user_id == user.id)
    stmt = await _apply_filters(stmt, f, user, session)
    total = (await session.execute(stmt)).scalar() or 0
    return CountResponse(total=int(total))


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
    # 通用记账只接受普通收支; 转账/借贷/投资走各自专门流程 (否则会造出没有配对/归属的悬挂行)
    if payload.kind not in ("expense", "income"):
        raise HTTPException(400, "该类型请用对应流程 (转账 / 借贷 / 投资)")

    data = payload.model_dump()
    source_id = data.pop("recurrence_source_id", None)
    group = await resolve_recurrence_group(session, user, source_id)
    t = Transaction(user_id=user.id, **data)
    if group:
        t.recurrence_group_id = group
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
    # 严格分组: (钱包, 分类, 商家, 金额, 币种) 完全一致才算同一笔可"原样复刻"的账单.
    # 快速添加点一下就直接落库, 金额必须可信. 商家可以是 NULL (像自动贩卖机这种),
    # 但分类要有.
    rows = (
        await session.execute(
            select(
                Transaction.wallet_id,
                Transaction.category_id,
                Transaction.merchant_id,
                Transaction.amount,
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
                Transaction.amount,
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
    for wid, cid, mid, amount, code, cnt, last_on in rows:
        w = wallets.get(wid)
        c = cats.get(cid) if cid else None
        m = merchants.get(mid) if mid else None
        if not w:
            continue
        out.append(FrequentItem(
            wallet_id=wid, wallet_name=w.name,
            category_id=cid, category_name=c.name if c else "未分类", category_emoji=c.emoji if c else "",
            merchant_id=mid, merchant_name=m.name if m else "",
            amount=int(amount), currency_code=code,
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
    # 转账/借贷/投资各腿有配对不变量: 通用接口不允许改金额/钱包(会让配对腿失配或持仓归属错乱).
    # 前端已对这些类型隐藏铅笔, 这里再挡一道防绕过 UI 直接 PATCH.
    if t.kind not in ("expense", "income") and any(k in updates for k in ("amount", "wallet_id")):
        raise HTTPException(400, "转账 / 借贷 / 投资交易请在对应功能里修改, 不能在此改金额或钱包")
    if "wallet_id" in updates:
        nw = await _check_wallet(session, user, updates["wallet_id"])
        # 防跨币种脱钩: TransactionUpdate 无 currency_code 字段, 换到异币种钱包会让交易币种与钱包币种不一致
        # (余额按钱包币种、统计按交易币种, 同一笔进两种货币, 金额还按 10^Δdigits 漂移). 直接拒绝换到异币种钱包.
        if nw.currency_code != t.currency_code:
            raise HTTPException(400, "目标钱包币种与交易币种不一致, 不能在此换到异币种钱包(口径会错乱); 请删除后在新钱包重记")
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
    pos_ids: set[int] = set()  # 删的若是投资交易, 事后要重算这些持仓的清仓状态
    if t.split_group_id:
        rows = (await session.execute(
            select(Transaction).where(
                Transaction.user_id == user.id,
                Transaction.split_group_id == t.split_group_id,
            )
        )).scalars().all()
        pos_ids = {r.position_id for r in rows if r.position_id is not None}
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
        if t.position_id is not None:
            pos_ids.add(t.position_id)
        # 删"期初买入(opening)"那笔时, 把与它 1:1 配套的对账注入收入一并删掉,
        # 否则那笔收入变成孤儿(挂 opening_for_position_id 但对应买入没了) -> 净值虚高.
        # 只删一条: 同一持仓可能有多笔同额同日同钱包的期初买入, 各配一笔收入, 不能一次全删。
        if t.kind == "invest_buy" and t.position_id is not None:
            opening = (await session.execute(
                select(Transaction).where(
                    Transaction.user_id == user.id,
                    Transaction.opening_for_position_id == t.position_id,
                    Transaction.wallet_id == t.wallet_id,
                    Transaction.amount == t.amount,
                    Transaction.currency_code == t.currency_code,
                    Transaction.occurred_on == t.occurred_on,
                ).limit(1)
            )).scalars().first()
            if opening is not None:
                await session.delete(opening)
        # 反向: 删"期初对账收入"那条腿时, 连带删它配套的期初买入,
        # 否则裸买入没了收入抵消 -> 净值/物理各静默少算一整笔本金(审计 #59).
        if t.kind == "income" and t.opening_for_position_id is not None:
            buy = (await session.execute(
                select(Transaction).where(
                    Transaction.user_id == user.id,
                    Transaction.position_id == t.opening_for_position_id,
                    Transaction.kind == "invest_buy",
                    Transaction.wallet_id == t.wallet_id,
                    Transaction.amount == t.amount,
                    Transaction.currency_code == t.currency_code,
                    Transaction.occurred_on == t.occurred_on,
                ).limit(1)
            )).scalars().first()
            if buy is not None:
                pos_ids.add(buy.position_id)
                await session.delete(buy)
        await session.delete(t)
    await session.flush()
    # 删掉"清仓那笔卖出"后持仓不能卡在"已清仓": 按剩余成本重算 status
    for pid in pos_ids:
        pos = await session.get(Position, pid)
        if pos and pos.user_id == user.id:
            signed = case(
                (Transaction.kind == "invest_buy", Transaction.amount),
                (Transaction.kind == "invest_sell", -Transaction.amount),
                else_=0,
            )
            remaining = int((await session.execute(
                select(func.sum(signed)).where(Transaction.position_id == pid)
            )).scalar() or 0)
            pos.status = "open" if remaining > 0 else "closed"
    await session.commit()
