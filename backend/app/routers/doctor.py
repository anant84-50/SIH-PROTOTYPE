from datetime import date, datetime

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_roles, resolve_patient_scope
from app.models.tables import (
    AiSummary,
    AuditLog,
    Document,
    DocumentEntity,
    Doctor,
    EmergencyAlert,
    Patient,
    TimelineEvent,
    User,
    Visit,
)
from app.schemas.common import ProfilePatchIn, SummaryPatchIn, VerifyIn
from app.services.audit import audit
from app.services.clinical import (
    apply_verification,
    latest_summary,
)
from app.utils.envelope import ApiError, ok
from app.utils.ids import iso
from app.utils.serialize import (
    document_out,
    emergency_out,
    patient_out,
    summary_out,
    visit_out,
)

router = APIRouter(prefix="/doctor", tags=["doctor"])

QUEUE_STATUSES = ["IN_INTAKE", "AWAITING_PATIENT", "AWAITING_DOCTOR"]
ACTIVE_EM_STATUSES = ["ACTIVE", "ACKNOWLEDGED"]


def _doctor_for(user: User, db: Session) -> Doctor | None:
    return db.query(Doctor).filter(Doctor.user_id == user.id).first()


def _latest_summary_map(db: Session, visit_ids: list[str]) -> dict[str, AiSummary]:
    if not visit_ids:
        return {}
    rows = db.query(AiSummary).filter(AiSummary.visit_id.in_(visit_ids)).all()
    latest: dict[str, AiSummary] = {}
    for s in rows:
        cur = latest.get(s.visit_id)
        if cur is None or s.version > cur.version:
            latest[s.visit_id] = s
    return latest


def _active_em_visits(db: Session) -> set[str]:
    rows = db.query(EmergencyAlert.visit_id).filter(
        EmergencyAlert.status.in_(ACTIVE_EM_STATUSES), EmergencyAlert.visit_id.isnot(None)
    ).all()
    return {r[0] for r in rows if r[0]}


@router.get("/patients")
def patients(
    q: str | None = Query(None, max_length=80),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("DOCTOR", "ADMIN")),
):
    query = db.query(Patient)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter((Patient.full_name.ilike(like)) | (Patient.patient_id.ilike(like)))
    rows = query.order_by(Patient.created_at.desc()).all()
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
                "lastVisitId": last.id if last else None,
                "lastComplaint": last.chief_complaint if last else None,
            }
        )
    return ok({"items": items})


@router.get("/queue")
def queue(
    status: str | None = Query(None),
    q: str | None = Query(None, max_length=80),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("DOCTOR", "ADMIN")),
):
    query = db.query(Visit)
    em_visits = _active_em_visits(db)
    if status:
        s = status.strip().upper()
        if s == "ALL":
            pass
        elif s == "IN_INTAKE":
            query = query.filter(Visit.status.in_(["IN_INTAKE", "AWAITING_PATIENT"]))
        elif s == "AWAITING_DOCTOR":
            query = query.filter(Visit.status == "AWAITING_DOCTOR")
        elif s == "VERIFIED":
            query = query.filter(Visit.status == "VERIFIED")
        elif s == "EMERGENCY":
            if not em_visits:
                return ok({"items": []})
            query = query.filter(Visit.id.in_(list(em_visits)))
        else:
            raise ApiError("VALIDATION_ERROR", "Unknown queue filter.")
    else:
        # Default behaviour preserved: open work only.
        query = query.filter(Visit.status.in_(QUEUE_STATUSES))
    if q:
        like = f"%{q.strip()}%"
        query = query.join(Patient, Visit.patient_uuid == Patient.id).filter(
            (Patient.full_name.ilike(like)) | (Patient.patient_id.ilike(like)) | (Visit.id.ilike(like))
        )
    rows = query.order_by(Visit.started_at.asc()).all()
    summaries = _latest_summary_map(db, [v.id for v in rows])
    items = []
    for v in rows:
        p = db.get(Patient, v.patient_uuid)
        s = summaries.get(v.id)
        last_updated = iso(v.started_at)
        if s and s.created_at and (last_updated is None or iso(s.created_at) > last_updated):
            last_updated = iso(s.created_at)
        items.append(
            {
                **visit_out(v),
                "lastUpdated": last_updated,
                "emergency": v.id in em_visits,
                "summaryStatus": s.verification_status if s else None,
            }
        )
    return ok({"items": items})


