# Frontend ↔ Backend Integration

## Topology

```
HTML/CSS/Vanilla JS  →  FastAPI (/api/v1)  →  PostgreSQL
                              ↓
                     AI / OCR / ASR providers
                     (never called from the browser)
```

## Response envelope

Success: `{ "success": true, "data": {}, "error": null, "meta": {} }`
Error: `{ "success": false, "data": null, "error": { "code", "message" }, "meta": {} }`

## Auth

1. `POST /api/v1/auth/login` with `{ identifier, password, role }`
2. Store `accessToken` in `sessionStorage` (not localStorage for clinical sessions)
3. Send `Authorization: Bearer <token>` on every protected call
4. On `AUTH_REQUIRED`, redirect to `/login`

Patient identifier is the patient-facing ID (`PCI-2026-000001`).
Doctor identifier is `Doctor ID` (`DOC-001`).
Admin identifier is `Admin ID` (`ADMIN-001`).

## Routes (static)

| Path | File |
|---|---|
| `/` | `frontend/index.html` |
| `/login` | `frontend/login.html` |
| `/admin` | `frontend/admin.html` |
| `/doctor` | `frontend/doctor.html` |
| `/patient` | `frontend/patient.html` |

## Real-time emergency

1. Open `WS /api/v1/ws/emergencies?token=...`
2. Event name: `emergency.created`
3. If WS fails, poll `GET /api/v1/emergency/active` every 8s

## Field names

Use camelCase in JSON. Database columns are snake_case. Pydantic aliases convert.

Do not invent new endpoint paths. See `api-contract.yaml`.
