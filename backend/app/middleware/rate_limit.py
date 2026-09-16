import time
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.config import settings
from app.utils.envelope import fail


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, per_minute: int | None = None):
        super().__init__(app)
        self.per_minute = per_minute or settings.rate_limit_per_minute
        self.hits: dict[str, deque] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/api/") and "/auth/login" not in request.url.path:
            key = request.client.host if request.client else "anon"
            now = time.time()
            window = self.hits[key]
            while window and now - window[0] > 60:
                window.popleft()
            if len(window) >= self.per_minute:
                return fail("RATE_LIMITED", "Too many requests. Please wait a moment.", 429)
            window.append(now)
        return await call_next(request)