@router.get("/emergencies")
def emergencies(db: Session = Depends(get_db), user: User = Depends(require_roles("DOCTOR", "ADMIN"))):
    rows = db.query(EmergencyAlert).order_by(EmergencyAlert.created_at.desc()).limit(50).all()
    items = []
    for a in rows:
        p = db.get(Patient, a.patient_uuid)
        items.append({**emergency_out(a, p.patient_id if p else None), "patientName": p.full_name if p else None})
    return ok({"items": items})


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), user: User = Depends(require_roles("DOCTOR", "ADMIN"))):
    visits = db.query(Visit).all()
    summaries = _latest_summary_map(db, [v.id for v in visits])
    pending, in_intake, verified_today = [], [], []
    today = date.today()
    for v in visits:
        s = summaries.get(v.id)
        if v.status in ("AWAITING_DOCTOR",) or (s and s.verification_status == "NEEDS_REVIEW"):
            pending.append(v)
        if v.status in ("IN_INTAKE", "AWAITING_PATIENT"):
            in_intake.append(v)
        if s and s.verification_status == "DOCTOR_VERIFIED" and s.created_at.date() == today:
            verified_today.append(v)
    active_em = (
        db.query(EmergencyAlert).filter(EmergencyAlert.status.in_(ACTIVE_EM_STATUSES)).order_by(EmergencyAlert.created_at.desc()).all()
    )

    def preview(items_visits: list[Visit], limit: int = 6):
        out = []
        for v in sorted(items_visits, key=lambda x: x.started_at)[:limit]:
            p = db.get(Patient, v.patient_uuid)
            s = summaries.get(v.id)
            out.append(
                {
                    **visit_out(v),
                    "summaryStatus": s.verification_status if s else None,
                }
            )
        return out

    em_items = []
    for a in active_em[:5]:
        p = db.get(Patient, a.patient_uuid)
        em_items.append({**emergency_out(a, p.patient_id if p else None), "patientName": p.full_name if p else None})
    d = _doctor_for(user, db)
    return ok(
        {
            "doctor": {
                "name": user.display_name,
                "loginId": user.login_id,
                "department": d.department if d else None,
                "doctorId": d.doctor_id if d else user.login_id,
            },
            "pendingReviews": len(pending),
            "inIntake": len(in_intake),
            "activeEmergencies": len(active_em),
            "verifiedToday": len(verified_today),
            "queuePreview": preview(pending if pending else in_intake),
            "emergencyPreview": em_items,
        }
    )


@router.get("/summaries")
def summaries(
    status: str | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("DOCTOR", "ADMIN")),
):
    rows = db.query(AiSummary).all()
    latest = _latest_summary_map(db, [s.visit_id for s in rows])
    items = []
    for visit_id, s in latest.items():
        if status and s.verification_status != status.strip().upper():
            continue
        v = db.get(Visit, visit_id)
        if not v:
            continue
        p = db.get(Patient, v.patient_uuid)
        items.append(
            {
                **summary_out(s),
                "visitId": v.id,
                "patientId": p.patient_id if p else None,
                "patientName": p.full_name if p else None,
                "chiefComplaint": v.chief_complaint,
                "pathway": v.complaint_pathway,
                "visitStatus": v.status,
            }
        )
    items.sort(key=lambda x: x.get("createdAt") or "", reverse=True)
    return ok({"items": items})


@router.get("/documents")
def documents(
    q: str | None = Query(None, max_length=80),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("DOCTOR", "ADMIN")),
):
    query = db.query(Document).join(Patient, Document.patient_uuid == Patient.id).order_by(Document.created_at.desc())
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            (Patient.full_name.ilike(like)) | (Patient.patient_id.ilike(like)) | (Document.original_filename.ilike(like))
        )
    rows = query.all()
    items = []
    for d in rows:
        p = db.get(Patient, d.patient_uuid)
        ents = db.query(DocumentEntity).filter(DocumentEntity.document_id == d.id).all()
        items.append(
            {
                **document_out(d),
                "patientId": p.patient_id if p else None,
                "patientName": p.full_name if p else None,
                "entityCount": len(ents),
                "needsReview": any(e.verification_status == "NEEDS_REVIEW" for e in ents),
            }
        )
    return ok({"items": items})


