from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, resolve_patient_scope
from app.models.tables import Conversation, User, Visit
from app.schemas.common import AiMessageIn, AiSessionIn, StructureIn, SummaryIn, VerifyIn
from app.services.audit import audit
from app.services.clinical import apply_verification, generate_summary, latest_summary, write_structured_history
from app.services.emergency import broadcast, evaluate_text, event_payload
from app.services.interview import apply_message, missing_fields, start_session, structure_from_session
from app.utils.envelope import ApiError, ok
from app.utils.serialize import history_out, summary_out

router = APIRouter(prefix="/ai", tags=["ai"])


def _visit(db: Session, visit_id: str, user: User) -> Visit:
    visit = db.get(Visit, visit_id)
    if not visit:
        raise ApiError("VISIT_NOT_FOUND", "Visit was not found.")
    resolve_patient_scope(visit.patient_uuid, user, db)
    return visit


@router.post("/session")
def ai_session(body: AiSessionIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    visit = _visit(db, body.visitId, user)
    reuse_from = None
    if body.reuseFrom:
        prev = db.get(Visit, body.reuseFrom)
        # Must belong to the same patient.
        if prev and prev.patient_uuid == visit.patient_uuid:
            reuse_from = prev.id
    conv, payload = start_session(db, visit, reuse_from=reuse_from)
    db.commit()
    return ok(payload)


@router.post("/message")
async def ai_message(body: AiMessageIn, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    conv = db.get(Conversation, body.sessionId)
    if not conv:
        raise ApiError("VISIT_NOT_FOUND", "AI session was not found.")
    visit = _visit(db, conv.visit_id, user)
    payload = apply_message(
        db,
        conv,
        text=body.text,
        input_mode=body.inputMode,
        action=body.action,
        question_id=body.questionId,
    )
    alerts = evaluate_text(
        db,
        text=body.text,
        answers=conv.state.get("answers"),
        patient_uuid=visit.patient_uuid,
        visit_id=visit.id,
        actor_id=user.id,
        ip=request.client.host if request.client else None,
    )
    db.commit()
    for alert in alerts:
        await broadcast(event_payload(db, alert))
    payload["emergencies"] = [a.id for a in alerts]
    payload["missingInformation"] = missing_fields(conv)
    return ok(payload)


@router.post("/structure-history")
def structure_history(body: StructureIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    visit = _visit(db, body.visitId, user)
    conv = None
    if body.sessionId:
        conv = db.get(Conversation, body.sessionId)
    if not conv:
        conv = db.query(Conversation).filter(Conversation.visit_id == visit.id).first()
    if not conv:
        raise ApiError("VALIDATION_ERROR", "No interview session to structure.")
    structured = structure_from_session(conv)
    # Re-derivation from the interview must not overwrite what the
    # patient/doctor already saved in the history form (no data loss on
    # confirm/regenerate cycles).
    hist = write_structured_history(db, visit, structured, merge_with_prev=True)
    db.commit()
    return ok(history_out(hist))


@router.post("/generate-summary")
def gen_summary(body: SummaryIn, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    visit = _visit(db, body.visitId, user)
    summary = generate_summary(db, visit)
    audit(db, actor_user_id=user.id, action="summary.generate", resource_type="summary", resource_id=summary.id, ip=request.client.host if request.client else None)
    db.commit()
    return ok(summary_out(summary))


@router.post("/verify-summary")
def verify_summary(body: VerifyIn, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    visit = _visit(db, body.visitId, user)
    summary = latest_summary(db, visit.id)
    if not summary:
        raise ApiError("VISIT_NOT_FOUND", "No summary exists for this visit.")
    if body.action == "PATIENT_CONFIRMED" and user.role not in {"PATIENT", "ADMIN"}:
        raise ApiError("FORBIDDEN", "Only the patient can patient-confirm a summary.")
    if body.action == "DOCTOR_VERIFIED" and user.role not in {"DOCTOR", "ADMIN"}:
        raise ApiError("FORBIDDEN", "Only a doctor can doctor-verify a summary.")
    if summary.verification_status == "DOCTOR_VERIFIED" and body.action != "DOCTOR_VERIFIED":
        raise ApiError("STATE_CONFLICT", "AI must not alter a doctor-verified record. Ask the doctor to create a new version.")
    is_doctor = user.role in {"DOCTOR", "ADMIN"} and body.action in {"DOCTOR_VERIFIED", "REJECTED"}
    nxt = apply_verification(
        db,
        summary,
        body.action,
        visit,
        actor_name=user.display_name if is_doctor else None,
        actor_id=user.login_id if is_doctor else None,
        actor_user_id=user.id if is_doctor else None,
    )
    db.flush()  # assign nxt.id before the audit row is written
    audit(
        db,
        actor_user_id=user.id,
        action="summary.verify",
        resource_type="summary",
        resource_id=nxt.id,
        ip=request.client.host if request.client else None,
        meta={"action": body.action, "version": nxt.version, "visitId": visit.id, "summaryId": nxt.id},
    )
    db.commit()
    return ok(summary_out(nxt))
