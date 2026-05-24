# Tally

Self-hosted multi-currency personal finance tracker. Runs locally in Docker.

## Run

```bash
cp .env.example .env
# edit .env, set a SECRET_KEY
docker compose up -d
```

Open `http://localhost:8002`, register an account. Data lives in `./data/tally.db`.

## Stack

FastAPI + SQLite on the backend, React + Vite on the frontend, served from a single container.

## License

MIT
