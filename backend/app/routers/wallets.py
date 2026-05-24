from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, update as sql_update
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Transaction, User, Wallet
from ..schemas.wallet import WalletCreate, WalletRead, WalletUpdate
from ..services.balances import all_wallet_loan_summary, wallet_balances

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
    moved: int


@router.post("/{source_id}/move-loans-to/{target_id}", response_model=MoveLoansResponse)
async def move_loans(
    source_id: int,
    target_id: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """把 source 钱包上的所有借贷类交易 (loan_out / loan_repayment) 改挂到 target.
    用于把零散的借贷归到一个主钱包统一对账, 不影响 system_balance, 只改
    physical_balance 的归属."""
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
    result = await session.execute(
        sql_update(Transaction)
        .where(
            Transaction.user_id == user.id,
            Transaction.wallet_id == source_id,
            Transaction.kind.in_(("loan_out", "loan_repayment")),
        )
        .values(wallet_id=target_id)
    )
    moved = result.rowcount or 0
    await session.commit()
    return MoveLoansResponse(moved=moved)


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
