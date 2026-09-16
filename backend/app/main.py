from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import IntegrityError
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.database import Base, SessionLocal, engine
from app.middleware.rate_limit import RateLimitMiddleware
from app.routers import admin, ai, auth, doctor, documents, emergency, patients, visits
from app.seed import ensure_admin_credentials, seed_if_empty
from app.utils.envelope import ApiError, fail

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


class SecurityHeaders(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Permissions-Policy"] = "microphone=(self), camera=()"
        response.headers["Cache-Control"] = "no-store" if request.url.path.startswith("/api/") else response.headers.get("Cache-Control", "")
        if settings.app_env == "production":
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        return response


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
    )

    app.add_middleware(SecurityHeaders)
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(ApiError)
    async def api_error_handler(_request: Request, exc: ApiError):
        return fail(exc.code, exc.message, exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_handler(_request: Request, exc: RequestValidationError):
        return fail("VALIDATION_ERROR", "Request failed validation.", 422, meta={"details": exc.errors()})

    @app.exception_handler(IntegrityError)
    async def integrity_handler(_request: Request, _exc: IntegrityError):
        return fail("DUPLICATE_RESOURCE", "A unique record already exists.", 409)

    @app.exception_handler(Exception)
    async def generic_handler(_request: Request, _exc: Exception):
        return fail("INTERNAL_ERROR", "An unexpected error occurred.", 500)

    api = "/api/v1"
    app.include_router(auth.router, prefix=api)
    app.include_router(patients.router, prefix=api)
    app.include_router(visits.router, prefix=api)
    app.include_router(ai.router, prefix=api)
    app.include_router(documents.router, prefix=api)
    app.include_router(emergency.router, prefix=api)
    app.include_router(doctor.router, prefix=api)
    app.include_router(admin.router, prefix=api)

    @app.get("/api/v1/health")
    def public_health():
        from app.utils.envelope import ok

        return ok({"status": "ok", "app": settings.app_name})

    pages = {
        "/": FRONTEND / "index.html",
        "/login": FRONTEND / "login.html",
        "/admin": FRONTEND / "admin.html",
        "/doctor": FRONTEND / "doctor.html",
        "/patient": FRONTEND / "patient.html",
        "/about": FRONTEND / "about.html",
        "/how-it-works": FRONTEND / "how-it-works.html",
        "/why": FRONTEND / "why.html",
    }

    def _page(path: Path):
        if not path.exists():
            return fail("INTERNAL_ERROR", "Frontend file missing.", 500)
        return FileResponse(path)

    @app.get("/")
    def home():
        return _page(pages["/"])

    @app.get("/login")
    def login_page():
        return _page(pages["/login"])

    @app.get("/admin")
    def admin_page():
        return _page(pages["/admin"])

    @app.get("/doctor")
    def doctor_page():
        return _page(pages["/doctor"])

    @app.get("/patient")
    def patient_page():
        return _page(pages["/patient"])

    @app.get("/about")
    def about_page():
        return _page(pages["/about"])

    @app.get("/how-it-works")
    def how_page():
        return _page(pages["/how-it-works"])

    @app.get("/why")
    def why_page():
        return _page(pages["/why"])

    @app.get("/login.html")
    def login_html():
        return RedirectResponse("/login")

    if FRONTEND.exists():
        app.mount("/css", StaticFiles(directory=FRONTEND / "css"), name="css")
        app.mount("/js", StaticFiles(directory=FRONTEND / "js"), name="js")
        assets = FRONTEND / "assets"
        assets.mkdir(exist_ok=True)
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    return app


app = create_app()


@app.on_event("startup")
def on_startup():
    Path(settings.storage_dir).mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_if_empty(db)
        ensure_admin_credentials(db)
    finally:
        db.close()
