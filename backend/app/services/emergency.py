from datetime import datetime

from sqlalchemy.orm import Session

from app.models.enums import EmergencyStatus, Priority
from app.models.tables import EmergencyAlert, Patient, RedFlag
from app.services.audit import audit
from app.services.safety import scan_answers, scan_text
from app.utils.serialize import emergency_out

# In-memory fan-out for websocket / SSE subscribers
_subscribers: list = []


def subscribe(queue) -> None:
    _subscribers.append(queue)


def unsubscribe(queue) -> None:
    if queue in _subscribers:
        _subscribers.remove(queue)


async def broadcast(payload: dict) -> None:
    dead = []
    for q in list(_subscribers):
        try:
            await q.put(payload)
        except Exception:
            dead.append(q)
    for q in dead:
        unsubscribe(q)


def _patient_id(db: Session, patient_uuid: str) -> str | None:
    p = db.get(Patient, patient_uuid)
    return p.patient_id if p else None


def persist_alert(
    db: Session,
    *,
    patient_uuid: str,
    visit_id: str | None,
    hit: dict,
    actor_id: str | None,
    ip: str | None = None,
) -> EmergencyAlert:
    existing = (
        db.query(EmergencyAlert)
        .filter(
            EmergencyAlert.patient_uuid == patient_uuid,
            EmergencyAlert.visit_id == visit_id,
            EmergencyAlert.rule_id == hit["ruleId"],
            EmergencyAlert.status.in_([EmergencyStatus.ACTIVE.value, EmergencyStatus.ACKNOWLEDGED.value]),
        )
        .first()
    )
    if existing:
        return existing
    alert = EmergencyAlert(
        patient_uuid=patient_uuid,
        visit_id=visit_id,
        priority=hit.get("priority") or Priority.HIGH.value,
        status=EmergencyStatus.ACTIVE.value,
        reason=hit.get("label") or "Emergency pattern detected",
        rule_id=hit["ruleId"],
    )
    db.add(alert)
    db.flush()
    if visit_id:
        db.add(
            RedFlag(
                visit_id=visit_id,
                code=hit.get("code") or hit["ruleId"],
                label=alert.reason,
                priority=alert.priority,
                rule_id=hit["ruleId"],
                triggered_by="deterministic_rules",
            )
        )
    audit(
        db,
        actor_user_id=actor_id,
        action="emergency.trigger",
        resource_type="emergency",
        resource_id=alert.id,
        ip=ip,
        meta={"ruleId": hit["ruleId"], "priority": alert.priority},
    )
    return alert


def evaluate_text(
    db: Session,
    *,
    text: str,
    answers: dict | None,
    patient_uuid: str,
    visit_id: str | None,
    actor_id: str | None,
    ip: str | None = None,
) -> list[EmergencyAlert]:
    hits = scan_text(text)
    if answers:
        # de-dupe by rule
        seen = {h["ruleId"] for h in hits}
        for h in scan_answers(answers):
            if h["ruleId"] not in seen:
                hits.append(h)
                seen.add(h["ruleId"])
    alerts = []
    for hit in hits:
        if hit.get("priority") in {Priority.HIGH.value, Priority.URGENT.value} and hit["ruleId"].startswith("RF_"):
            # Create emergency for URGENT always; HIGH only for clearly dangerous codes
            urgent_like = hit["priority"] == Priority.URGENT.value or hit["ruleId"] in {
                "RF_CHEST_PAIN",
                "RF_MENINGISM",
                "RF_ABDO_ACUTE",
                "RF_SEIZURE",
            }
            if urgent_like:
                alerts.append(
                    persist_alert(
                        db,
                        patient_uuid=patient_uuid,
                        visit_id=visit_id,
                        hit=hit,
                        actor_id=actor_id,
                        ip=ip,
                    )
                )
    return alerts


def event_payload(db: Session, alert: EmergencyAlert) -> dict:
    return {
        "type": "emergency.created",
        **emergency_out(alert, _patient_id(db, alert.patient_uuid)),
    }


def transition(db: Session, alert: EmergencyAlert, status: str, actor_id: str, ip: str | None) -> EmergencyAlert:
    allowed = {
        EmergencyStatus.ACTIVE.value: {EmergencyStatus.ACKNOWLEDGED.value, EmergencyStatus.FALSE_POSITIVE.value, EmergencyStatus.RESOLVED.value},
        EmergencyStatus.ACKNOWLEDGED.value: {EmergencyStatus.RESOLVED.value, EmergencyStatus.FALSE_POSITIVE.value},
        EmergencyStatus.RESOLVED.value: set(),
        EmergencyStatus.FALSE_POSITIVE.value: set(),
    }
    if status not in allowed.get(alert.status, set()):
        from app.utils.envelope import ApiError

        raise ApiError("STATE_CONFLICT", f"Cannot move emergency from {alert.status} to {status}.")
    alert.status = status
    alert.updated_at = datetime.utcnow()
    if status == EmergencyStatus.ACKNOWLEDGED.value:
        alert.acknowledged_by = actor_id
    if status in {EmergencyStatus.RESOLVED.value, EmergencyStatus.FALSE_POSITIVE.value}:
        alert.resolved_by = actor_id
    audit(
        db,
        actor_user_id=actor_id,
        action=f"emergency.{status.lower()}",
        resource_type="emergency",
        resource_id=alert.id,
        ip=ip,
    )
    return alert
