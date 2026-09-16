<<<<<<< HEAD
# Preclinic IQ AI

**SIH 26047 — Patient Case-Taking Software**  
Ministry of Ayush · All India Institute of Ayurveda · Smart Automation

One product, one contract:

```
HTML / CSS / Vanilla JS
        ↓
Python FastAPI  (/api/v1)
        ↓
PostgreSQL   (SQLite fallback for local demo)
        ↓
AI / OCR / ASR providers  (backend only, mock by default)
```

AI prepares structured, source-linked context. **It does not diagnose or prescribe.**

## Run locally

```bash
cd backend
python3 -m pip install -r requirements.txt
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open:

- Institute page — `/`
- What it is — `/about`
- How to use — `/how-it-works`
- Why it exists — `/why`
- Sign in — `/login`
- Patient — `/patient`
- Doctor — `/doctor`
- Admin — `/admin`
- OpenAPI — `/api/docs`

## Demo identities

| Role | ID | Password |
|---|---|---|
| Admin | `NexusCare` | `2525` |
| Doctor | `DOC-001` | `Doctor@1234` |
| Patient (returning, diabetes + fever draft) | `PCI-2026-000001` | `Patient@1234` |
| Patient (emergency demo) | `PCI-2026-000002` | `Patient@1234` |

New patients can self-register on `/login`. They receive the next `PCI-YYYY-XXXXXX`.

## What is wired

- Three panels, JWT sessions, RBAC on every protected route
- Adaptive interview for FEVER, COUGH_COLD, HEADACHE, ABDOMINAL_PAIN, BODY_JOINT_PAIN, OTHER
- Voice in the browser (Web Speech) → transcript posted to Python (providers never called from JS)
- Document upload → queued OCR mock → entities + timeline + conflict if meds disagree
- First-class AYUSH history fields
- Versioned AI summaries: `AI_DRAFT` → `PATIENT_CONFIRMED` → `DOCTOR_VERIFIED`
- Deterministic emergency rules (not an LLM) + WebSocket `emergency.created` with 8s polling fallback
- Audit log, rate limit, security headers, FHIR/ABDM mock adapters

## PostgreSQL (production)

```bash
docker compose up db -d
export DATABASE_URL=postgresql+psycopg://preclinic:preclinic@localhost:5432/preclinic
```

Alembic lives in `backend/migrations`. The API also calls `create_all` on startup so the prototype boots without a migration runner.

## Contracts (do not fork silently)

`docs/contracts/` is the source of truth for paths, enums, error codes, and envelopes.

## Tests

```bash
cd backend && python3 -m pytest -q
```

Critical cases: Patient A cannot read Patient B; patients cannot call admin APIs; doctor-verified summaries cannot be overwritten by AI/patient; emergency text reaches the doctor inbox.
=======
# PreclinicIQ
patent case taking software
>>>>>>> bd534248916842973afdc413f60c728c80f7cbe9
