from datetime import date, datetime

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, get_current_user_optional, resolve_patient_scope
from app.models.tables import (
    AiSummary,
    Allergy,
    Conflict,
    Consent,
    Document,
    EmergencyAlert,
    Medication,
    Patient,
    TimelineEvent,
    User,
    Visit,
)
from app.schemas.common import PatientCreateIn, PatientPatchIn
from app.security.passwords import hash_password
from app.services.audit import audit
from app.services.clinical import latest_history, processing_state
from app.services.providers import get_abdm, get_fhir
from app.utils.envelope import ApiError, ok
from app.utils.ids import iso, next_patient_id
from app.utils.serialize import allergy_out, conflict_out, document_out, emergency_out, medication_out, patient_out, timeline_out, visit_out

router = APIRouter(prefix="/patients", tags=["patients"])


@router.post("")
def create_patient(
    body: PatientCreateIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    dob = None
    if body.dateOfBirth:
        try:
            dob = date.fromisoformat(body.dateOfBirth)
        except ValueError as exc:
            raise ApiError("VALIDATION_ERROR", "dateOfBirth must be YYYY-MM-DD") from exc
    pid = next_patient_id(db)
    account = User(
        login_id=pid,
        password_hash=hash_password(body.password),
        role="PATIENT",
        display_name=body.fullName,
        phone=body.phone,
        is_active=True,
    )
    db.add(account)
    db.flush()
    patient = Patient(
        user_id=account.id,
        patient_id=pid,
        full_name=body.fullName,
        date_of_birth=dob,
        sex=body.sex,
        language=body.language,
        phone=body.phone,
        address=body.address,
        blood_group=body.bloodGroup,
    )
    db.add(patient)
    db.flush()
    db.add(
        TimelineEvent(
            patient_uuid=patient.id,
            occurred_on=date.today(),
            title="Registered at Preclinic IQ AI",
            detail="Identity created. Clinical facts start empty.",
            source_type="PATIENT_INPUT",
            source_id=patient.id,
        )
    )
    audit(
        db,
        actor_user_id=(user.id if user else account.id),
        action="patient.create",
        resource_type="patient",
        resource_id=patient.patient_id,
        ip=request.client.host if request.client else None,
    )
    db.commit()
    db.refresh(patient)
    return ok({**patient_out(patient), "fhir": get_fhir().export_patient(patient_out(patient)), "abdm": get_abdm().health_id_status(patient.patient_id)})


@router.get("/{patient_id}")
def get_patient(patient_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    patient = resolve_patient_scope(patient_id, user, db)
    audit(db, actor_user_id=user.id, action="patient.access", resource_type="patient", resource_id=patient.patient_id)
    db.commit()
    consents = db.query(Consent).filter(Consent.patient_uuid == patient.id).all()
    conflicts = db.query(Conflict).filter(Conflict.patient_uuid == patient.id, Conflict.status == "OPEN").all()
    return ok(
        {
            **patient_out(patient),
            "consents": [{"type": c.consent_type, "granted": c.granted, "version": c.version} for c in consents],
            "openConflicts": [conflict_out(c) for c in conflicts],
            "fhir": get_fhir().export_patient(patient_out(patient)),
            "abdm": get_abdm().health_id_status(patient.patient_id),
        }
    )


@router.patch("/{patient_id}")
def patch_patient(
    patient_id: str,
    body: PatientPatchIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    patient = resolve_patient_scope(patient_id, user, db)
    data = body.model_dump(exclude_unset=True)
    if "fullName" in data and data["fullName"]:
        patient.full_name = data["fullName"]
    if "dateOfBirth" in data and data["dateOfBirth"]:
        patient.date_of_birth = date.fromisoformat(data["dateOfBirth"])
    if "sex" in data:
        patient.sex = data["sex"]
    if "language" in data and data["language"]:
        patient.language = data["language"]
    if "phone" in data:
        patient.phone = data["phone"]
    if "address" in data:
        patient.address = data["address"]
    if "bloodGroup" in data:
        patient.blood_group = data["bloodGroup"]
    patient.updated_at = datetime.utcnow()
    audit(db, actor_user_id=user.id, action="patient.update", resource_type="patient", resource_id=patient.patient_id, ip=request.client.host if request.client else None)
    db.commit()
    return ok(patient_out(patient))


@router.get("/{patient_id}/timeline")
def timeline(patient_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    patient = resolve_patient_scope(patient_id, user, db)
    rows = (
        db.query(TimelineEvent)
        .filter(TimelineEvent.patient_uuid == patient.id)
        .order_by(TimelineEvent.occurred_on.desc(), TimelineEvent.created_at.desc())
        .all()
    )
    audit(db, actor_user_id=user.id, action="timeline.access", resource_type="patient", resource_id=patient.patient_id)
    db.commit()
    return ok({"patientId": patient.patient_id, "events": [timeline_out(r) for r in rows]})


@router.get("/{patient_id}/documents")
def documents(patient_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    patient = resolve_patient_scope(patient_id, user, db)
    rows = db.query(Document).filter(Document.patient_uuid == patient.id).order_by(Document.created_at.desc()).all()
    audit(db, actor_user_id=user.id, action="document.list", resource_type="patient", resource_id=patient.patient_id)
    db.commit()
    return ok({"items": [document_out(d) for d in rows]})


@router.get("/{patient_id}/visits")
def visits(patient_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    patient = resolve_patient_scope(patient_id, user, db)
    rows = db.query(Visit).filter(Visit.patient_uuid == patient.id).order_by(Visit.started_at.desc()).all()
    summaries = {}
    for s in db.query(AiSummary).filter(AiSummary.visit_id.in_([v.id for v in rows])).all():
        cur = summaries.get(s.visit_id)
        if cur is None or s.version > cur.version:
            summaries[s.visit_id] = s
    items = []
    for v in rows:
        s = summaries.get(v.id)
        dcount = db.query(func.count(Document.id)).filter(Document.visit_id == v.id).scalar() or 0
        items.append(
            {
                **visit_out(v),
                "summaryStatus": s.verification_status if s else None,
                "summaryVersion": s.version if s else None,
                "documentCount": dcount,
            }
        )
    return ok({"items": items})


@router.get("/{patient_id}/visits/related")
def related_visits_endpoint(
    patient_id: str,
    pathway: str | None = Query(None),
    excludeVisitId: str | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Previous visits relevant to a new visit (structured matching only)."""
    patient = resolve_patient_scope(patient_id, user, db)
    rows = (
        db.query(Visit)
        .filter(Visit.patient_uuid == patient.id)
        .order_by(Visit.started_at.desc())
        .all()
    )
    if excludeVisitId:
        rows = [v for v in rows if v.id != excludeVisitId]
    out = []
    for v in rows:
        reasons = []
        if pathway and v.complaint_pathway == pathway:
            reasons.append(f"Same concern pathway: {v.complaint_pathway.replace('_', ' ').title()}")
        hist = latest_history(db, v.id)
        if hist:
            out.append(
                {
                    "visitId": v.id,
                    "startedAt": iso(v.started_at),
                    "chiefComplaint": v.chief_complaint,
                    "pathway": v.complaint_pathway,
                    "status": v.status,
                    "reasons": reasons,
                    "hasHistory": True,
                    "historyVerificationStatus": hist.verification_status,
                }
            )
    # Prefer visits with a shared pathway; keep others with history for context.
    with_reason = [r for r in out if r["reasons"]]
    without = [r for r in out if not r["reasons"]]
    return ok({"items": (with_reason + without)[:5]})


@router.get("/{patient_id}/medications")
def medications(patient_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    patient = resolve_patient_scope(patient_id, user, db)
    rows = db.query(Medication).filter(Medication.patient_uuid == patient.id).all()
    return ok({"items": [medication_out(m) for m in rows]})


@router.get("/{patient_id}/allergies")
def allergies(patient_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    patient = resolve_patient_scope(patient_id, user, db)
    rows = db.query(Allergy).filter(Allergy.patient_uuid == patient.id).all()
    return ok({"items": [allergy_out(a) for a in rows]})


@router.get("/{patient_id}/processing")
def processing(
    patient_id: str,
    visitId: str | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    patient = resolve_patient_scope(patient_id, user, db)
    if visitId:
        visit = db.get(Visit, visitId)
        if not visit or visit.patient_uuid != patient.id:
            raise ApiError("VISIT_NOT_FOUND", "Visit was not found.")
    else:
        visit = db.query(Visit).filter(Visit.patient_uuid == patient.id).order_by(Visit.started_at.desc()).first()
        if not visit:
            return ok({"visitId": None, "visitStatus": None, "summaryStatus": None, "steps": []})
    return ok(processing_state(db, visit))


@router.get("/{patient_id}/notifications")
def notifications(patient_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    patient = resolve_patient_scope(patient_id, user, db)
    items: list[dict] = []
    for t in db.query(TimelineEvent).filter(TimelineEvent.patient_uuid == patient.id).order_by(TimelineEvent.created_at.desc()).limit(25).all():
        items.append(
            {
                "type": "TIMELINE",
                "sourceType": t.source_type,
                "title": t.title,
                "detail": t.detail,
                "visitId": t.visit_id,
                "at": iso(t.created_at),
            }
        )
    visit_ids = [v.id for v in db.query(Visit).filter(Visit.patient_uuid == patient.id).all()]
    if visit_ids:
        for s in (
            db.query(AiSummary)
            .filter(AiSummary.visit_id.in_(visit_ids), AiSummary.verification_status.in_(["PATIENT_CONFIRMED", "DOCTOR_VERIFIED", "REJECTED"]))
            .order_by(AiSummary.created_at.desc())
            .limit(10)
            .all()
        ):
            items.append(
                {
                    "type": "SUMMARY",
                    "sourceType": s.verification_status,
                    "title": {
                        "PATIENT_CONFIRMED": "You confirmed the draft summary",
                        "DOCTOR_VERIFIED": "Doctor has reviewed and verified your case",
                        "REJECTED": "Draft rejected — you can start a new intake",
                    }[s.verification_status],
                    "detail": f"Summary v{s.version}",
                    "visitId": s.visit_id,
                    "at": iso(s.created_at),
                }
            )
    for a in db.query(EmergencyAlert).filter(EmergencyAlert.patient_uuid == patient.id).order_by(EmergencyAlert.created_at.desc()).limit(10).all():
        items.append(
            {
                "type": "EMERGENCY",
                "sourceType": a.status,
                "title": "Emergency request" if a.rule_id == "MANUAL" else "Safety alert triggered",
                "detail": f"{a.reason} · {a.status}",
                "visitId": a.visit_id,
                "at": iso(a.created_at),
            }
        )
    items.sort(key=lambda x: x.get("at") or "", reverse=True)
    return ok({"items": items[:35]})


@router.get("/{patient_id}/emergencies")
def patient_emergencies(patient_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    patient = resolve_patient_scope(patient_id, user, db)
    rows = db.query(EmergencyAlert).filter(EmergencyAlert.patient_uuid == patient.id).order_by(EmergencyAlert.created_at.desc()).limit(20).all()
    return ok({"items": [emergency_out(a, patient.patient_id) for a in rows]})
