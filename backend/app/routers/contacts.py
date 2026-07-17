from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Contact, Transaction, User
from ..schemas.contact import ContactCreate, ContactRead, ContactUpdate

router = APIRouter(prefix="/contacts", tags=["contacts"])


@router.get("", response_model=list[ContactRead])
async def list_contacts(
    include_archived: bool = False,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(Contact).where(Contact.user_id == user.id).order_by(Contact.name)
    if not include_archived:
        stmt = stmt.where(Contact.archived == False)  # noqa: E712
    return (await session.execute(stmt)).scalars().all()


@router.post("", response_model=ContactRead, status_code=status.HTTP_201_CREATED)
async def create_contact(
    payload: ContactCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    c = Contact(user_id=user.id, **payload.model_dump())
    session.add(c)
    await session.commit()
    await session.refresh(c)
    return c


@router.patch("/{cid}", response_model=ContactRead)
async def update_contact(
    cid: int,
    payload: ContactUpdate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    c = await session.get(Contact, cid)
    if not c or c.user_id != user.id:
        raise HTTPException(404)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    await session.commit()
    await session.refresh(c)
    return c


@router.delete("/{cid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_contact(
    cid: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    c = await session.get(Contact, cid)
    if not c or c.user_id != user.id:
        raise HTTPException(404)
    # 有借贷往来就不许删: 否则借出/还款记录失去归属, 借贷账户整条从视图消失、应收静默蒸发(审计 #27)
    has_loan = (
        await session.execute(
            select(Transaction.id).where(
                Transaction.user_id == user.id,
                Transaction.contact_id == cid,
                Transaction.kind.in_(("loan_out", "loan_repayment")),
            ).limit(1)
        )
    ).scalar_one_or_none()
    if has_loan is not None:
        raise HTTPException(409, "该联系人还有借贷往来记录, 不能删除(会让应收/应付凭空消失); 请先结清")
    await session.delete(c)
    await session.commit()
