from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select, update as sql_update
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Transaction, User, Wallet
from ..schemas.wallet import WalletCreate, WalletRead, WalletUpdate
from ..services.balances import (
    all_wallet_investment_summary,
    all_wallet_loan_summary,
    wallet_balances,
)

router = APIRouter(prefix="/wallets", tags=["wallets"])


def _to_read(
    w: Wallet, balance: int, loan_out: int = 0, loan_in: int = 0,
    invest_out: int = 0, invest_in: int = 0,
) -> WalletRead:
    return WalletRead.model_validate({
        **w.__dict__,
        "balance": balance,
        "loan_out_on_wallet": loan_out,
        "loan_repayment_on_wallet": loan_in,
        "invest_out_on_wallet": invest_out,
        "invest_in_on_wallet": invest_in,
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
    invests = await all_wallet_investment_summary(session, user.id)
    return [
        _to_read(w, balances.get(w.id, w.initial_balance), *loans.get(w.id, (0, 0)), *invests.get(w.id, (0, 0)))
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
    invests = await all_wallet_investment_summary(session, user.id)
    return _to_read(w, balances.get(w.id, w.initial_balance), *loans.get(w.id, (0, 0)), *invests.get(w.id, (0, 0)))


class MoveLoansResponse(BaseModel):
    reattributed: int  # 多少笔借贷被重新归属
    amount: int        # 总金额 (smallest unit)


@router.post("/{source_id}/move-loans-to/{target_id}", response_model=MoveLoansResponse)
async def move_loans(
    source_id: int,
    target_id: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """名义转移: 把当前归属在 source 的借贷交易 (loan_out / loan_repayment)
    的 attributed_wallet_id 改成 target. 不创建任何新交易, 不动 wallet_id
    (历史保留), 仅改聚合归属. 结果: source 的物理余额计算里不再有这部分
    借贷调整, target 接管."""
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

    # 凡是当前 attributed 到 source 的借贷条目, 都改成 target.
    # COALESCE(attributed_wallet_id, wallet_id) == source 的所有 loan_*.
    aw = func.coalesce(Transaction.attributed_wallet_id, Transaction.wallet_id)
    affected_rows = (
        await session.execute(
            select(Transaction.id, Transaction.amount).where(
                Transaction.user_id == user.id,
                Transaction.kind.in_(("loan_out", "loan_repayment")),
                aw == source_id,
            )
        )
    ).all()
    if not affected_rows:
        return MoveLoansResponse(reattributed=0, amount=0)

    ids = [r[0] for r in affected_rows]
    total = sum(int(r[1]) for r in affected_rows)
    await session.execute(
        sql_update(Transaction)
        .where(Transaction.id.in_(ids))
        .values(attributed_wallet_id=target_id)
    )
    await session.commit()
    return MoveLoansResponse(reattributed=len(ids), amount=total)


@router.delete("/{wallet_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_wallet(
    wallet_id: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    w = await session.get(Wallet, wallet_id)
    if not w or w.user_id != user.id:
        raise HTTPException(404)
    # 占用检查要同时看 wallet_id 和 attributed_wallet_id: 后者是借贷调整的"名义归属"钱包,
    # 漏检就能删掉它, 让那笔金额从所有按归属聚合的视图静默蒸发(审计 #25).
    has_tx = (
        await session.execute(
            select(Transaction.id).where(
                or_(Transaction.wallet_id == wallet_id, Transaction.attributed_wallet_id == wallet_id)
            ).limit(1)
        )
    ).scalar_one_or_none()
    if has_tx is not None:
        raise HTTPException(
            status_code=409,
            detail="钱包仍有交易或借贷归属记录; 请改为归档而不是删除",
        )
    await session.delete(w)
    await session.commit()