@router.get("/activity")
def activity(
    limit: int = Query(40, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("DOCTOR", "ADMIN")),
):
    items: list[dict] = []
    for t in db.query(TimelineEvent).order_by(TimelineEvent.created_at.desc()).limit(24).all():
        p = db.get(Patient, t.patient_uuid)
        items.append(
            {
                "type": "TIMELINE",
                "sourceType": t.source_type,
                "label": t.title,
                "detail": t.detail,
                "patientId": p.patient_id if p else None,
                "patientName": p.full_name if p else None,
                "visitId": t.visit_id,
                "at": iso(t.created_at),
            }
        )
    for s in (
        db.query(AiSummary)
        .filter(AiSummary.verification_status.in_(["PATIENT_CONFIRMED", "DOCTOR_VERIFIED", "REJECTED", "NEEDS_REVIEW"]))
        .order_by(AiSummary.created_at.desc())
        .limit(12)
        .all()
    ):
        v = db.get(Visit, s.visit_id)
        p = db.get(Patient, v.patient_uuid) if v else None
        items.append(
            {
                "type": "SUMMARY",
                "sourceType": s.verification_status,
                "label": {
                    "PATIENT_CONFIRMED": "Patient confirmed the draft",
                    "DOCTOR_VERIFIED": "Doctor verified the case",
                    "REJECTED": "Draft rejected",
                    "NEEDS_REVIEW": "Summary marked for review",
                }[s.verification_status],
                "detail": f"v{s.version} · {s.confidence}",
                "patientId": p.patient_id if p else None,
                "patientName": p.full_name if p else None,
                "visitId": s.visit_id,
                "at": iso(s.created_at),
            }
        )
    for a in db.query(EmergencyAlert).order_by(EmergencyAlert.created_at.desc()).limit(12).all():
        p = db.get(Patient, a.patient_uuid)
        items.append(
            {
                "type": "EMERGENCY",
                "sourceType": a.status,
                "label": f"Emergency · {a.status}",
                "detail": a.reason,
                "patientId": p.patient_id if p else None,
                "patientName": p.full_name if p else None,
                "visitId": a.visit_id,
                "at": iso(a.created_at),
            }
        )
    items.sort(key=lambda x: x.get("at") or "", reverse=True)
    return ok({"items": items[:limit]})


@router.get("/profile")
def profile(db: Session = Depends(get_db), user: User = Depends(require_roles("DOCTOR"))):
    d = _doctor_for(user, db)
    return ok(
        {
            "id": user.id,
            "loginId": user.login_id,
            "role": user.role,
            "displayName": user.display_name,
            "email": user.email,
            "phone": user.phone,
            "createdAt": iso(user.created_at),
            "doctorId": d.doctor_id if d else None,
            "fullName": d.full_name if d else None,
            "qualification": d.qualification if d else None,
            "department": d.department if d else None,
            "registrationNo": d.registration_no if d else None,
        }
    )


@router.patch("/profile")
def patch_profile(
    body: ProfilePatchIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("DOCTOR")),
):
    if body.displayName is not None and body.displayName.strip():
        user.display_name = body.displayName.strip()[:160]
    if body.email is not None:
        user.email = body.email.strip() or None
    if body.phone is not None:
        user.phone = body.phone.strip() or None
    d = _doctor_for(user, db)
    if d:
        if body.displayName is not None and body.displayName.strip():
            d.full_name = body.displayName.strip()[:160]
        if body.department is not None and body.department.strip():
            d.department = body.department.strip()[:120]
        if body.qualification is not None and body.qualification.strip():
            d.qualification = body.qualification.strip()[:160]
    user.updated_at = datetime.utcnow()
    audit(db, actor_user_id=user.id, action="doctor.profile.update", resource_type="user", resource_id=user.login_id, ip=request.client.host if request.client else None)
    db.commit()
    return profile(db=db, user=user)


@router.post("/visits/{visit_id}/open")
def open_visit(
    visit_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("DOCTOR", "ADMIN")),
):
    visit = db.get(Visit, visit_id)
    if not visit:
        raise ApiError("VISIT_NOT_FOUND", "Visit was not found.")
    patient = resolve_patient_scope(visit.patient_uuid, user, db)
    audit(db, actor_user_id=user.id, action="visit.open", resource_type="visit", resource_id=visit.id, ip=request.client.host if request.client else None)
    last = (
        db.query(TimelineEvent)
        .filter(TimelineEvent.visit_id == visit.id, TimelineEvent.source_type == "DOCTOR")
        .order_by(TimelineEvent.created_at.desc())
        .first()
    )
    if not (last and last.title == "Doctor opened case"):
        db.add(
            TimelineEvent(
                patient_uuid=visit.patient_uuid,
                occurred_on=date.today(),
                title="Doctor opened case",
                detail=user.display_name,
                source_type="DOCTOR",
                source_id=user.id,
                visit_id=visit.id,
            )
        )
    db.commit()
    visit.patient = patient
    return ok(visit_out(visit))


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
    db.flush()  # assign nxt.id before the audit row is written
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
    doc = _doctor_for(user, db)
    nxt = apply_verification(
        db,
        summary,
        body.action,
        visit,
        actor_name=user.display_name,
        actor_id=doc.doctor_id if doc else user.login_id,
        actor_user_id=user.id,
    )
    db.flush()  # assign nxt.id before the audit row is written
    audit(
        db,
        actor_user_id=user.id,
        action="summary.verify",
        resource_type="summary",
        resource_id=nxt.id,
        ip=request.client.host if request.client else None,
        meta={"action": body.action, "doctorId": doc.doctor_id if doc else user.login_id, "visitId": visit.id, "summaryId": nxt.id},
    )
    db.commit()
    return ok(summary_out(nxt))
