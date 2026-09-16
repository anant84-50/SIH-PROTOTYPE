from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.tables import Patient, User
from app.security.tokens import try_decode
from app.utils.envelope import ApiError

bearer = HTTPBearer(auto_error=False)
COOKIE_NAME = "preclinic_access"


def extract_token(
    request: Request,
    creds: HTTPAuthorizationCredentials | None,
) -> str | None:
    if creds is not None and creds.credentials:
        return creds.credentials.strip()
    header = request.headers.get("X-Access-Token") or request.headers.get("x-access-token")
    if header:
        return header.strip()
    cookie = request.cookies.get(COOKIE_NAME)
    if cookie:
        return cookie.strip()
    # Preview / iframe fallback: ?access_token=
    q = request.query_params.get("access_token")
    if q:
        return q.strip()
    return None


def get_current_user_optional(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User | None:
    token = extract_token(request, creds)
    if not token:
        return None
    payload = try_decode(token)
    if not payload or payload.get("typ") != "access":
        return None
    user = db.get(User, payload.get("sub"))
    if not user or not user.is_active:
        return None
    return user


def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    token = extract_token(request, creds)
    if not token:
        raise ApiError("AUTH_REQUIRED", "Authentication is required.")
    payload = try_decode(token)
    if not payload or payload.get("typ") != "access":
        raise ApiError("AUTH_REQUIRED", "Session expired or token invalid.")
    user = db.get(User, payload.get("sub"))
    if not user or not user.is_active:
        raise ApiError("AUTH_REQUIRED", "Account is not active.")
    if payload.get("role") and user.role != payload.get("role"):
        raise ApiError("AUTH_REQUIRED", "Token role mismatch.")
    return user


def require_roles(*roles: str):
    def _inner(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise ApiError("FORBIDDEN", "You do not have permission for this action.")
        return user

    return _inner


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def resolve_patient_scope(
    patient_key: str,
    user: User,
    db: Session,
) -> Patient:
    patient = db.query(Patient).filter(Patient.patient_id == patient_key).first()
    if not patient:
        patient = db.get(Patient, patient_key)
    if not patient:
        raise ApiError("PATIENT_NOT_FOUND", "Patient record was not found.")
    if user.role == "PATIENT":
        own = db.query(Patient).filter(Patient.user_id == user.id).first()
        if not own or own.id != patient.id:
            raise ApiError("FORBIDDEN", "Patients may only access their own record.")
    return patient
