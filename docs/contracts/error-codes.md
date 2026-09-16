# Preclinic IQ AI — Error Codes

Single source of truth. Frontend must branch on `error.code`, never on message text.

| Code | HTTP | Meaning |
|---|---|---|
| AUTH_REQUIRED | 401 | Missing or expired credentials |
| AUTH_INVALID | 401 | Bad identifier or password / OTP |
| AUTH_OTP_INVALID | 401 | OTP mismatch or expired |
| FORBIDDEN | 403 | Authenticated but role/scope denied |
| PATIENT_NOT_FOUND | 404 | Unknown patient UUID or PCI ID |
| VISIT_NOT_FOUND | 404 | Unknown visit |
| DOCUMENT_NOT_FOUND | 404 | Unknown document |
| EMERGENCY_NOT_FOUND | 404 | Unknown emergency alert |
| CONFLICT_NOT_FOUND | 404 | Unknown conflict |
| USER_NOT_FOUND | 404 | Unknown user |
| CONSENT_REQUIRED | 403 | Required consent not granted |
| VALIDATION_ERROR | 422 | Request failed schema/business validation |
| RATE_LIMITED | 429 | Too many requests |
| AI_PROVIDER_ERROR | 503 | AI provider failed; fallback available |
| OCR_PROVIDER_ERROR | 503 | OCR provider failed; job queued |
| ASR_PROVIDER_ERROR | 503 | Speech-to-text failed |
| FILE_INVALID | 400 | File type, size, or malware hook rejected |
| DUPLICATE_RESOURCE | 409 | Unique constraint (e.g. login ID) |
| STATE_CONFLICT | 409 | Illegal status transition |
| INTERNAL_ERROR | 500 | Unexpected server error |

Envelope (never change):

```json
{
  "success": false,
  "data": null,
  "error": { "code": "ERROR_CODE", "message": "Human-readable message" },
  "meta": {}
}
```
