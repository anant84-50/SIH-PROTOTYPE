from datetime import date, datetime

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, get_current_user_optional, resolve_patient_scope
from app.models.tables import (
    Conflict,
    Consent,
    Document,
    Patient,
    TimelineEvent,
    User,
    Visit,
)
from app.schemas.common import PatientCreateIn, PatientPatchIn
from app.security.passwords import hash_password
from app.services.audit import audit
from app.services.providers import get_abdm, get_fhir
from app.utils.envelope import ApiError, ok
from app.utils.ids import next_patient_id
from app.utils.serialize import conflict_out, document_out, patient_out, timeline_out, visit_out

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
    return ok({"items": [visit_out(v) for v in rows]})
