from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Transaction, User, Wallet
from ..schemas.wallet import WalletCreate, WalletRead, WalletUpdate
from ..services.balances import all_wallet_loan_summary, wallet_balances, wallet_loan_summary

router = APIRouter(prefix="/wallets", tags=["wallets"])


def _to_read(w: Wallet, balance: int, loan_out: int = 0, loan_in: int = 0) -> WalletRead:
    return WalletRead.model_validate({
        **w.__dict__,
        "balance": balance,
        "loan_out_on_wallet": loan_out,
        "loan_repayment_on_wallet": loan_in,
    })


@router.get("", response_model=list[WalletRead])
async def list_wallets(
    include_archived: bool = False,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(Wallet).where(Wallet.user_id == user.id).order_by(Wallet.sort_order, Wallet.id)
    if not include_archived:
        stmt = stmt.where(Wallet.archived == False)  # noqa: E712
    wallets = (await session.execute(stmt)).scalars().all()
    balances = await wallet_balances(session, user.id)
    loans = await all_wallet_loan_summary(session, user.id)
    return [
        _to_read(w, balances.get(w.id, w.initial_balance), *loans.get(w.id, (0, 0)))
        for w in wallets
    ]


@router.post("", response_model=WalletRead, status_code=status.HTTP_201_CREATED)
async def create_wallet(
    payload: WalletCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    w = Wallet(user_id=user.id, **payload.model_dump())
    session.add(w)
    await session.commit()
    await session.refresh(w)
    return _to_read(w, w.initial_balance)


@router.patch("/{wallet_id}", response_model=WalletRead)
async def update_wallet(
    wallet_id: int,
    payload: WalletUpdate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    w = await session.get(Wallet, wallet_id)
    if not w or w.user_id != user.id:
        raise HTTPException(404)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(w, k, v)
    await session.commit()
    await session.refresh(w)
    balances = await wallet_balances(session, user.id)
    loans = await all_wallet_loan_summary(session, user.id)
    return _to_read(w, balances.get(w.id, w.initial_balance), *loans.get(w.id, (0, 0)))


class MoveLoansResponse(BaseModel):
    amount: int       # 转账金额 (smallest unit); 0 = 没有借贷调整, 无操作
    from_wallet_id: int | None = None
    to_wallet_id: int | None = None


@router.post("/{source_id}/move-loans-to/{target_id}", response_model=MoveLoansResponse)
async def move_loans(
    source_id: int,
    target_id: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """通过创建一笔反向转账, 把 source 钱包的借贷调整 "转移" 到 target.
    例: source 上有 ¥3000 净 loan_out, 创建 target -> source 的 ¥3000 转账.
    结果: source 的 system 增 ¥3000 抵消 loan_out 影响, physical 回到原来的
    "无借贷" 状态; target 的 system 减 ¥3000, physical 相应下降, 相当于
    target 接管了对外的债权.

    原始的 loan_out / loan_repayment 交易完全不动 —— 历史不该被改写."""
    if source_id == target_id:
        raise HTTPException(400, "source and target must differ")
    src = await session.get(Wallet, source_id)
    dst = await session.get(Wallet, target_id)
    if not src or src.user_id != user.id:
        raise HTTPException(404, "source wallet not found")
    if not dst or dst.user_id != user.id:
        raise HTTPException(404, "target wallet not found")
    if src.currency_code != dst.currency_code:
        raise HTTPException(400, "currency must match")

    loan_out, loan_in = await wallet_loan_summary(session, user.id, source_id)
    net = loan_out - loan_in  # 正: 净借出, source physical < system
    if net == 0:
        return MoveLoansResponse(amount=0)

    # net > 0: dst -> src (拉回 src 被借走的钱);  net < 0: src -> dst (src 多出来的还回去)
    if net > 0:
        from_w, to_w, amount = dst, src, net
    else:
        from_w, to_w, amount = src, dst, -net

    today = date.today()
    note = f"借贷调整转移: {to_w.name} 接管 {from_w.name} 上的 {amount} ({src.currency_code}) 借贷"
    out_tx = Transaction(
        user_id=user.id,
        wallet_id=from_w.id,
        amount=amount,
        currency_code=from_w.currency_code,
        kind="transfer_out",
        occurred_on=today,
        note=note,
    )
    in_tx = Transaction(
        user_id=user.id,
        wallet_id=to_w.id,
        amount=amount,
        currency_code=to_w.currency_code,
        kind="transfer_in",
        occurred_on=today,
        note=note,
    )
    session.add(out_tx)
    session.add(in_tx)
    await session.flush()
    out_tx.transfer_pair_id = in_tx.id
    in_tx.transfer_pair_id = out_tx.id
    await session.commit()
    return MoveLoansResponse(amount=amount, from_wallet_id=from_w.id, to_wallet_id=to_w.id)


@router.delete("/{wallet_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_wallet(
    wallet_id: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    w = await session.get(Wallet, wallet_id)
    if not w or w.user_id != user.id:
        raise HTTPException(404)
    has_tx = (
        await session.execute(select(Transaction.id).where(Transaction.wallet_id == wallet_id).limit(1))
    ).scalar_one_or_none()
    if has_tx is not None:
        raise HTTPException(
            status_code=409,
            detail="Wallet has transactions; archive it instead of deleting",
        )
    await session.delete(w)
    await session.commit()
