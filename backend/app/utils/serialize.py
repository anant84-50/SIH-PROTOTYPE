from datetime import date, datetime

from app.models.tables import (
    AiSummary,
    AyushHistory,
    ClinicalHistory,
    Conflict,
    Document,
    DocumentEntity,
    EmergencyAlert,
    Patient,
    TimelineEvent,
    Visit,
)
from app.utils.ids import iso


def patient_out(p: Patient) -> dict:
    return {
        "id": p.id,
        "patientId": p.patient_id,
        "fullName": p.full_name,
        "dateOfBirth": p.date_of_birth.isoformat() if p.date_of_birth else None,
        "sex": p.sex,
        "language": p.language,
        "phone": p.phone,
        "address": p.address,
        "bloodGroup": p.blood_group,
        "createdAt": iso(p.created_at),
    }


def visit_out(v: Visit) -> dict:
    return {
        "id": v.id,
        "visitId": v.id,
        "patientUuid": v.patient_uuid,
        "patientId": v.patient.patient_id if v.patient else None,
        "patientName": v.patient.full_name if v.patient else None,
        "doctorUuid": v.doctor_uuid,
        "complaintPathway": v.complaint_pathway,
        "chiefComplaint": v.chief_complaint,
        "status": v.status,
        "language": v.language,
        "startedAt": iso(v.started_at),
        "closedAt": iso(v.closed_at),
    }


def history_out(h: ClinicalHistory) -> dict:
    return {
        "id": h.id,
        "visitId": h.visit_id,
        "version": h.version,
        "chiefComplaint": h.chief_complaint,
        "hpi": h.hpi,
        "pastMedicalHistory": h.past_medical_history,
        "pastSurgicalHistory": h.past_surgical_history,
        "medications": h.medications or [],
        "allergies": h.allergies or [],
        "familyHistory": h.family_history,
        "personalHistory": h.personal_history,
        "reviewOfSystems": h.review_of_systems or {},
        "investigations": h.investigations or [],
        "patientConcerns": h.patient_concerns,
        "lifestyle": h.lifestyle,
        "verificationStatus": h.verification_status,
        "createdAt": iso(h.created_at),
    }


def ayush_out(a: AyushHistory) -> dict:
    return {
        "id": a.id,
        "visitId": a.visit_id,
        "version": a.version,
        "prakriti": a.prakriti,
        "vikriti": a.vikriti,
        "sara": a.sara,
        "samhanana": a.samhanana,
        "pramana": a.pramana,
        "satmya": a.satmya,
        "sattva": a.sattva,
        "aharaShakti": a.ahara_shakti,
        "vyayamaShakti": a.vyayama_shakti,
        "vaya": a.vaya,
        "ahara": a.ahara,
        "vihara": a.vihara,
        "nidana": a.nidana,
        "samprapti": a.samprapti,
        "verificationStatus": a.verification_status,
    }


def document_out(d: Document) -> dict:
    return {
        "id": d.id,
        "patientUuid": d.patient_uuid,
        "visitId": d.visit_id,
        "documentType": d.document_type,
        "originalFilename": d.original_filename,
        "mimeType": d.mime_type,
        "sizeBytes": d.size_bytes,
        "processingStatus": d.processing_status,
        "handwritten": d.handwritten,
        "createdAt": iso(d.created_at),
    }


def entity_out(e: DocumentEntity) -> dict:
    return {
        "id": e.id,
        "documentId": e.document_id,
        "entityType": e.entity_type,
        "value": e.value,
        "unit": e.unit,
        "referenceRange": e.reference_range,
        "confidence": e.confidence,
        "verificationStatus": e.verification_status,
    }


def timeline_out(t: TimelineEvent) -> dict:
    return {
        "id": t.id,
        "occurredOn": t.occurred_on.isoformat() if isinstance(t.occurred_on, date) else str(t.occurred_on),
        "title": t.title,
        "detail": t.detail,
        "sourceType": t.source_type,
        "sourceId": t.source_id,
        "visitId": t.visit_id,
        "documentId": t.document_id,
        "createdAt": iso(t.created_at),
    }


def emergency_out(e: EmergencyAlert, patient_id: str | None = None) -> dict:
    return {
        "emergencyId": e.id,
        "id": e.id,
        "patientUuid": e.patient_uuid,
        "patientId": patient_id,
        "visitId": e.visit_id,
        "severity": e.priority,
        "priority": e.priority,
        "status": e.status,
        "reason": e.reason,
        "ruleId": e.rule_id,
        "createdAt": iso(e.created_at),
    }


def summary_out(s: AiSummary, sources: list | None = None) -> dict:
    return {
        "id": s.id,
        "visitId": s.visit_id,
        "version": s.version,
        "body": s.body or {},
        "narrative": s.narrative,
        "confidence": s.confidence,
        "confidenceScore": s.confidence_score,
        "verificationStatus": s.verification_status,
        "sources": sources or [],
        "createdAt": iso(s.created_at),
    }


def conflict_out(c: Conflict) -> dict:
    return {
        "id": c.id,
        "patientUuid": c.patient_uuid,
        "visitId": c.visit_id,
        "field": c.field,
        "leftValue": c.left_value,
        "rightValue": c.right_value,
        "leftSource": c.left_source,
        "rightSource": c.right_source,
        "status": c.status,
        "createdAt": iso(c.created_at),
    }


def dt_iso(value) -> str | None:
    if isinstance(value, datetime):
        return iso(value)
    return None
