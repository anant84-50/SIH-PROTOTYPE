from datetime import date

from sqlalchemy.orm import Session

from app.models.enums import SourceType, VerificationStatus, VisitStatus
from app.models.tables import (
    AiSource,
    AiSummary,
    Allergy,
    AyushHistory,
    ClinicalHistory,
    Conflict,
    Conversation,
    Medication,
    Patient,
    TimelineEvent,
    Visit,
)
from app.services.interview import missing_fields, structure_from_session
from app.services.providers import get_ai
from app.services.safety import scan_answers
from app.utils.serialize import ayush_out, history_out


def latest_history(db: Session, visit_id: str) -> ClinicalHistory | None:
    return (
        db.query(ClinicalHistory)
        .filter(ClinicalHistory.visit_id == visit_id)
        .order_by(ClinicalHistory.version.desc())
        .first()
    )


def latest_ayush(db: Session, visit_id: str) -> AyushHistory | None:
    return (
        db.query(AyushHistory)
        .filter(AyushHistory.visit_id == visit_id)
        .order_by(AyushHistory.version.desc())
        .first()
    )


def latest_summary(db: Session, visit_id: str) -> AiSummary | None:
    return (
        db.query(AiSummary)
        .filter(AiSummary.visit_id == visit_id)
        .order_by(AiSummary.version.desc())
        .first()
    )


def write_structured_history(db: Session, visit: Visit, structured: dict) -> ClinicalHistory:
    prev = latest_history(db, visit.id)
    version = (prev.version + 1) if prev else 1
    row = ClinicalHistory(
        visit_id=visit.id,
        version=version,
        chief_complaint=structured.get("chiefComplaint") or visit.chief_complaint,
        hpi=structured.get("hpi") or "",
        past_medical_history=structured.get("pastMedicalHistory") or "",
        past_surgical_history=structured.get("pastSurgicalHistory") or "",
        medications=structured.get("medications") or [],
        allergies=structured.get("allergies") or [],
        family_history=structured.get("familyHistory") or "",
        personal_history=structured.get("personalHistory") or "",
        review_of_systems=structured.get("reviewOfSystems") or {},
        investigations=structured.get("investigations") or [],
        patient_concerns=structured.get("patientConcerns") or "",
        lifestyle=structured.get("lifestyle") or "",
        verification_status=VerificationStatus.AI_DRAFT.value,
    )
    db.add(row)
    visit.chief_complaint = row.chief_complaint
    # Longitudinal facts
    for name in row.medications:
        if not name:
            continue
        exists = (
            db.query(Medication)
            .filter(Medication.patient_uuid == visit.patient_uuid, Medication.name == name)
            .first()
        )
        if not exists:
            db.add(
                Medication(
                    patient_uuid=visit.patient_uuid,
                    name=name,
                    source_type=SourceType.PATIENT_INPUT.value,
                    verification_status=VerificationStatus.AI_DRAFT.value,
                )
            )
        # Conflict: previous Metformin vs "none"
        if str(name).lower() in {"none", "no", "nil"}:
            prior = (
                db.query(Medication)
                .filter(
                    Medication.patient_uuid == visit.patient_uuid,
                    Medication.is_current.is_(True),
                    Medication.name.notin_(["none", "None", "no", "nil"]),
                )
                .first()
            )
            if prior:
                db.add(
                    Conflict(
                        patient_uuid=visit.patient_uuid,
                        visit_id=visit.id,
                        field="medications",
                        left_value=f"{prior.name} {prior.dosage}".strip(),
                        right_value="No current medication (patient)",
                        left_source=prior.source_type,
                        right_source=SourceType.PATIENT_INPUT.value,
                        status="OPEN",
                    )
                )
    for substance in row.allergies:
        if not substance:
            continue
        exists = (
            db.query(Allergy)
            .filter(Allergy.patient_uuid == visit.patient_uuid, Allergy.substance == substance)
            .first()
        )
        if not exists:
            db.add(
                Allergy(
                    patient_uuid=visit.patient_uuid,
                    substance=substance,
                    source_type=SourceType.PATIENT_INPUT.value,
                    verification_status=VerificationStatus.AI_DRAFT.value,
                )
            )
    return row


