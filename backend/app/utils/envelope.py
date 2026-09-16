from typing import Any

from fastapi.responses import JSONResponse


def ok(data: Any = None, meta: dict | None = None, status_code: int = 200) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"success": True, "data": data if data is not None else {}, "error": None, "meta": meta or {}},
    )


def fail(code: str, message: str, status_code: int = 400, meta: dict | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "data": None,
            "error": {"code": code, "message": message},
            "meta": meta or {},
        },
    )


HTTP_FOR_CODE = {
    "AUTH_REQUIRED": 401,
    "AUTH_INVALID": 401,
    "AUTH_OTP_INVALID": 401,
    "FORBIDDEN": 403,
    "CONSENT_REQUIRED": 403,
    "PATIENT_NOT_FOUND": 404,
    "VISIT_NOT_FOUND": 404,
    "DOCUMENT_NOT_FOUND": 404,
    "EMERGENCY_NOT_FOUND": 404,
    "CONFLICT_NOT_FOUND": 404,
    "USER_NOT_FOUND": 404,
    "VALIDATION_ERROR": 422,
    "RATE_LIMITED": 429,
    "AI_PROVIDER_ERROR": 503,
    "OCR_PROVIDER_ERROR": 503,
    "ASR_PROVIDER_ERROR": 503,
    "FILE_INVALID": 400,
    "DUPLICATE_RESOURCE": 409,
    "STATE_CONFLICT": 409,
    "INTERNAL_ERROR": 500,
}


class ApiError(Exception):
    def __init__(self, code: str, message: str, status_code: int | None = None):
        self.code = code
        self.message = message
        self.status_code = status_code or HTTP_FOR_CODE.get(code, 400)
