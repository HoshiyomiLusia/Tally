from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Category, Transaction, User, Wallet
from ..schemas.reconciliation import ReconciliationRequest, ReconciliationResult, ReconciliationView
from ..services.balances import wallet_balances, wallet_loan_summary

router = APIRouter(prefix="/wallets", tags=["reconciliation"])


async def _get_wallet(session: AsyncSession, user: User, wallet_id: int) -> Wallet:
    w = await session.get(Wallet, wallet_id)
    if not w or w.user_id != user.id:
        raise HTTPException(404, "wallet not found")
    return w


@router.get("/{wallet_id}/reconciliation", response_model=ReconciliationView)
async def get_reconciliation(
    wallet_id: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    wallet = await _get_wallet(session, user, wallet_id)
    balances = await wallet_balances(session, user.id)
    system_balance = balances.get(wallet_id, wallet.initial_balance)
    loan_out, loan_in = await wallet_loan_summary(session, user.id, wallet_id)
    expected = system_balance - loan_out + loan_in
    return ReconciliationView(
        wallet_id=wallet_id,
        currency_code=wallet.currency_code,
        system_balance=system_balance,
        loan_out_on_wallet=loan_out,
        loan_repayment_on_wallet=loan_in,
        expected_physical=expected,
    )


@router.post("/{wallet_id}/reconciliation", response_model=ReconciliationResult, status_code=status.HTTP_201_CREATED)
async def reconcile(
    wallet_id: int,
    payload: ReconciliationRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    wallet = await _get_wallet(session, user, wallet_id)
    balances = await wallet_balances(session, user.id)
    system_balance = balances.get(wallet_id, wallet.initial_balance)
    loan_out, loan_in = await wallet_loan_summary(session, user.id, wallet_id)
    expected = system_balance - loan_out + loan_in
    diff = payload.actual_balance - expected
    if diff == 0:
        return ReconciliationResult(diff=0, transaction_id=None)

    cat_id = (
        await session.execute(
            select(Category.id).where(Category.user_id == user.id, Category.name == "对账调整")
        )
    ).scalar_one_or_none()

    t = Transaction(
        user_id=user.id,
        wallet_id=wallet_id,
        category_id=cat_id,
        amount=abs(diff),
        currency_code=wallet.currency_code,
        kind="income" if diff > 0 else "expense",
        occurred_on=payload.occurred_on,
        note=payload.note or "对账调整",
    )
    session.add(t)
    await session.commit()
    await session.refresh(t)
    return ReconciliationResult(diff=diff, transaction_id=t.id)
