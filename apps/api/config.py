import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Find .env file - check current dir, then project root
# __file__ = apps/api/config.py, so parent.parent = project root
def _find_env_file() -> str:
    project_root = Path(__file__).parent.parent.parent  # freeframe/
    candidates = [
        Path(".env"),
        Path(".env.local"),
        project_root / ".env",
        project_root / ".env.local",
    ]
    for p in candidates:
        if p.exists():
            return str(p.resolve())
    return ".env"

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_find_env_file(),
        env_file_encoding="utf-8",
        extra="ignore"  # Ignore extra env vars not in model
    )

    database_url: str
    redis_url: str
    s3_bucket: str
    s3_endpoint: str
    s3_access_key: str
    s3_secret_key: str
    s3_region: str = "us-east-1"
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7
    frontend_url: str = "http://localhost:3000"
    transcoder_engine: str = "ffmpeg"

settings = Settings()
