from datetime import date, datetime, timezone

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
from app.models.tables import Document
from app.utils.ids import iso
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


def write_structured_history(db: Session, visit: Visit, structured: dict, merge_with_prev: bool = False) -> ClinicalHistory:
    """Create the next history version from ``structured``.

    Data-integrity rules:
    - A key absent from ``structured`` never blanks out data saved in an
      earlier version (partial form saves keep untouched fields).
    - With ``merge_with_prev`` (interview structuring), values the
      patient/doctor already saved explicitly win over re-derived interview
      values — the interview may fill gaps, not overwrite corrections.
    """
    prev = latest_history(db, visit.id)
    version = (prev.version + 1) if prev else 1

    def pick(key: str, col: str, default):
        sv = structured.get(key)
        pv = getattr(prev, col) if prev is not None else None
        if sv is None:
            return pv if pv is not None else default
        if merge_with_prev and prev is not None and pv not in (None, "", [], {}):
            return pv
        return sv if sv not in (None, "", [], {}) else default

    row = ClinicalHistory(
        visit_id=visit.id,
        version=version,
        chief_complaint=pick("chiefComplaint", "chief_complaint", "") or visit.chief_complaint,
        hpi=pick("hpi", "hpi", ""),
        past_medical_history=pick("pastMedicalHistory", "past_medical_history", ""),
        past_surgical_history=pick("pastSurgicalHistory", "past_surgical_history", ""),
        medications=pick("medications", "medications", []),
        allergies=pick("allergies", "allergies", []),
        family_history=pick("familyHistory", "family_history", ""),
        personal_history=pick("personalHistory", "personal_history", ""),
        review_of_systems=pick("reviewOfSystems", "review_of_systems", {}),
        investigations=pick("investigations", "investigations", []),
        patient_concerns=pick("patientConcerns", "patient_concerns", ""),
        lifestyle=pick("lifestyle", "lifestyle", ""),
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
    # Patient's own words: free-text answers that are not skips. Real data only.
    words: list[dict] = []
    for qid, a in ((conv.state or {}).get("answers") if conv else {}).items():
        val = a.get("value") if isinstance(a, dict) else a
        fld = a.get("field") if isinstance(a, dict) else ""
        if not val or not str(val).strip():
            continue
        if str(val).strip().lower() in {"i don't know", "dont know", "don't know", "prefer not to answer", "none", "no", "nil"}:
            continue
        if fld in {"chiefComplaint", "patientConcerns"} or qid in {"free_text", "changed_since", "current_symptoms", "concerns", "concerns_now"}:
            words.append({"questionId": qid, "field": fld, "value": str(val).strip()})
        if len(words) >= 12:
            break
    body["patientWords"] = words
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


def apply_verification(
    db: Session,
    summary: AiSummary,
    status: str,
    visit: Visit,
    actor_name: str | None = None,
    actor_id: str | None = None,
    actor_user_id: str | None = None,
) -> AiSummary:
    # Never mutate in place — new version
    nxt_body = {**(summary.body or {}), "verificationStatus": status}
    if actor_name and status in (VerificationStatus.DOCTOR_VERIFIED.value, VerificationStatus.REJECTED.value):
        # Persist the verifying doctor's identity on the verification record itself.
        nxt_body["verifiedBy"] = actor_name
        if actor_id:
            nxt_body["verifiedById"] = actor_id
        nxt_body["verifiedAt"] = iso(datetime.now(timezone.utc))
    nxt = AiSummary(
        visit_id=summary.visit_id,
        version=summary.version + 1,
        body=nxt_body,
        narrative=summary.narrative,
        confidence=summary.confidence,
        confidence_score=summary.confidence_score,
        verification_status=status,
    )
    db.add(nxt)
    if actor_name and status in (VerificationStatus.DOCTOR_VERIFIED.value, VerificationStatus.REJECTED.value):
        db.add(
            TimelineEvent(
                patient_uuid=visit.patient_uuid,
                occurred_on=date.today(),
                title="Doctor verified the case" if status == VerificationStatus.DOCTOR_VERIFIED.value else "Doctor rejected the draft",
                detail=f"{actor_name} · summary v{nxt.version}",
                source_type=SourceType.DOCTOR.value,
                source_id=actor_user_id or visit.doctor_uuid or None,
                visit_id=visit.id,
            )
        )
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


def _norm_items(items) -> set[str]:
    out = set()
    for m in items or []:
        s = str(m).strip().lower()
        if s and s not in {"none", "no", "nil"}:
            out.add(s)
    return out


def related_visits(db: Session, visit: Visit, limit: int = 3) -> list[dict]:
    """Previous visits related by *structured* data only:

    same complaint pathway, shared current medications, or shared allergies.
    Never by free-text similarity.
    """
    previous = (
        db.query(Visit)
        .filter(Visit.patient_uuid == visit.patient_uuid, Visit.id != visit.id, Visit.started_at < visit.started_at)
        .order_by(Visit.started_at.desc())
        .all()
    )
    cur = latest_history(db, visit.id)
    cur_meds = _norm_items(cur.medications if cur else [])
    cur_allergies = _norm_items(cur.allergies if cur else [])
    out = []
    for pv in previous:
        reasons = []
        if pv.complaint_pathway == visit.complaint_pathway:
            reasons.append(f"Same concern pathway: {pv.complaint_pathway.replace('_', ' ').title()}")
        ph = latest_history(db, pv.id)
        if ph:
            shared_m = sorted(cur_meds & _norm_items(ph.medications))
            if shared_m:
                reasons.append("Shared medication: " + ", ".join(m.title() for m in shared_m[:3]))
            shared_a = sorted(cur_allergies & _norm_items(ph.allergies))
            if shared_a:
                reasons.append("Shared allergy: " + ", ".join(a.title() for a in shared_a[:3]))
        if reasons:
            out.append(
                {
                    "visitId": pv.id,
                    "startedAt": iso(pv.started_at),
                    "chiefComplaint": pv.chief_complaint,
                    "pathway": pv.complaint_pathway,
                    "status": pv.status,
                    "reasons": reasons,
                }
            )
        if len(out) >= limit:
            break
    return out


def previous_visit_info(db: Session, visit_id: str) -> dict | None:
    """Previous visit's carried-forward information for the returning panel."""
    visit = db.get(Visit, visit_id)
    if not visit:
        return None
    hist = latest_history(db, visit_id)
    ayush = latest_ayush(db, visit_id)
    summary = latest_summary(db, visit_id)
    if not hist and not summary:
        return None
    return {
        "visitId": visit.id,
        "startedAt": iso(visit.started_at),
        "chiefComplaint": hist.chief_complaint if hist else visit.chief_complaint,
        "pathway": visit.complaint_pathway,
        "visitStatus": visit.status,
        "history": history_out(hist) if hist else None,
        "ayush": ayush_out(ayush) if ayush else None,
        "summaryStatus": summary.verification_status if summary else None,
        "historyVerificationStatus": hist.verification_status if hist else None,
    }


def processing_state(db: Session, visit: Visit) -> dict:
    """Real per-step processing pipeline for a visit. A step is done only
    when the database actually confirms it."""
    hist = latest_history(db, visit.id)
    summary = latest_summary(db, visit.id)
    docs = db.query(Document).filter(Document.visit_id == visit.id).all()
    doc_pending = [d for d in docs if d.processing_status in ("UPLOADED", "QUEUED", "PROCESSING")]
    doc_failed = [d for d in docs if d.processing_status == "FAILED"]
    doc_review = [d for d in docs if d.processing_status == "PROCESSED"]
    vs = (summary.verification_status if summary else None) or ""
    steps = [
        {
            "key": "patientInput",
            "label": "Patient input",
            "done": True,
            "at": iso(visit.started_at),
            "detail": "Visit started",
        },
        {
            "key": "aiStructuring",
            "label": "AI structuring",
            "done": hist is not None,
            "at": iso(hist.created_at) if hist else None,
            "detail": f"Structured history v{hist.version}" if hist else "Not structured yet",
        },
        {
            "key": "documentProcessing",
            "label": "Document processing",
            "done": len(docs) == 0 or not doc_pending,
            "at": iso(docs[-1].created_at) if docs else None,
            "detail": (
                "No documents"
                if not docs
                else f"{len(doc_review)} processed" + (f" · {len(doc_pending)} in progress" if doc_pending else "") + (f" · {len(doc_failed)} failed" if doc_failed else "")
            ),
        },
        {
            "key": "aiSummary",
            "label": "AI summary",
            "done": summary is not None,
            "at": iso(summary.created_at) if summary else None,
            "detail": (f"Version {summary.version} · {summary.confidence}" if summary else "Not generated yet"),
        },
        {
            "key": "patientConfirmation",
            "label": "Patient confirmation",
            "done": vs in {"PATIENT_CONFIRMED", "DOCTOR_VERIFIED"},
            "at": iso(summary.created_at) if summary and vs in {"PATIENT_CONFIRMED", "DOCTOR_VERIFIED"} else None,
            "detail": "Confirmed by patient" if vs in {"PATIENT_CONFIRMED", "DOCTOR_VERIFIED"} else ("Rejected" if vs == "REJECTED" else "Awaiting patient"),
        },
        {
            "key": "doctorReview",
            "label": "Doctor review",
            "done": visit.status in {"AWAITING_DOCTOR", "VERIFIED"},
            "at": iso(summary.created_at) if summary and visit.status in {"AWAITING_DOCTOR", "VERIFIED"} else None,
            "detail": "Awaiting doctor" if visit.status == "AWAITING_DOCTOR" else ("Reviewed" if visit.status == "VERIFIED" else "Not yet at doctor"),
        },
        {
            "key": "doctorVerification",
            "label": "Doctor verification",
            "done": vs == "DOCTOR_VERIFIED",
            "at": iso(summary.created_at) if summary and vs == "DOCTOR_VERIFIED" else None,
            "detail": "Verified" if vs == "DOCTOR_VERIFIED" else "Pending",
        },
        {
            "key": "visitComplete",
            "label": "Visit complete",
            "done": visit.status == "VERIFIED",
            "at": iso(visit.closed_at or (summary.created_at if summary and vs == "DOCTOR_VERIFIED" else None)),
            "detail": "Complete" if visit.status == "VERIFIED" else "In progress",
        },
    ]
    return {
        "visitId": visit.id,
        "visitStatus": visit.status,
        "summaryStatus": vs or None,
        "steps": steps,
    }
