import time
import uuid
from typing import Any

from jose import JWTError, jwt

from app.config import settings

ALGORITHM = "HS256"


def create_token(subject: str, role: str, minutes: int, token_type: str = "access", extra: dict | None = None) -> str:
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": subject,
        "role": role,
        "typ": token_type,
        "jti": str(uuid.uuid4()),
        "iat": now,
        "nbf": now - 5,
        "exp": now + max(int(minutes), 1) * 60,
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])


def try_decode(token: str) -> dict[str, Any] | None:
    if not token:
        return None
    try:
        return decode_token(token.strip())
    except JWTError:
        return None
