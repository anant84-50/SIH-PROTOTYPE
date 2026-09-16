from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.database import engine, get_db
from app.dependencies import require_roles
from app.models.tables import AuditLog, Document, EmergencyAlert, Patient, ProcessingJob, SystemSetting, User, Visit
from app.schemas.common import UserCreateIn
from app.security.passwords import hash_password
from app.services.audit import audit
from app.utils.envelope import ApiError, ok
from app.utils.ids import iso
from app.utils.serialize import patient_out

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), user: User = Depends(require_roles("ADMIN"))):
    patients = db.query(func.count(Patient.id)).scalar() or 0
    visits = db.query(func.count(Visit.id)).scalar() or 0
    active_em = (
        db.query(func.count(EmergencyAlert.id)).filter(EmergencyAlert.status.in_(["ACTIVE", "ACKNOWLEDGED"])).scalar()
        or 0
    )
    awaiting = db.query(func.count(Visit.id)).filter(Visit.status == "AWAITING_DOCTOR").scalar() or 0
    users = db.query(func.count(User.id)).scalar() or 0
    return ok(
        {
            "patients": patients,
            "visits": visits,
            "users": users,
            "awaitingDoctor": awaiting,
            "activeEmergencies": active_em,
            "generatedAt": iso(datetime.utcnow()),
        }
    )


@router.get("/patients")
def admin_patients(db: Session = Depends(get_db), user: User = Depends(require_roles("ADMIN"))):
    rows = db.query(Patient).order_by(Patient.created_at.desc()).all()
    items = []
    for p in rows:
        vcount = db.query(func.count(Visit.id)).filter(Visit.patient_uuid == p.id).scalar() or 0
        dcount = db.query(func.count(Document.id)).filter(Document.patient_uuid == p.id).scalar() or 0
        last = db.query(Visit).filter(Visit.patient_uuid == p.id).order_by(Visit.started_at.desc()).first()
        items.append(
            {
                **patient_out(p),
                "visitCount": vcount,
                "documentCount": dcount,
                "lastVisitAt": iso(last.started_at) if last else None,
                "lastComplaint": last.chief_complaint if last else None,
            }
        )
    return ok({"items": items})


@router.get("/users")
def users(db: Session = Depends(get_db), user: User = Depends(require_roles("ADMIN"))):
    rows = db.query(User).order_by(User.created_at.desc()).all()
    return ok(
        {
            "items": [
                {
                    "id": u.id,
                    "loginId": u.login_id,
                    "role": u.role,
                    "displayName": u.display_name,
                    "email": u.email,
                    "isActive": u.is_active,
                    "createdAt": iso(u.created_at),
                }
                for u in rows
            ]
        }
    )


@router.post("/users")
def create_user(body: UserCreateIn, request: Request, db: Session = Depends(get_db), admin: User = Depends(require_roles("ADMIN"))):
    if db.query(User).filter(User.login_id == body.loginId).first():
        raise ApiError("DUPLICATE_RESOURCE", "That login ID already exists.")
    u = User(
        login_id=body.loginId,
        password_hash=hash_password(body.password),
        role=body.role,
        display_name=body.displayName,
        email=body.email,
        phone=body.phone,
        is_active=True,
    )
    db.add(u)
    audit(db, actor_user_id=admin.id, action="user.create", resource_type="user", resource_id=body.loginId, ip=request.client.host if request.client else None)
    db.commit()
    return ok({"id": u.id, "loginId": u.login_id, "role": u.role})


@router.get("/audit-logs")
def audit_logs(
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("ADMIN")),
):
    q = db.query(AuditLog).order_by(AuditLog.created_at.desc())
    total = q.count()
    rows = q.offset(offset).limit(limit).all()
    return ok(
        {
            "items": [
                {
                    "id": r.id,
                    "actorUserId": r.actor_user_id,
                    "action": r.action,
                    "resourceType": r.resource_type,
                    "resourceId": r.resource_id,
                    "ip": r.ip,
                    "meta": r.meta,
                    "createdAt": iso(r.created_at),
                }
                for r in rows
            ]
        },
        meta={"total": total, "limit": limit, "offset": offset},
    )


@router.get("/system-health")
def health(db: Session = Depends(get_db), user: User = Depends(require_roles("ADMIN"))):
    db_ok = True
    try:
        db.execute(__import__("sqlalchemy").text("SELECT 1"))
    except Exception:
        db_ok = False
    jobs = db.query(func.count(ProcessingJob.id)).scalar() or 0
    failed = db.query(func.count(ProcessingJob.id)).filter(ProcessingJob.status == "FAILED").scalar() or 0
    return ok(
        {
            "app": settings.app_name,
            "env": settings.app_env,
            "database": "up" if db_ok else "down",
            "dialect": engine.dialect.name,
            "queue": "in-process" if not settings.redis_url else "redis",
            "aiProvider": settings.ai_provider,
            "ocrProvider": settings.ocr_provider,
            "jobs": jobs,
            "failedJobs": failed,
            "timeUtc": iso(datetime.utcnow()),
        }
    )
