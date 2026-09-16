# Environment Variables

Never put secrets in frontend JavaScript.

| Variable | Required | Default | Notes |
|---|---|---|---|
| APP_NAME | no | Preclinic IQ AI | |
| APP_ENV | no | development | `development` \| `production` |
| SECRET_KEY | yes (prod) | dev-only fallback | JWT signing |
| ACCESS_TOKEN_EXPIRE_MINUTES | no | 60 | |
| REFRESH_TOKEN_EXPIRE_MINUTES | no | 10080 | 7 days |
| DATABASE_URL | yes (prod) | `sqlite+pysqlite:////.../preclinic.db` | PostgreSQL: `postgresql+psycopg://user:pass@host:5432/preclinic` |
| REDIS_URL | no | (empty) | If empty, in-process queue is used |
| CORS_ORIGINS | no | `*` in dev | Comma-separated |
| STORAGE_DIR | no | `backend/storage` | Document object store root |
| REQUIRE_ADMIN_2FA | no | false | true in production |
| AI_PROVIDER | no | mock | `mock` \| `openai` |
| OPENAI_API_KEY | no | | Backend only |
| OCR_PROVIDER | no | mock | |
| ASR_PROVIDER | no | mock | |
| RATE_LIMIT_PER_MINUTE | no | 120 | |

Frontend only needs `window.PRECLINIC_API_BASE` (same origin `/api/v1`).
