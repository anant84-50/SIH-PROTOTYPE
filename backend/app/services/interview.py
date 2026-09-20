from sqlalchemy.orm import Session

from app.models.tables import ClinicalHistory, Conversation, ConversationMessage, Visit
from app.services.interview_i18n import localize_bank
from app.services.ontology import is_skip
from app.services.providers import get_ai

# Answer states for the doctor intake view.
ANSWERED = "ANSWERED"
SKIPPED = "SKIPPED"
PREFER_NOT = "PREFER_NOT"
NOT_PROVIDED = "NOT_PROVIDED"


def _lang(conv: Conversation, visit: Visit | None = None) -> str:
    state = conv.state or {}
    return (state.get("language") or (visit.language if visit else None) or "en")[:2]


def _bank_key(conv: Conversation) -> str:
    return (conv.state or {}).get("bank") or conv.pathway


def _question_bank(conv: Conversation) -> list[dict]:
    _opening, questions = localize_bank(_bank_key(conv), _lang(conv))
    return questions


def _opening(conv: Conversation) -> str:
    opening, _q = localize_bank(_bank_key(conv), _lang(conv))
    return opening


def _previous_reuse_base(db: Session, previous_visit_id: str) -> dict:
    """Pull the best previous structured information to carry forward.

    Prefers a doctor-verified history version; otherwise the latest version.
    Values are carried as a *base* — the returning interview still asks what
    may have changed, and old values are never asserted as current.
    """
    rows = (
        db.query(ClinicalHistory)
        .filter(ClinicalHistory.visit_id == previous_visit_id)
        .order_by(ClinicalHistory.version.desc())
        .all()
    )
    if not rows:
        return {}
    verified = [r for r in rows if r.verification_status == "DOCTOR_VERIFIED"]
    chosen = verified[0] if verified else rows[0]
    return {
        "previousVisitId": previous_visit_id,
        "sourceVerificationStatus": chosen.verification_status,
        "chiefComplaint": chosen.chief_complaint or "",
        "pastMedicalHistory": chosen.past_medical_history or "",
        "pastSurgicalHistory": chosen.past_surgical_history or "",
        "familyHistory": chosen.family_history or "",
        "patientConcerns": chosen.patient_concerns or "",
        "medications": list(chosen.medications or []),
        "allergies": list(chosen.allergies or []),
    }


def start_session(db: Session, visit: Visit, reuse_from: str | None = None) -> tuple[Conversation, dict]:
    existing = db.query(Conversation).filter(Conversation.visit_id == visit.id).first()
    if existing:
        state = dict(existing.state or {})
        if visit.language and not state.get("language"):
            state["language"] = visit.language
            existing.state = state
        return existing, _next_payload(existing)

    bank = visit.complaint_pathway
    state: dict = {
        "cursor": 0,
        "answers": {},
        "phase": "pathway",
        "asked": [],
        "language": visit.language or "en",
    }
    if reuse_from:
        base = _previous_reuse_base(db, reuse_from)
        if base:
            bank = "RETURNING"
            state["bank"] = "RETURNING"
            state["reuseBase"] = base
            state["reusedFrom"] = reuse_from

    conv = Conversation(
        visit_id=visit.id,
        patient_uuid=visit.patient_uuid,
        pathway=visit.complaint_pathway,
        state=state,
        is_complete=False,
    )
    db.add(conv)
    db.flush()
    db.add(ConversationMessage(conversation_id=conv.id, role="assistant", text=_opening(conv), question_id="opening"))
    return conv, _next_payload(conv)


def _next_unanswered(conv: Conversation) -> dict | None:
    asked = set(conv.state.get("asked") or [])
    answers = conv.state.get("answers") or {}
    for q in _question_bank(conv):
        if q["id"] in answers or q["id"] in asked:
            continue
        return q
    return None


def _next_payload(conv: Conversation) -> dict:
    q = _next_unanswered(conv)
    opening = _opening(conv)
    if not q:
        conv.is_complete = True
        return {
            "sessionId": conv.id,
            "complete": True,
            "question": None,
            "opening": opening,
            "progress": 1,
            "answered": conv.state.get("answers") or {},
            "language": _lang(conv),
            "returning": bool((conv.state or {}).get("reuseBase")),
            "reusedFrom": (conv.state or {}).get("reusedFrom"),
        }
    bank = _question_bank(conv)
    done = len(conv.state.get("answers") or {})
    return {
        "sessionId": conv.id,
        "complete": False,
        "question": q,
        "opening": opening,
        "progress": round(done / max(len(bank), 1), 2),
        "answered": conv.state.get("answers") or {},
        "actions": ["answer", "repeat", "i_dont_know", "prefer_not_to_answer"],
        "language": _lang(conv),
        "returning": bool((conv.state or {}).get("reuseBase")),
        "reusedFrom": (conv.state or {}).get("reusedFrom"),
    }


