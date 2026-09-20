from datetime import datetime

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, resolve_patient_scope
from app.models.tables import AiSource, AyushHistory, Conflict, Consent, Conversation, Document, EmergencyAlert, Patient, User, Visit
from app.schemas.common import VisitCreateIn, VisitPatchIn
from app.services.audit import audit
from app.services.clinical import latest_ayush, latest_history, latest_summary, related_visits
from app.services.interview import intake_view
from app.utils.envelope import ApiError, ok
from app.utils.ids import iso
from app.utils.serialize import ayush_out, conflict_out, document_out, history_out, summary_out, visit_out

router = APIRouter(tags=["visits"])


def _get_visit(db: Session, visit_id: str, user: User) -> Visit:
    visit = db.get(Visit, visit_id)
    if not visit:
        raise ApiError("VISIT_NOT_FOUND", "Visit was not found.")
    resolve_patient_scope(visit.patient_uuid, user, db)
    return visit


@router.post("/visits")
def create_visit(body: VisitCreateIn, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    patient = resolve_patient_scope(body.patientId, user, db)
    if not body.consent:
        raise ApiError("CONSENT_REQUIRED", "Consent is required before starting intake.")
    visit = Visit(
        patient_uuid=patient.id,
        complaint_pathway=body.complaintPathway,
        chief_complaint=body.chiefComplaint or body.complaintPathway.replace("_", " ").title(),
        status="IN_INTAKE",
        language=body.language,
    )
    db.add(visit)
    db.flush()
    db.add(
        Consent(
            patient_uuid=patient.id,
            visit_id=visit.id,
            consent_type="INTAKE_AND_AI_ASSIST",
            granted=True,
            granted_at=datetime.utcnow(),
            version="1.0",
        )
    )
    audit(db, actor_user_id=user.id, action="visit.create", resource_type="visit", resource_id=visit.id, ip=request.client.host if request.client else None)
    db.commit()
    db.refresh(visit)
    visit.patient = patient
    return ok(visit_out(visit))


@router.get("/visits/{visit_id}")
def get_visit(visit_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    visit = _get_visit(db, visit_id, user)
    hist = latest_history(db, visit.id)
    ayush = latest_ayush(db, visit.id)
    summary = latest_summary(db, visit.id)
    # Interview (intake) view with per-question status — real answers only.
    conv = db.query(Conversation).filter(Conversation.visit_id == visit.id).first()
    intake = None
    if conv:
        intake = intake_view(conv)
    # Structured matching only (same pathway / shared meds / shared allergies).
    related = related_visits(db, visit) if user.role in ("DOCTOR", "ADMIN") else None
    em_alerts = (
        db.query(EmergencyAlert)
        .filter(EmergencyAlert.visit_id == visit.id, EmergencyAlert.status.in_(["ACTIVE", "ACKNOWLEDGED"]))
        .all()
    )
    visit_docs = (
        db.query(Document).filter(Document.visit_id == visit.id).order_by(Document.created_at.desc()).all()
    )
    patient = db.get(Patient, visit.patient_uuid)
    return ok(
        {
            **visit_out(visit),
            "history": history_out(hist) if hist else None,
            "ayush": ayush_out(ayush) if ayush else None,
            "summary": summary_out(summary) if summary else None,
            "intake": intake,
            "relatedVisits": related,
            "visitEmergencies": [
                {
                    "id": a.id,
                    "priority": a.priority,
                    "status": a.status,
                    "reason": a.reason,
                    "ruleId": a.rule_id,
                    "createdAt": iso(a.created_at),
                }
                for a in em_alerts
            ],
            "visitDocuments": [document_out(d) for d in visit_docs],
            "openConflicts": [
                conflict_out(c)
                for c in db.query(Conflict).filter(Conflict.patient_uuid == visit.patient_uuid, Conflict.status == "OPEN").all()
            ],
            "patientId": patient.patient_id if patient else None,
        }
    )


@router.patch("/visits/{visit_id}")
def patch_visit(visit_id: str, body: VisitPatchIn, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    visit = _get_visit(db, visit_id, user)
    if body.status:
        visit.status = body.status
    if body.chiefComplaint is not None:
        visit.chief_complaint = body.chiefComplaint
    if body.doctorUuid:
        visit.doctor_uuid = body.doctorUuid
    if body.ayush:
        prev = latest_ayush(db, visit.id)
        data = body.ayush
        db.add(
            AyushHistory(
                visit_id=visit.id,
                version=(prev.version + 1) if prev else 1,
                prakriti=data.get("prakriti", prev.prakriti if prev else ""),
                vikriti=data.get("vikriti", prev.vikriti if prev else ""),
                sara=data.get("sara", prev.sara if prev else ""),
                samhanana=data.get("samhanana", prev.samhanana if prev else ""),
                pramana=data.get("pramana", prev.pramana if prev else ""),
                satmya=data.get("satmya", prev.satmya if prev else ""),
                sattva=data.get("sattva", prev.sattva if prev else ""),
                ahara_shakti=data.get("aharaShakti", prev.ahara_shakti if prev else ""),
                vyayama_shakti=data.get("vyayamaShakti", prev.vyayama_shakti if prev else ""),
                vaya=data.get("vaya", prev.vaya if prev else ""),
                ahara=data.get("ahara", prev.ahara if prev else ""),
                vihara=data.get("vihara", prev.vihara if prev else ""),
                nidana=data.get("nidana", prev.nidana if prev else ""),
                samprapti=data.get("samprapti", prev.samprapti if prev else ""),
                verification_status="AI_DRAFT",
            )
        )
    if body.history:
        from app.services.clinical import write_structured_history

        write_structured_history(db, visit, body.history)
    if body.conflictId and body.conflictStatus:
        conflict = db.get(Conflict, body.conflictId)
        if not conflict:
            raise ApiError("CONFLICT_NOT_FOUND", "Conflict was not found.")
        if body.conflictStatus not in {"OPEN", "PATIENT_CONFIRMED", "DOCTOR_CONFIRMED", "DISMISSED"}:
            raise ApiError("VALIDATION_ERROR", "Invalid conflict status.")
        if user.role == "PATIENT" and body.conflictStatus not in {"PATIENT_CONFIRMED", "DISMISSED"}:
            raise ApiError("FORBIDDEN", "Patients may only confirm or dismiss their own conflicts.")
        if user.role == "DOCTOR" and body.conflictStatus not in {"DOCTOR_CONFIRMED", "DISMISSED"}:
            raise ApiError("FORBIDDEN", "Doctors may confirm or dismiss conflicts.")
        conflict.status = body.conflictStatus
    audit(db, actor_user_id=user.id, action="visit.update", resource_type="visit", resource_id=visit.id, ip=request.client.host if request.client else None)
    db.commit()
    return ok(visit_out(visit))


@router.get("/visits/{visit_id}/summary")
def visit_summary(visit_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    visit = _get_visit(db, visit_id, user)
    summary = latest_summary(db, visit.id)
    if not summary:
        return ok({"summary": None})
    sources = db.query(AiSource).filter(AiSource.summary_id == summary.id).all()
    return ok(
        summary_out(
            summary,
            [
                {
                    "field": s.field,
                    "value": s.value,
                    "sourceType": s.source_type,
                    "sourceId": s.source_id,
                    "confidence": s.confidence,
                    "verificationStatus": s.verification_status,
                }
                for s in sources
            ],
        )
    )
