# Tally

Self-hosted, multi-user personal finance tracker. Multi-currency, split-bill aware, fully local.

## Quick start

```bash
git clone <this repo>
cd Tally
cp .env.example .env
# edit .env: set a real SECRET_KEY
docker compose up -d
# open http://localhost:8002
```

First run creates the SQLite DB at `./data/tally.db` and seeds default currencies, categories, and merchants. Register the first account from the login page.

## Stack

- Backend: FastAPI + SQLAlchemy + Alembic + fastapi-users, SQLite (WAL)
- Frontend: React + Vite + React Router + React Query + Tailwind + Recharts
- Single Docker container, bind-mounts `./data` for persistence

## Project layout

```
backend/        FastAPI app + Alembic migrations
frontend/       React/Vite SPA
data/           SQLite DB + receipt uploads (gitignored)
Dockerfile      multi-stage: build frontend → run backend
docker-compose.yml
```

## Data lives entirely on your machine

Nothing leaves the host. Backup = copy `data/tally.db`. Migrate to a new machine = copy `data/` and `.env`.

## Status

v0.1 — auth, wallets, categories, merchants, transactions, basic dashboard, manual exchange rates.

Roadmap:
- v0.2 split bills + loan accounts + reconciliation
- v0.3 budgets + statistics + charts
- v0.4 import/export + receipt upload + recurring bill reminders
- v0.5 auto exchange rate fetch

## License

MIT
