import asyncio

from fastapi import APIRouter, Depends, Query, Request, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_roles, resolve_patient_scope
from app.models.tables import EmergencyAlert, Patient, User
from app.schemas.common import EmergencyTriggerIn, ResolveIn
from app.security.tokens import try_decode
from app.services.emergency import broadcast, evaluate_text, event_payload, persist_alert, subscribe, transition, unsubscribe
from app.utils.envelope import ApiError, ok
from app.utils.serialize import emergency_out

router = APIRouter(tags=["emergency"])


@router.post("/emergency/trigger")
async def trigger(body: EmergencyTriggerIn, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    patient = resolve_patient_scope(body.patientId, user, db)
    alerts = evaluate_text(
        db,
        text=body.text or body.reason or "",
        answers=None,
        patient_uuid=patient.id,
        visit_id=body.visitId,
        actor_id=user.id,
        ip=request.client.host if request.client else None,
    )
    if not alerts:
        alert = persist_alert(
            db,
            patient_uuid=patient.id,
            visit_id=body.visitId,
            hit={"ruleId": "MANUAL", "priority": body.priority, "label": body.reason or body.text or "Manual emergency", "code": "MANUAL"},
            actor_id=user.id,
            ip=request.client.host if request.client else None,
        )
        alerts = [alert]
    db.commit()
    for a in alerts:
        await broadcast(event_payload(db, a))
    return ok({"items": [emergency_out(a, patient.patient_id) for a in alerts]})


@router.get("/emergency/active")
def active(db: Session = Depends(get_db), user: User = Depends(require_roles("ADMIN", "DOCTOR"))):
    rows = (
        db.query(EmergencyAlert)
        .filter(EmergencyAlert.status.in_(["ACTIVE", "ACKNOWLEDGED"]))
        .order_by(EmergencyAlert.created_at.desc())
        .all()
    )
    items = []
    for a in rows:
        p = db.get(Patient, a.patient_uuid)
        items.append(emergency_out(a, p.patient_id if p else None))
    return ok({"items": items})


@router.post("/emergency/{alert_id}/acknowledge")
def acknowledge(alert_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(require_roles("ADMIN", "DOCTOR"))):
    alert = db.get(EmergencyAlert, alert_id)
    if not alert:
        raise ApiError("EMERGENCY_NOT_FOUND", "Emergency alert was not found.")
    transition(db, alert, "ACKNOWLEDGED", user.id, request.client.host if request.client else None)
    db.commit()
    p = db.get(Patient, alert.patient_uuid)
    return ok(emergency_out(alert, p.patient_id if p else None))


@router.post("/emergency/{alert_id}/resolve")
def resolve(alert_id: str, body: ResolveIn, request: Request, db: Session = Depends(get_db), user: User = Depends(require_roles("ADMIN", "DOCTOR"))):
    alert = db.get(EmergencyAlert, alert_id)
    if not alert:
        raise ApiError("EMERGENCY_NOT_FOUND", "Emergency alert was not found.")
    transition(db, alert, body.resolution, user.id, request.client.host if request.client else None)
    db.commit()
    p = db.get(Patient, alert.patient_uuid)
    return ok(emergency_out(alert, p.patient_id if p else None))


@router.websocket("/ws/emergencies")
async def ws_emergencies(websocket: WebSocket, token: str = Query("")):
    payload = try_decode(token)
    if not payload or payload.get("role") not in {"ADMIN", "DOCTOR"}:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    queue: asyncio.Queue = asyncio.Queue()
    subscribe(queue)
    try:
        await websocket.send_json({"type": "ready"})
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=25)
                await websocket.send_json(event)
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
    finally:
        unsubscribe(queue)
