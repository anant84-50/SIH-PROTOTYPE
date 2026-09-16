import hashlib
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import COOKIE_NAME, get_current_user
from app.models.tables import Doctor, OtpChallenge, Patient, RefreshToken, User
from app.schemas.common import LoginIn, OtpRequestIn, OtpVerifyIn, RefreshIn
from app.security.passwords import verify_password
from app.security.tokens import create_token, try_decode
from app.services.audit import audit
from app.utils.envelope import ApiError, ok


def _attach_cookie(response, access: str, request: Request | None = None):
    secure = bool(request and request.url.scheme == "https")
    response.set_cookie(
        key=COOKIE_NAME,
        value=access,
        max_age=settings.access_token_expire_minutes * 60,
        httponly=False,
        samesite="none" if secure else "lax",
        path="/",
        secure=secure,
    )
    return response


def _clear_cookie(response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return response

router = APIRouter(prefix="/auth", tags=["auth"])


def _issue(user: User, db: Session) -> dict:
    extra = {"loginId": user.login_id, "displayName": user.display_name or ""}
    if user.role == "PATIENT":
        p = db.query(Patient).filter(Patient.user_id == user.id).first()
        if p:
            extra["patientId"] = p.patient_id
    if user.role == "DOCTOR":
        d = db.query(Doctor).filter(Doctor.user_id == user.id).first()
        if d:
            extra["doctorId"] = d.doctor_id
    access = create_token(user.id, user.role, settings.access_token_expire_minutes, "access", extra)
    refresh = create_token(user.id, user.role, settings.refresh_token_expire_minutes, "refresh")
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hashlib.sha256(refresh.encode()).hexdigest(),
            expires_at=datetime.utcnow() + timedelta(minutes=settings.refresh_token_expire_minutes),
        )
    )
    payload = {
        "accessToken": access,
        "refreshToken": refresh,
        "expiresIn": settings.access_token_expire_minutes * 60,
        "user": _principal(user, db),
    }
    return payload


def _principal(user: User, db: Session) -> dict:
    data = {
        "id": user.id,
        "loginId": user.login_id,
        "role": user.role,
        "displayName": user.display_name,
        "email": user.email,
        "phone": user.phone,
    }
    if user.role == "PATIENT":
        p = db.query(Patient).filter(Patient.user_id == user.id).first()
        if p:
            data["patientId"] = p.patient_id
            data["patientUuid"] = p.id
    if user.role == "DOCTOR":
        d = db.query(Doctor).filter(Doctor.user_id == user.id).first()
        if d:
            data["doctorId"] = d.doctor_id
            data["doctorUuid"] = d.id
            data["department"] = d.department
    return data


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.login_id == body.identifier.strip()).first()
    if not user or user.role != body.role or not user.is_active:
        raise ApiError("AUTH_INVALID", "Identifier, role or password is incorrect.")
    if not verify_password(body.password, user.password_hash):
        raise ApiError("AUTH_INVALID", "Identifier, role or password is incorrect.")
    if user.role == "ADMIN" and settings.require_admin_2fa and settings.app_env == "production":
        if not body.otp:
            raise ApiError("AUTH_OTP_INVALID", "Administrator 2FA code is required.")
    audit(
        db,
        actor_user_id=user.id,
        action="login",
        resource_type="session",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    # re-issue after commit of audit + tokens
    tokens = _issue(user, db)
    db.commit()
    return _attach_cookie(ok(tokens), tokens["accessToken"], request)


@router.post("/logout")
def logout(body: RefreshIn, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    digest = hashlib.sha256(body.refreshToken.encode()).hexdigest()
    row = db.query(RefreshToken).filter(RefreshToken.token_hash == digest, RefreshToken.user_id == user.id).first()
    if row:
        row.revoked = True
    audit(db, actor_user_id=user.id, action="logout", resource_type="session", ip=request.client.host if request.client else None)
    db.commit()
    return _clear_cookie(ok({"loggedOut": True}))


@router.post("/refresh")
def refresh(body: RefreshIn, request: Request, db: Session = Depends(get_db)):
    payload = try_decode(body.refreshToken)
    if not payload or payload.get("typ") != "refresh":
        raise ApiError("AUTH_REQUIRED", "Refresh token is invalid.")
    digest = hashlib.sha256(body.refreshToken.encode()).hexdigest()
    row = db.query(RefreshToken).filter(RefreshToken.token_hash == digest, RefreshToken.revoked.is_(False)).first()
    if not row or row.expires_at < datetime.utcnow():
        raise ApiError("AUTH_REQUIRED", "Refresh token is expired or revoked.")
    user = db.get(User, payload["sub"])
    if not user or not user.is_active:
        raise ApiError("AUTH_REQUIRED", "Account is not active.")
    row.revoked = True
    tokens = _issue(user, db)
    db.commit()
    return _attach_cookie(ok(tokens), tokens["accessToken"], request)


@router.post("/otp/request")
def otp_request(body: OtpRequestIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.login_id == body.identifier.strip(), User.role == body.role).first()
    if not user:
        # Do not leak whether the ID exists
        return ok({"sent": True, "demoHint": None})
    db.query(OtpChallenge).filter(OtpChallenge.login_id == user.login_id).delete()
    db.add(
        OtpChallenge(
            login_id=user.login_id,
            code=settings.demo_otp,
            expires_at=datetime.utcnow() + timedelta(minutes=10),
        )
    )
    db.commit()
    hint = settings.demo_otp if settings.app_env != "production" else None
    return ok({"sent": True, "demoHint": hint})


@router.post("/otp/verify")
def otp_verify(body: OtpVerifyIn, request: Request, db: Session = Depends(get_db)):
    row = db.query(OtpChallenge).filter(OtpChallenge.login_id == body.identifier.strip()).first()
    if not row or row.expires_at < datetime.utcnow() or row.code != body.code.strip():
        if row:
            row.attempts += 1
            db.commit()
        raise ApiError("AUTH_OTP_INVALID", "OTP is incorrect or expired.")
    user = db.query(User).filter(User.login_id == body.identifier.strip()).first()
    if not user:
        raise ApiError("AUTH_INVALID", "Unknown identity.")
    db.delete(row)
    tokens = _issue(user, db)
    audit(db, actor_user_id=user.id, action="login.otp", resource_type="session", ip=request.client.host if request.client else None)
    db.commit()
    return _attach_cookie(ok(tokens), tokens["accessToken"], request)


@router.get("/me")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return ok(_principal(user, db))