def generate_summary(db: Session, visit: Visit) -> AiSummary:
    conv = db.query(Conversation).filter(Conversation.visit_id == visit.id).first()
    hist = latest_history(db, visit.id)
    if not hist and conv:
        hist = write_structured_history(db, visit, structure_from_session(conv))
    ayush = latest_ayush(db, visit.id)
    patient = db.get(Patient, visit.patient_uuid)
    context = {
        "visitId": visit.id,
        "patientId": patient.patient_id if patient else None,
        "patientName": patient.full_name if patient else None,
        "complaintPathway": visit.complaint_pathway,
        "structuredHistory": history_out(hist) if hist else {},
        "ayush": ayush_out(ayush) if ayush else {},
        "answers": (conv.state or {}).get("answers") if conv else {},
        "redFlags": scan_answers((conv.state or {}).get("answers") if conv else {}),
        "missingInformation": missing_fields(conv) if conv else [],
    }
    generated = get_ai().generate_summary(context)
    prev = latest_summary(db, visit.id)
    version = (prev.version + 1) if prev else 1
    body = {
        "schemaVersion": "1.0.0",
        "visitId": visit.id,
        "patientId": patient.patient_id if patient else None,
        "complaintPathway": visit.complaint_pathway,
        "verificationStatus": VerificationStatus.AI_DRAFT.value,
        "confidence": generated.get("confidence"),
        "confidenceScore": generated.get("confidenceScore"),
        "chiefComplaint": {
            "value": (hist.chief_complaint if hist else visit.chief_complaint),
            "sourceType": SourceType.PATIENT_INPUT.value,
            "sourceId": conv.id if conv else None,
            "confidence": generated.get("confidenceScore") or 0.6,
            "verificationStatus": VerificationStatus.AI_DRAFT.value,
        },
        "hpi": hist.hpi if hist else "",
        "structuredHistory": history_out(hist) if hist else {},
        "ayush": ayush_out(ayush) if ayush else {},
        "redFlags": context["redFlags"],
        "missingInformation": context["missingInformation"],
        "disclaimer": generated.get("disclaimer"),
    }
    row = AiSummary(
        visit_id=visit.id,
        version=version,
        body=body,
        narrative=generated.get("narrative") or "",
        confidence=generated.get("confidence") or "MEDIUM",
        confidence_score=float(generated.get("confidenceScore") or 0.6),
        verification_status=VerificationStatus.AI_DRAFT.value,
    )
    db.add(row)
    db.flush()
    db.add(
        AiSource(
            summary_id=row.id,
            field="chiefComplaint",
            value=body["chiefComplaint"]["value"],
            source_type=SourceType.PATIENT_INPUT.value,
            source_id=conv.id if conv else None,
            confidence=row.confidence_score,
            verification_status=VerificationStatus.AI_DRAFT.value,
        )
    )
    db.add(
        TimelineEvent(
            patient_uuid=visit.patient_uuid,
            occurred_on=date.today(),
            title="AI clinical summary prepared",
            detail=f"Version {version} · {row.confidence}",
            source_type=SourceType.AI.value,
            source_id=row.id,
            visit_id=visit.id,
        )
    )
    visit.status = VisitStatus.AWAITING_PATIENT.value
    return row


def apply_verification(db: Session, summary: AiSummary, status: str, visit: Visit) -> AiSummary:
    # Never mutate in place — new version
    nxt = AiSummary(
        visit_id=summary.visit_id,
        version=summary.version + 1,
        body={**(summary.body or {}), "verificationStatus": status},
        narrative=summary.narrative,
        confidence=summary.confidence,
        confidence_score=summary.confidence_score,
        verification_status=status,
    )
    db.add(nxt)
    if status == VerificationStatus.PATIENT_CONFIRMED.value:
        visit.status = VisitStatus.AWAITING_DOCTOR.value
    elif status == VerificationStatus.DOCTOR_VERIFIED.value:
        visit.status = VisitStatus.VERIFIED.value
        hist = latest_history(db, visit.id)
        if hist:
            verified = ClinicalHistory(
                visit_id=hist.visit_id,
                version=hist.version + 1,
                chief_complaint=hist.chief_complaint,
                hpi=hist.hpi,
                past_medical_history=hist.past_medical_history,
                past_surgical_history=hist.past_surgical_history,
                medications=hist.medications,
                allergies=hist.allergies,
                family_history=hist.family_history,
                personal_history=hist.personal_history,
                review_of_systems=hist.review_of_systems,
                investigations=hist.investigations,
                patient_concerns=hist.patient_concerns,
                lifestyle=hist.lifestyle,
                verification_status=VerificationStatus.DOCTOR_VERIFIED.value,
            )
            db.add(verified)
    elif status == VerificationStatus.REJECTED.value:
        visit.status = VisitStatus.IN_INTAKE.value
    return nxt
