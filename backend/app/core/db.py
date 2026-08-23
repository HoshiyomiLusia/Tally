from collections.abc import AsyncGenerator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import settings


class Base(DeclarativeBase):
    pass


engine = create_async_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if "sqlite" in settings.database_url else {},
    echo=False,
)

if "sqlite" in settings.database_url:
    # 审计 #96: SQLite 默认不强制外键, 模型里所有 ondelete=CASCADE/SET NULL 此前都是空文 ——
    # 删父分类留孤儿子类、删分类/商家后交易引用悬空、id 复用让新分类"继承"旧交易。
    # 每个新连接开启外键检查(只作用于运行时引擎; alembic 迁移用自己的同步引擎, 批量重建表时保持关闭)。
    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_fk_on(dbapi_conn, _record):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")


SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
