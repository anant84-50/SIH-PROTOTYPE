from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ROOT / ".env"), extra="ignore")

    app_name: str = "Preclinic IQ AI"
    app_env: str = "development"
    secret_key: str = "preclinic-iq-ai-dev-secret-change-in-production"
    access_token_expire_minutes: int = 60
    refresh_token_expire_minutes: int = 60 * 24 * 7
    database_url: str = f"sqlite+pysqlite:///{ROOT / 'preclinic.db'}"
    redis_url: str = ""
    cors_origins: str = "*"
    storage_dir: str = str(ROOT / "storage")
    require_admin_2fa: bool = False
    ai_provider: str = "mock"
    ocr_provider: str = "mock"
    asr_provider: str = "mock"
    rate_limit_per_minute: int = 120
    openai_api_key: str = ""
    demo_otp: str = "123456"

    @property
    def cors_origin_list(self) -> list[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
