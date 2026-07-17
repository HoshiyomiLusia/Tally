import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Category, Contact, Transaction, User, Wallet
from ..schemas.loan import (
    LendRequest,
    LoanAccountView,
    RepaymentRequest,
    SplitCreateRequest,
    WriteOffRequest,
)
from ..schemas.transaction import TransactionRead
from .recurring import resolve_recurrence_group

router = APIRouter(prefix="/loans", tags=["loans"])


async def _check_wallet(session: AsyncSession, user: User, wallet_id: int, currency: str) -> Wallet:
    w = await session.get(Wallet, wallet_id)
    if not w or w.user_id != user.id:
        raise HTTPException(400, "invalid wallet_id")
    if w.currency_code != currency:
        raise HTTPException(400, "wallet currency mismatch")
    return w


async def _check_contact(session: AsyncSession, user: User, contact_id: int) -> Contact:
    c = await session.get(Contact, contact_id)
    if not c or c.user_id != user.id:
        raise HTTPException(400, f"invalid contact_id {contact_id}")
    return c


@router.get("/accounts", response_model=list[LoanAccountView])
async def list_loan_accounts(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    contacts_by_id = {c.id: c for c in (await session.execute(select(Contact).where(Contact.user_id == user.id))).scalars().all()}
    loan_out_sum = func.sum(case((Transaction.kind == "loan_out", Transaction.amount), else_=0))
    loan_in_sum = func.sum(case((Transaction.kind == "loan_repayment", Transaction.amount), else_=0))
    rows = (
        await session.execute(
            select(
                Transaction.contact_id,
                Transaction.currency_code,
                loan_out_sum,
                loan_in_sum,
            )
            .where(
                Transaction.user_id == user.id,
                Transaction.contact_id.is_not(None),
                Transaction.kind.in_(("loan_out", "loan_repayment")),
            )
            .group_by(Transaction.contact_id, Transaction.currency_code)
        )
    ).all()
    out: list[LoanAccountView] = []
    for cid, code, loan_out, loan_in in rows:
        c = contacts_by_id.get(cid)
        if not c:
            continue
        out.append(LoanAccountView(
            contact_id=cid,
            contact_name=c.name,
            currency_code=code,
            balance=-int(loan_out or 0) + int(loan_in or 0),
            loan_out_total=int(loan_out or 0),
            loan_repayment_total=int(loan_in or 0),
        ))
    out.sort(key=lambda x: (x.contact_name, x.currency_code))
    return out


@router.post("/split", response_model=list[TransactionRead], status_code=status.HTTP_201_CREATED)
async def create_split(
    payload: SplitCreateRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    wallet = await _check_wallet(session, user, payload.wallet_id, payload.currency_code)
    contact_ids = [p.contact_id for p in payload.participants]
    if len(set(contact_ids)) != len(contact_ids):
        raise HTTPException(400, "duplicate participants")
    for p in payload.participants:
        await _check_contact(session, user, p.contact_id)

    total_share = payload.my_share + sum(p.share for p in payload.participants)
    if total_share != payload.amount:
        raise HTTPException(400, f"shares sum {total_share} != total {payload.amount}")
    if not payload.participants:
        raise HTTPException(400, "need at least one participant")

    group_id = str(uuid.uuid4())
    if payload.recurrence_source_id:
        rec_group = await resolve_recurrence_group(session, user, payload.recurrence_source_id)
    else:
        rec_group = str(uuid.uuid4()) if payload.is_recurring else None

    created: list[Transaction] = []
    if payload.my_share > 0:
        t = Transaction(
            user_id=user.id,
            wallet_id=wallet.id,
            category_id=payload.category_id,
            merchant_id=payload.merchant_id,
            amount=payload.my_share,
            currency_code=payload.currency_code,
            kind="expense",
            occurred_on=payload.occurred_on,
            note=payload.note,
            split_group_id=group_id,
            is_recurring=payload.is_recurring,
            recurrence_period_days=payload.recurrence_period_days,
            recurrence_group_id=rec_group,
        )
        session.add(t)
        created.append(t)

    for p in payload.participants:
        if p.share <= 0:
            continue
        t = Transaction(
            user_id=user.id,
            wallet_id=wallet.id,
            category_id=payload.category_id,
            merchant_id=payload.merchant_id,
            contact_id=p.contact_id,
            amount=p.share,
            currency_code=payload.currency_code,
            kind="loan_out",
            occurred_on=payload.occurred_on,
            note=payload.note,
            split_group_id=group_id,
        )
        session.add(t)
        created.append(t)

    await session.commit()
    for t in created:
        await session.refresh(t)
    return created


@router.post("/repayment", response_model=TransactionRead, status_code=status.HTTP_201_CREATED)
async def receive_repayment(
    payload: RepaymentRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    await _check_contact(session, user, payload.contact_id)
    await _check_wallet(session, user, payload.wallet_id, payload.currency_code)
    t = Transaction(
        user_id=user.id,
        wallet_id=payload.wallet_id,
        contact_id=payload.contact_id,
        amount=payload.amount,
        currency_code=payload.currency_code,
        kind="loan_repayment",
        occurred_on=payload.occurred_on,
        note=payload.note,
    )
    session.add(t)
    await session.commit()
    await session.refresh(t)
    return t


@router.post("/lend", response_model=TransactionRead, status_code=status.HTTP_201_CREATED)
async def lend(
    payload: LendRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """直接借出: 记一笔 loan_out. 钱从选定 Wallet 出去 -> 物理余额↓、真实余额不变 (变成应收)."""
    await _check_contact(session, user, payload.contact_id)
    await _check_wallet(session, user, payload.wallet_id, payload.currency_code)
    t = Transaction(
        user_id=user.id,
        wallet_id=payload.wallet_id,
        contact_id=payload.contact_id,
        amount=payload.amount,
        currency_code=payload.currency_code,
        kind="loan_out",
        occurred_on=payload.occurred_on,
        note=payload.note,
    )
    session.add(t)
    await session.commit()
    await session.refresh(t)
    return t


@router.post("/write-off", response_model=list[TransactionRead], status_code=status.HTTP_201_CREATED)
async def write_off(
    payload: WriteOffRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    await _check_contact(session, user, payload.contact_id)
    await _check_wallet(session, user, payload.wallet_id, payload.currency_code)

    # 审计#39: 校验核销金额上限, 不能超过该联系人该币种的未收余额 (loan_out 合计 - loan_repayment 合计),
    # 否则会核销出不存在的应付、压低净值.
    loan_out_sum = func.sum(case((Transaction.kind == "loan_out", Transaction.amount), else_=0))
    loan_in_sum = func.sum(case((Transaction.kind == "loan_repayment", Transaction.amount), else_=0))
    out_total, in_total = (
        await session.execute(
            select(loan_out_sum, loan_in_sum).where(
                Transaction.user_id == user.id,
                Transaction.contact_id == payload.contact_id,
                Transaction.currency_code == payload.currency_code,
                Transaction.kind.in_(("loan_out", "loan_repayment")),
            )
        )
    ).one()
    outstanding = int(out_total or 0) - int(in_total or 0)
    if payload.amount > outstanding:
        raise HTTPException(400, f"核销金额 {payload.amount} 超过未收余额 {outstanding}")

    writeoff_cat_id = (
        await session.execute(
            select(Category.id).where(
                Category.user_id == user.id,
                Category.name == "坏账损失",
            ).order_by(Category.id).limit(1)  # #48: first 而非 one_or_none, 防历史重名 500
        )
    ).scalars().first()

    # 两笔用同一 split_group 绑定: 从账单删任一笔会级联删掉另一笔, 不会只删一半
    group = str(uuid.uuid4())
    loss = Transaction(
        user_id=user.id,
        wallet_id=payload.wallet_id,
        category_id=writeoff_cat_id,
        contact_id=payload.contact_id,
        amount=payload.amount,
        currency_code=payload.currency_code,
        kind="expense",
        occurred_on=payload.occurred_on,
        note=payload.note or "坏账核销",
        split_group_id=group,
    )
    repay = Transaction(
        user_id=user.id,
        wallet_id=payload.wallet_id,
        contact_id=payload.contact_id,
        amount=payload.amount,
        currency_code=payload.currency_code,
        kind="loan_repayment",
        occurred_on=payload.occurred_on,
        note=payload.note or "坏账核销",
        split_group_id=group,
    )
    session.add(loss)
    session.add(repay)
    await session.commit()
    await session.refresh(loss)
    await session.refresh(repay)
    return [loss, repay]


@router.post("/unsplit/{group_id}", response_model=TransactionRead)
async def unsplit(
    group_id: str,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    rows = (
        await session.execute(
            select(Transaction).where(
                Transaction.user_id == user.id,
                Transaction.split_group_id == group_id,
            )
        )
    ).scalars().all()
    if not rows:
        raise HTTPException(404, "split group not found")
    # 防呆: 这是借贷分摊撤销接口. AA 分摊组 = my_share 支出 + 参与人的 loan_out;
    # 投资卖出组(invest_sell+盈亏)和坏账核销组(坏账损失+loan_repayment)不能拿它撤销, 否则会并成一笔损坏账务.
    if any(t.kind in ("invest_buy", "invest_sell", "loan_repayment") or t.position_id is not None for t in rows):
        raise HTTPException(400, "该分组不是借贷分摊(可能是投资卖出或坏账核销), 不能在这里撤销")

    base = next((t for t in rows if t.kind == "expense"), None) or rows[0]
    total = sum(t.amount for t in rows)
    base.amount = total
    base.kind = "expense"
    base.contact_id = None
    base.split_group_id = None

    for t in rows:
        if t.id != base.id:
            await session.delete(t)
    await session.commit()
    await session.refresh(base)
    return base
