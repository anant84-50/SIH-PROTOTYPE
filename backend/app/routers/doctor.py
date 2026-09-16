from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_roles
from app.models.tables import EmergencyAlert, Patient, User, Visit
from app.schemas.common import SummaryPatchIn, VerifyIn
from app.services.audit import audit
from app.services.clinical import apply_verification, latest_summary
from app.utils.envelope import ApiError, ok
from app.utils.serialize import emergency_out, patient_out, summary_out, visit_out

router = APIRouter(prefix="/doctor", tags=["doctor"])


@router.get("/patients")
def patients(db: Session = Depends(get_db), user: User = Depends(require_roles("DOCTOR", "ADMIN"))):
    rows = db.query(Patient).order_by(Patient.created_at.desc()).all()
    return ok({"items": [patient_out(p) for p in rows]})


@router.get("/queue")
def queue(db: Session = Depends(get_db), user: User = Depends(require_roles("DOCTOR", "ADMIN"))):
    rows = (
        db.query(Visit)
        .filter(Visit.status.in_(["IN_INTAKE", "AWAITING_PATIENT", "AWAITING_DOCTOR"]))
        .order_by(Visit.started_at.asc())
        .all()
    )
    return ok({"items": [visit_out(v) for v in rows]})


@router.get("/emergencies")
def emergencies(db: Session = Depends(get_db), user: User = Depends(require_roles("DOCTOR", "ADMIN"))):
    rows = db.query(EmergencyAlert).order_by(EmergencyAlert.created_at.desc()).limit(50).all()
    items = []
    for a in rows:
        p = db.get(Patient, a.patient_uuid)
        items.append({**emergency_out(a, p.patient_id if p else None), "patientName": p.full_name if p else None})
    return ok({"items": items})


@router.patch("/summary/{visit_id}")
def patch_summary(
    visit_id: str,
    body: SummaryPatchIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("DOCTOR", "ADMIN")),
):
    summary = latest_summary(db, visit_id)
    if not summary:
        raise ApiError("VISIT_NOT_FOUND", "No summary to edit.")
    if summary.verification_status == "DOCTOR_VERIFIED":
        raise ApiError("STATE_CONFLICT", "Create a new version instead of mutating a verified summary.")
    nxt_body = dict(summary.body or {})
    if body.body:
        nxt_body.update(body.body)
    from app.models.tables import AiSummary

    nxt = AiSummary(
        visit_id=summary.visit_id,
        version=summary.version + 1,
        body=nxt_body,
        narrative=body.narrative if body.narrative is not None else summary.narrative,
        confidence=summary.confidence,
        confidence_score=summary.confidence_score,
        verification_status="NEEDS_REVIEW",
    )
    db.add(nxt)
    audit(db, actor_user_id=user.id, action="summary.edit", resource_type="summary", resource_id=nxt.id, ip=request.client.host if request.client else None)
    db.commit()
    return ok(summary_out(nxt))


@router.post("/verify/{visit_id}")
def verify(
    visit_id: str,
    body: VerifyIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("DOCTOR", "ADMIN")),
):
    visit = db.get(Visit, visit_id)
    if not visit:
        raise ApiError("VISIT_NOT_FOUND", "Visit was not found.")
    summary = latest_summary(db, visit_id)
    if not summary:
        raise ApiError("VISIT_NOT_FOUND", "No summary exists.")
    if body.action not in {"DOCTOR_VERIFIED", "REJECTED", "NEEDS_REVIEW"}:
        raise ApiError("VALIDATION_ERROR", "Doctor verify action is invalid.")
    nxt = apply_verification(db, summary, body.action, visit)
    audit(
        db,
        actor_user_id=user.id,
        action="summary.verify",
        resource_type="summary",
        resource_id=nxt.id,
        ip=request.client.host if request.client else None,
        meta={"action": body.action},
    )
    db.commit()
    return ok(summary_out(nxt))
