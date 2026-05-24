from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite+aiosqlite:////data/tally.db"
    secret_key: str = "change-me"
    allow_registration: bool = True
    jwt_lifetime_seconds: int = 60 * 60 * 24 * 14

    @property
    def sync_database_url(self) -> str:
        return self.database_url.replace("+aiosqlite", "")


settings = Settings()
