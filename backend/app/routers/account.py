import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, status
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.config import settings
from ..core.db import get_session
from ..models import Attachment, Budget, Category, Contact, Merchant, Position, Transaction, User, Wallet
from ..services.seed import seed_user_defaults

router = APIRouter(prefix="/account", tags=["account"])


@router.post("/reset", status_code=status.HTTP_204_NO_CONTENT)
async def reset_my_data(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    await session.execute(delete(Attachment).where(Attachment.user_id == user.id))
    await session.execute(delete(Transaction).where(Transaction.user_id == user.id))
    await session.execute(delete(Position).where(Position.user_id == user.id))
    await session.execute(delete(Budget).where(Budget.user_id == user.id))
    await session.execute(delete(Wallet).where(Wallet.user_id == user.id))
    await session.execute(delete(Merchant).where(Merchant.user_id == user.id))
    await session.execute(delete(Contact).where(Contact.user_id == user.id))
    await session.execute(delete(Category).where(Category.user_id == user.id))
    # 审计 #61: 不在此单独提交; 让"清空 + 重建默认"落在同一事务(seed_user_defaults 内部会 commit),
    # 中途断电/异常时整体回滚, 不会留下"业务数据删光但默认分类没建"的空账号(系统分类缺失会连带坏账)。
    await seed_user_defaults(session, user.id)

    # DB 清空+重建已提交后再删收据文件(reset 本就要清空收据); 文件系统操作不可回滚, 放最后。
    db_path = Path(settings.sync_database_url.split("///", 1)[-1])
    receipts_dir = db_path.parent / "receipts" / str(user.id)
    if receipts_dir.exists():
        shutil.rmtree(receipts_dir, ignore_errors=True)
