import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import case, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Category, Position, Transaction, User, Wallet
from ..schemas.investment import (
    AddBuyRequest,
    BuyRequest,
    InvestEventView,
    PositionUpdate,
    PositionView,
    SellRequest,
)
from ..schemas.transaction import TransactionRead

router = APIRouter(prefix="/investments", tags=["investments"])


async def _check_wallet(session: AsyncSession, user: User, wallet_id: int, currency: str) -> Wallet:
    w = await session.get(Wallet, wallet_id)
    if not w or w.user_id != user.id:
        raise HTTPException(400, "invalid wallet_id")
    if w.currency_code != currency:
        raise HTTPException(400, "wallet currency mismatch")
    return w


async def _pnl_cat(session: AsyncSession, user: User, name: str) -> int | None:
    return (
        await session.execute(select(Category.id).where(Category.user_id == user.id, Category.name == name))
    ).scalar_one_or_none()


async def _position_remaining(session: AsyncSession, position_id: int) -> int:
    signed = case(
        (Transaction.kind == "invest_buy", Transaction.amount),
        (Transaction.kind == "invest_sell", -Transaction.amount),
        else_=0,
    )
    return int((await session.execute(
        select(func.sum(signed)).where(Transaction.position_id == position_id)
    )).scalar() or 0)


async def _build_position_view(session: AsyncSession, user_id: int, pos: Position) -> PositionView:
    """按 list_positions 同口径重算单个持仓的成本/盈亏视图."""
    buy = func.sum(case((Transaction.kind == "invest_buy", Transaction.amount), else_=0))
    sell = func.sum(case((Transaction.kind == "invest_sell", Transaction.amount), else_=0))
    pnl = func.sum(case(
        (Transaction.kind == "income", Transaction.amount),
        (Transaction.kind == "expense", -Transaction.amount),
        else_=0,
    ))
    row = (await session.execute(
        select(buy, sell, pnl).where(
            Transaction.user_id == user_id, Transaction.position_id == pos.id
        )
    )).one()
    b, s, p = int(row[0] or 0), int(row[1] or 0), int(row[2] or 0)
    return PositionView(
        id=pos.id, name=pos.name, currency_code=pos.currency_code,
        opened_on=pos.opened_on, status=pos.status,
        cost_total=b, cost_remaining=b - s, realized_pnl=p, note=pos.note,
    )


