# Preclinic IQ AI — backend

FastAPI application layer. This is the only process allowed to touch PostgreSQL or AI/OCR/ASR credentials.

```
app/
  main.py            routes + static frontend
  config.py
  database.py
  models/            SQLAlchemy entities (UUID PKs)
  schemas/           Pydantic request bodies
  routers/           /api/v1/* as contracted
  services/          interview, safety, clinical, documents, providers
  security/          bcrypt + JWT
  workers/           reserved for Celery/RQ when REDIS_URL is set
```

Copy `.env.example` to `.env` for production secrets.
