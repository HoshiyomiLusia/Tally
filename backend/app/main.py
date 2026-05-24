import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config as AlembicConfig
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .core.config import settings
from .core.db import SessionLocal
from .routers import (
    account, attachments, auth, budgets, categories, contacts, currencies,
    dashboard, exchange_rates, io, loans, merchants, reconciliation, recurring,
    stats, transactions, wallets,
)
from .services.fx import refresh_rates, schedule_refresh
from .services.seed import seed_currencies

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tally")


def _run_migrations() -> None:
    cfg_path = Path(__file__).resolve().parent.parent / "alembic.ini"
    cfg = AlembicConfig(str(cfg_path))
    cfg.set_main_option("sqlalchemy.url", settings.sync_database_url)
    command.upgrade(cfg, "head")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Path(settings.sync_database_url.split("///", 1)[-1]).parent.mkdir(parents=True, exist_ok=True)
    _run_migrations()
    async with SessionLocal() as session:
        await seed_currencies(session)
        try:
            await refresh_rates(session)
        except Exception as e:
            logger.warning("initial fx refresh failed: %s", e)
    task = asyncio.create_task(schedule_refresh())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="Tally", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = FastAPI()
api.include_router(auth.router)
api.include_router(auth.users_router)
api.include_router(currencies.router)
api.include_router(wallets.router)
api.include_router(categories.router)
api.include_router(merchants.router)
api.include_router(contacts.router)
api.include_router(transactions.router)
api.include_router(loans.router)
api.include_router(reconciliation.router)
api.include_router(budgets.router)
api.include_router(recurring.router)
api.include_router(stats.router)
api.include_router(attachments.router)
api.include_router(io.router)
api.include_router(exchange_rates.router)
api.include_router(dashboard.router)
api.include_router(account.router)


@api.get("/health")
async def health():
    return {"status": "ok"}


app.mount("/api", api)

static_dir = Path(__file__).resolve().parent.parent / "static"
if static_dir.exists():
    app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        index = static_dir / "index.html"
        if index.exists():
            return FileResponse(index)
        return {"message": "Tally backend is running. Mount frontend build at backend/static/."}