@router.get("/positions", response_model=list[PositionView])
async def list_positions(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    positions = (await session.execute(select(Position).where(Position.user_id == user.id))).scalars().all()
    buy = func.sum(case((Transaction.kind == "invest_buy", Transaction.amount), else_=0))
    sell = func.sum(case((Transaction.kind == "invest_sell", Transaction.amount), else_=0))
    # position 上挂的 income/expense 只可能是卖出结算的盈亏
    pnl = func.sum(case(
        (Transaction.kind == "income", Transaction.amount),
        (Transaction.kind == "expense", -Transaction.amount),
        else_=0,
    ))
    rows = (await session.execute(
        select(Transaction.position_id, buy, sell, pnl)
        .where(Transaction.user_id == user.id, Transaction.position_id.is_not(None))
        .group_by(Transaction.position_id)
    )).all()
    agg = {pid: (int(b or 0), int(s or 0), int(p or 0)) for pid, b, s, p in rows}
    out: list[PositionView] = []
    for pos in positions:
        b, s, p = agg.get(pos.id, (0, 0, 0))
        out.append(PositionView(
            id=pos.id, name=pos.name, currency_code=pos.currency_code,
            opened_on=pos.opened_on, status=pos.status,
            cost_total=b, cost_remaining=b - s, realized_pnl=p, note=pos.note,
        ))
    out.sort(key=lambda x: (x.status != "open", x.currency_code, -x.cost_remaining, x.name))
    return out


@router.post("/buy", response_model=PositionView, status_code=status.HTTP_201_CREATED)
async def buy(
    payload: BuyRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    await _check_wallet(session, user, payload.wallet_id, payload.currency_code)
    pos = Position(
        user_id=user.id, name=payload.name, currency_code=payload.currency_code,
        opened_on=payload.occurred_on, status="open", note=payload.note,
    )
    session.add(pos)
    await session.flush()
    session.add(Transaction(
        user_id=user.id, wallet_id=payload.wallet_id, position_id=pos.id,
        amount=payload.amount, currency_code=payload.currency_code, kind="invest_buy",
        occurred_on=payload.occurred_on, note=payload.note,
    ))
    if payload.opening:
        # 已持有资产: 配一笔对账调整收入抵掉买入对物理的影响 -> 钱包物理不变, 净值+本金, 投资中+本金
        adj = await _pnl_cat(session, user, "对账调整")
        session.add(Transaction(
            user_id=user.id, wallet_id=payload.wallet_id, category_id=adj,
            amount=payload.amount, currency_code=payload.currency_code, kind="income",
            occurred_on=payload.occurred_on, note="期初持仓·额外资产(余额不变)",
            opening_for_position_id=pos.id,
        ))
    await session.commit()
    return PositionView(
        id=pos.id, name=pos.name, currency_code=pos.currency_code,
        opened_on=pos.opened_on, status="open",
        cost_total=payload.amount, cost_remaining=payload.amount, realized_pnl=0, note=pos.note,
    )


@router.post("/positions/{position_id}/buy", response_model=PositionView, status_code=status.HTTP_201_CREATED)
async def add_buy(
    position_id: int,
    payload: AddBuyRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """追加买入到已有持仓: 再加一笔 invest_buy (币种取持仓的). 用于"同一类型持续加仓"."""
    pos = await session.get(Position, position_id)
    if not pos or pos.user_id != user.id:
        raise HTTPException(404, "position not found")
    if pos.status != "open":
        raise HTTPException(400, "持仓已清仓, 不能追加")
    await _check_wallet(session, user, payload.wallet_id, pos.currency_code)
    session.add(Transaction(
        user_id=user.id, wallet_id=payload.wallet_id, position_id=pos.id,
        amount=payload.amount, currency_code=pos.currency_code, kind="invest_buy",
        occurred_on=payload.occurred_on, note=payload.note,
    ))
    if payload.opening:
        # 已持有资产: 配一笔对账调整收入抵掉买入对物理的影响 (与 buy() 一致)
        adj = await _pnl_cat(session, user, "对账调整")
        session.add(Transaction(
            user_id=user.id, wallet_id=payload.wallet_id, category_id=adj,
            amount=payload.amount, currency_code=pos.currency_code, kind="income",
            occurred_on=payload.occurred_on, note="期初持仓·额外资产(余额不变)",
            opening_for_position_id=pos.id,
        ))
    await session.commit()
    return await _build_position_view(session, user.id, pos)


@router.post("/sell", response_model=list[TransactionRead], status_code=status.HTTP_201_CREATED)
async def sell(
    payload: SellRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    pos = await session.get(Position, payload.position_id)
    if not pos or pos.user_id != user.id:
        raise HTTPException(400, "invalid position_id")
    await _check_wallet(session, user, payload.wallet_id, pos.currency_code)
    remaining = await _position_remaining(session, pos.id)
    if payload.cost_amount > remaining:
        raise HTTPException(400, f"cost_amount {payload.cost_amount} > remaining {remaining}")

    group = str(uuid.uuid4())
    created: list[Transaction] = []
    sell_tx = Transaction(
        user_id=user.id, wallet_id=payload.wallet_id, position_id=pos.id,
        amount=payload.cost_amount, currency_code=pos.currency_code, kind="invest_sell",
        occurred_on=payload.occurred_on, note=payload.note, split_group_id=group,
    )
    session.add(sell_tx)
    created.append(sell_tx)

    pnl = payload.proceeds - payload.cost_amount
    if pnl != 0:
        if pnl > 0:
            cat = await _pnl_cat(session, user, "投资收益")
            kind, amt = "income", pnl
        else:
            cat = await _pnl_cat(session, user, "投资亏损")
            kind, amt = "expense", -pnl
        pnl_tx = Transaction(
            user_id=user.id, wallet_id=payload.wallet_id, position_id=pos.id, category_id=cat,
            amount=amt, currency_code=pos.currency_code, kind=kind,
            occurred_on=payload.occurred_on, note=payload.note or f"投资结算 · {pos.name}",
            split_group_id=group,
        )
        session.add(pnl_tx)
        created.append(pnl_tx)

    if remaining - payload.cost_amount == 0:
        pos.status = "closed"

    await session.commit()
    for t in created:
        await session.refresh(t)
    return created


@router.patch("/positions/{position_id}", response_model=PositionView)
async def update_position(
    position_id: int,
    payload: PositionUpdate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """改持仓元信息 (名称/开仓日期/备注). 不动金额与账务.
    改了日期就把对应的 invest_buy 那笔也挪过去, 让账单/历史与卡片日期一致."""
    pos = await session.get(Position, position_id)
    if not pos or pos.user_id != user.id:
        raise HTTPException(404, "position not found")
    updates = payload.model_dump(exclude_unset=True)
    if updates.get("name") is not None:
        pos.name = updates["name"].strip()
    if updates.get("note") is not None:
        pos.note = updates["note"]
    if updates.get("opened_on") is not None:
        pos.opened_on = updates["opened_on"]
        # 仅当只有一笔买入时把它的日期跟着挪; 多笔追加则各买入各自保留日期
        buy_count = (await session.execute(
            select(func.count()).select_from(Transaction).where(
                Transaction.user_id == user.id,
                Transaction.position_id == pos.id,
                Transaction.kind == "invest_buy",
            )
        )).scalar() or 0
        if buy_count == 1:
            await session.execute(
                update(Transaction)
                .where(
                    Transaction.user_id == user.id,
                    Transaction.position_id == pos.id,
                    Transaction.kind == "invest_buy",
                )
                .values(occurred_on=updates["opened_on"])
            )
            # 同步挪配套的期初对账收入日期, 否则指纹(钱包+金额+币种+日期)错位,
            # 日后从账单删该买入时漏删这笔收入 -> 幽灵收入虚高净值(审计 #28).
            await session.execute(
                update(Transaction)
                .where(
                    Transaction.user_id == user.id,
                    Transaction.opening_for_position_id == pos.id,
                )
                .values(occurred_on=updates["opened_on"])
            )
    await session.commit()
    return await _build_position_view(session, user.id, pos)


@router.delete("/positions/{position_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_position(
    position_id: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """删除持仓 + 它的全部交易 (买入/卖出/盈亏/期初注入). 撤销对余额的全部影响."""
    pos = await session.get(Position, position_id)
    if not pos or pos.user_id != user.id:
        raise HTTPException(404, "position not found")
    await session.execute(delete(Transaction).where(
        Transaction.user_id == user.id,
        or_(Transaction.position_id == position_id, Transaction.opening_for_position_id == position_id),
    ))
    await session.delete(pos)
    await session.commit()


@router.get("/transactions", response_model=list[InvestEventView])
async def list_events(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    names = {p.id: p.name for p in (await session.execute(select(Position).where(Position.user_id == user.id))).scalars().all()}
    txs = (await session.execute(
        select(Transaction).where(
            Transaction.user_id == user.id,
            Transaction.position_id.is_not(None),
            Transaction.kind.in_(("invest_buy", "invest_sell", "income", "expense")),
        ).order_by(Transaction.occurred_on.desc(), Transaction.id.desc())
    )).scalars().all()

    # 卖出: invest_sell + 盈亏(income/expense) 同 split_group 合成一条
    pnl_by_group: dict[str, int] = {}
    for t in txs:
        if t.kind in ("income", "expense") and t.split_group_id:
            pnl_by_group[t.split_group_id] = pnl_by_group.get(t.split_group_id, 0) + (t.amount if t.kind == "income" else -t.amount)

    out: list[InvestEventView] = []
    for t in txs:
        if t.kind == "invest_buy":
            out.append(InvestEventView(
                key=f"t{t.id}", position_id=t.position_id, position_name=names.get(t.position_id, "?"),
                currency_code=t.currency_code, occurred_on=t.occurred_on, type="buy",
                cost=t.amount, note=t.note or "",
            ))
        elif t.kind == "invest_sell":
            pnl = pnl_by_group.get(t.split_group_id or "", 0)
            out.append(InvestEventView(
                key=f"t{t.id}", position_id=t.position_id, position_name=names.get(t.position_id, "?"),
                currency_code=t.currency_code, occurred_on=t.occurred_on, type="sell",
                cost=t.amount, proceeds=t.amount + pnl, pnl=pnl, note=t.note or "",
            ))
    return out