def apply_message(
    db: Session,
    conv: Conversation,
    *,
    text: str,
    input_mode: str,
    action: str,
    question_id: str | None,
) -> dict:
    bank = {q["id"]: q for q in _question_bank(conv)}
    current = None
    if question_id and question_id in bank:
        current = bank[question_id]
    else:
        current = _next_unanswered(conv)
    db.add(
        ConversationMessage(
            conversation_id=conv.id,
            role="patient",
            text=text or action,
            input_mode=input_mode,
            question_id=current["id"] if current else None,
        )
    )
    state = dict(conv.state or {})
    answers = dict(state.get("answers") or {})
    asked = list(state.get("asked") or [])

    if action == "repeat" and current:
        db.add(
            ConversationMessage(
                conversation_id=conv.id,
                role="assistant",
                text=current["text"],
                question_id=current["id"],
            )
        )
        conv.state = state
        return _next_payload(conv)

    if current:
        value = text
        if action in {"i_dont_know", "prefer_not_to_answer"} or is_skip(text):
            value = "prefer not to answer" if action == "prefer_not_to_answer" else "i don't know"
        answers[current["id"]] = {
            "value": value,
            "field": current["field"],
            "inputMode": input_mode,
            "action": action,
        }
        if current["id"] not in asked:
            asked.append(current["id"])
    state["answers"] = answers
    state["asked"] = asked
    conv.state = state
    payload = _next_payload(conv)
    if payload.get("question"):
        db.add(
            ConversationMessage(
                conversation_id=conv.id,
                role="assistant",
                text=payload["question"]["text"],
                question_id=payload["question"]["id"],
            )
        )
    return payload


def missing_fields(conv: Conversation) -> list[str]:
    from app.services.ontology import bank_def

    pdef = bank_def(_bank_key(conv))
    answers = conv.state.get("answers") or {}
    missing = []
    for qid, label in (pdef.get("missing_if") or {}).items():
        item = answers.get(qid)
        val = (item or {}).get("value") if isinstance(item, dict) else item
        if not val or is_skip(str(val)):
            missing.append(label)
    return missing


def structure_from_session(conv: Conversation) -> dict:
    answers = conv.state.get("answers") or {}
    base = (conv.state or {}).get("reuseBase") or None
    return get_ai().structure_history(answers, _bank_key(conv), base)


def intake_view(conv: Conversation) -> dict:
    """Question-level intake for the doctor workspace.

    Status per question: ANSWED | SKIPPED | PREFER_NOT | NOT_PROVIDED.
    Never invents values: unasked questions stay NOT_PROVIDED, skips stay skips.
    """
    answers = conv.state.get("answers") or {}
    items = []
    for q in _question_bank(conv):
        a = answers.get(q["id"])
        val = a.get("value") if isinstance(a, dict) else None
        action = a.get("action") if isinstance(a, dict) else None
        vtext = (val or "").strip()
        if a is None:
            status = NOT_PROVIDED
        elif action == "prefer_not_to_answer" or vtext.lower() == "prefer not to answer":
            status = PREFER_NOT
        elif action == "i_dont_know" or is_skip(vtext) or vtext.lower() == "":
            status = SKIPPED
        else:
            status = ANSWERED
        items.append(
            {
                "id": q["id"],
                "field": q["field"],
                "question": q["text"],
                "type": q["type"],
                "value": val,
                "status": status,
                "inputMode": a.get("inputMode") if isinstance(a, dict) else None,
            }
        )
    answered = sum(1 for i in items if i["status"] == ANSWERED)
    return {
        "sessionId": conv.id,
        "complete": bool(conv.is_complete),
        "returning": bool((conv.state or {}).get("reuseBase")),
        "reusedFrom": (conv.state or {}).get("reusedFrom"),
        "answered": answered,
        "total": len(items),
        "items": items,
    }
