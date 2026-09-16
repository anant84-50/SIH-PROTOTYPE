from sqlalchemy.orm import Session

from app.models.tables import Conversation, ConversationMessage, Visit
from app.services.interview_i18n import localize_bank
from app.services.ontology import is_skip, pathway_def
from app.services.providers import get_ai


def _lang(conv: Conversation, visit: Visit | None = None) -> str:
    state = conv.state or {}
    return (state.get("language") or (visit.language if visit else None) or "en")[:2]


def start_session(db: Session, visit: Visit) -> tuple[Conversation, dict]:
    existing = db.query(Conversation).filter(Conversation.visit_id == visit.id).first()
    if existing:
        state = dict(existing.state or {})
        if visit.language and not state.get("language"):
            state["language"] = visit.language
            existing.state = state
        return existing, _next_payload(existing)
    opening, _bank = localize_bank(visit.complaint_pathway, visit.language or "en")
    conv = Conversation(
        visit_id=visit.id,
        patient_uuid=visit.patient_uuid,
        pathway=visit.complaint_pathway,
        state={"cursor": 0, "answers": {}, "phase": "pathway", "asked": [], "language": visit.language or "en"},
        is_complete=False,
    )
    db.add(conv)
    db.flush()
    db.add(ConversationMessage(conversation_id=conv.id, role="assistant", text=opening, question_id="opening"))
    return conv, _next_payload(conv)


def _question_bank(conv: Conversation) -> list[dict]:
    _opening, questions = localize_bank(conv.pathway, _lang(conv))
    return questions


def _opening(conv: Conversation) -> str:
    opening, _q = localize_bank(conv.pathway, _lang(conv))
    return opening


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
    pdef = pathway_def(conv.pathway)
    answers = conv.state.get("answers") or {}
    missing = []
    for qid, label in (pdef.get("missing_if") or {}).items():
        item = answers.get(qid)
        val = (item or {}).get("value") if isinstance(item, dict) else item
        if not val or is_skip(str(val)):
            missing.append(label)
    return missing


def structure_from_session(conv: Conversation) -> dict:
    return get_ai().structure_history(conv.state.get("answers") or {}, conv.pathway)
