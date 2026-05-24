from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Transaction, User, Wallet
from ..schemas.wallet import WalletCreate, WalletRead, WalletUpdate
from ..services.balances import wallet_balances

router = APIRouter(prefix="/wallets", tags=["wallets"])


def _to_read(w: Wallet, balance: int) -> WalletRead:
    return WalletRead.model_validate({**w.__dict__, "balance": balance})


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
    return [_to_read(w, balances.get(w.id, w.initial_balance)) for w in wallets]


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
    return _to_read(w, balances.get(w.id, w.initial_balance))


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
