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
    WalletChangeRequest,
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
    # #48: order+limit+first, 万一有历史重名分类也不会 scalar_one_or_none 抛 500
    return (
        await session.execute(
            select(Category.id).where(Category.user_id == user.id, Category.name == name)
            .order_by(Category.id).limit(1)
        )
    ).scalars().first()


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
    # 审计 #122: 期初对(买入+配套对账收入)用 split_group_id 显式配对, 不再只靠(钱包/金额/日期)指纹
    # —— 指纹会与普通追加买入碰撞, 换钱包/删除时挪错/漏删配对腿
    opening_group = str(uuid.uuid4()) if payload.opening else None
    session.add(Transaction(
        user_id=user.id, wallet_id=payload.wallet_id, position_id=pos.id,
        amount=payload.amount, currency_code=payload.currency_code, kind="invest_buy",
        occurred_on=payload.occurred_on, note=payload.note, split_group_id=opening_group,
    ))
    if payload.opening:
        # 已持有资产: 配一笔对账调整收入抵掉买入对物理的影响 -> 钱包物理不变, 净值+本金, 投资中+本金
        adj = await _pnl_cat(session, user, "对账调整")
        session.add(Transaction(
            user_id=user.id, wallet_id=payload.wallet_id, category_id=adj,
            amount=payload.amount, currency_code=payload.currency_code, kind="income",
            occurred_on=payload.occurred_on, note="期初持仓·额外资产(余额不变)",
            opening_for_position_id=pos.id, split_group_id=opening_group,
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
    opening_group = str(uuid.uuid4()) if payload.opening else None  # 审计 #122: 同 buy()
    session.add(Transaction(
        user_id=user.id, wallet_id=payload.wallet_id, position_id=pos.id,
        amount=payload.amount, currency_code=pos.currency_code, kind="invest_buy",
        occurred_on=payload.occurred_on, note=payload.note, split_group_id=opening_group,
    ))
    if payload.opening:
        # 已持有资产: 配一笔对账调整收入抵掉买入对物理的影响 (与 buy() 一致)
        adj = await _pnl_cat(session, user, "对账调整")
        session.add(Transaction(
            user_id=user.id, wallet_id=payload.wallet_id, category_id=adj,
            amount=payload.amount, currency_code=pos.currency_code, kind="income",
            occurred_on=payload.occurred_on, note="期初持仓·额外资产(余额不变)",
            opening_for_position_id=pos.id, split_group_id=opening_group,
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


@router.patch("/transactions/{tid}/wallet", response_model=list[TransactionRead])
async def change_transaction_wallet(
    tid: int,
    payload: WalletChangeRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """订正投资交易记错的钱包: 把这笔所属的整个投资事件的全部腿一起挪到新钱包(同币种).

    为什么要整组挪: 卖出 = invest_sell + 盈亏(income/expense) 共用一个 split_group_id 且同钱包;
    期初买入 = invest_buy + 配套的期初对账收入。只挪其中一条会让配对腿留在旧钱包, 两边余额都错。
    通用的 PATCH /transactions 对分摊组/投资腿的钱包是锁死的(审计 #101), 这里是投资专用的订正口。
    """
    t = await session.get(Transaction, tid)
    if not t or t.user_id != user.id:
        raise HTTPException(404, "transaction not found")
    if t.position_id is None and t.opening_for_position_id is None:
        raise HTTPException(400, "这不是投资交易, 请在账单里修改")
    await _check_wallet(session, user, payload.wallet_id, t.currency_code)

    legs: dict[int, Transaction] = {t.id: t}
    if t.split_group_id:  # 卖出组: 卖出腿 + 盈亏腿
        for r in (await session.execute(select(Transaction).where(
            Transaction.user_id == user.id, Transaction.split_group_id == t.split_group_id,
        ))).scalars().all():
            legs[r.id] = r
    # 期初买入 <-> 配套期初收入 (靠 opening_for_position_id + 同钱包/同额/同日 配对, 与删除逻辑同口径)
    pos_id = t.position_id or t.opening_for_position_id
    # 审计 #122: 新数据的期初对已带 split_group_id(上面整组分支覆盖), 指纹仅兜底"迁移 0011 因歧义跳过"的存量;
    # 指纹可能与普通追加买入碰撞 —— 同指纹买入多于配对收入时无法确定谁是期初那笔, 拒绝而不是静默挪错。
    # 已显式打组(split_group_id)的期初对不参与指纹配对 —— 指纹只在"没组的存量"之间匹配,
    # 否则与已打组期初买入同指纹的普通买入会被误判为歧义而无法换钱包。
    if t.kind == "invest_buy" and not t.split_group_id:
        fp = (Transaction.user_id == user.id, Transaction.wallet_id == t.wallet_id,
              Transaction.amount == t.amount, Transaction.occurred_on == t.occurred_on,
              Transaction.split_group_id.is_(None))
        paired = (await session.execute(select(Transaction).where(
            Transaction.opening_for_position_id == pos_id, *fp,
        ))).scalars().all()
        if paired:
            twin_buys = (await session.execute(select(func.count()).select_from(Transaction).where(
                Transaction.position_id == pos_id, Transaction.kind == "invest_buy", *fp,
            ))).scalar() or 0
            if twin_buys > len(paired):
                raise HTTPException(400, "这笔买入与期初买入指纹相同(同钱包/同额/同日), 无法确定配对关系, 请在投资功能里分别处理")
            for r in paired:
                legs[r.id] = r
    elif t.opening_for_position_id is not None and not t.split_group_id:
        twins = (await session.execute(select(Transaction).where(
            Transaction.user_id == user.id,
            Transaction.position_id == pos_id,
            Transaction.kind == "invest_buy",
            Transaction.wallet_id == t.wallet_id,
            Transaction.amount == t.amount,
            Transaction.occurred_on == t.occurred_on,
            Transaction.split_group_id.is_(None),
        ))).scalars().all()
        if len(twins) > 1:
            raise HTTPException(400, "这笔期初收入的配套买入有歧义(同钱包/同额/同日存在多笔买入), 请在投资功能里处理")
        for r in twins:
            legs[r.id] = r

    for leg in legs.values():
        leg.wallet_id = payload.wallet_id
    await session.commit()
    for leg in legs.values():
        await session.refresh(leg)
    return list(legs.values())


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
