import io
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import ensure_admin_credentials  # noqa: E402
from app.services.safety import scan_text  # noqa: E402


@pytest.fixture(scope="module")
def client():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        ensure_admin_credentials(db)
    finally:
        db.close()
    with TestClient(app) as c:
        yield c


def login(client, identifier, password, role):
    res = client.post("/api/v1/auth/login", json={"identifier": identifier, "password": password, "role": role})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["success"] is True
    assert body["error"] is None
    return body["data"]["accessToken"], body["data"]["user"]


def test_envelope_and_invalid_login(client):
    res = client.post("/api/v1/auth/login", json={"identifier": "NOPE", "password": "x", "role": "ADMIN"})
    body = res.json()
    assert body["success"] is False
    assert body["data"] is None
    assert body["error"]["code"] == "AUTH_INVALID"


def test_admin_rbac(client):
    token, _ = login(client, "NexusCare", "2525", "ADMIN")
    dash = client.get("/api/v1/admin/dashboard", headers={"Authorization": f"Bearer {token}"})
    assert dash.status_code == 200
    assert dash.json()["data"]["patients"] >= 2


def test_patient_cannot_read_other_patient(client):
    t1, u1 = login(client, "PCI-2026-000001", "Patient@1234", "PATIENT")
    t2, u2 = login(client, "PCI-2026-000002", "Patient@1234", "PATIENT")
    assert u1["patientId"] == "PCI-2026-000001"
    other = client.get("/api/v1/patients/PCI-2026-000002", headers={"Authorization": f"Bearer {t1}"})
    assert other.status_code == 403
    assert other.json()["error"]["code"] == "FORBIDDEN"
    own = client.get("/api/v1/patients/PCI-2026-000001", headers={"Authorization": f"Bearer {t1}"})
    assert own.status_code == 200
    assert own.json()["data"]["patientId"] == "PCI-2026-000001"
    # second patient also isolated
    cross = client.get("/api/v1/patients/PCI-2026-000001", headers={"Authorization": f"Bearer {t2}"})
    assert cross.status_code == 403


def test_patient_cannot_hit_admin(client):
    token, _ = login(client, "PCI-2026-000001", "Patient@1234", "PATIENT")
    res = client.get("/api/v1/admin/users", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "FORBIDDEN"


def test_emergency_rules_are_deterministic():
    hits = scan_text("severe chest pain and I cannot breathe")
    assert any(h["ruleId"] == "RF_CHEST_DYSPNEA" for h in hits)
    assert any(h["priority"] == "URGENT" for h in hits)
    assert scan_text("mild sore throat") == []


def test_emergency_trigger_reaches_doctor(client):
    ptoken, _ = login(client, "PCI-2026-000001", "Patient@1234", "PATIENT")
    fired = client.post(
        "/api/v1/emergency/trigger",
        json={"patientId": "PCI-2026-000001", "text": "I have sudden worst headache like a thunderclap", "priority": "URGENT"},
        headers={"Authorization": f"Bearer {ptoken}"},
    )
    assert fired.status_code == 200
    assert fired.json()["data"]["items"][0]["status"] == "ACTIVE"
    dtoken, _ = login(client, "DOC-001", "Doctor@1234", "DOCTOR")
    inbox = client.get("/api/v1/emergency/active", headers={"Authorization": f"Bearer {dtoken}"})
    assert inbox.status_code == 200
    reasons = " ".join(i.get("reason") or "" for i in inbox.json()["data"]["items"])
    assert "thunderclap" in reasons.lower() or "Headache" in reasons or inbox.json()["data"]["items"]


def test_visit_and_summary_versioning(client):
    token, user = login(client, "PCI-2026-000001", "Patient@1234", "PATIENT")
    h = {"Authorization": f"Bearer {token}"}
    visit = client.post(
        "/api/v1/visits",
        json={
            "patientId": user["patientId"],
            "complaintPathway": "FEVER",
            "chiefComplaint": "Fever two days",
            "consent": True,
            "language": "en",
        },
        headers=h,
    )
    assert visit.status_code == 200
    vid = visit.json()["data"]["visitId"]
    sess = client.post("/api/v1/ai/session", json={"visitId": vid}, headers=h)
    assert sess.json()["success"]
    sid = sess.json()["data"]["sessionId"]
    q = sess.json()["data"]["question"]
    client.post(
        "/api/v1/ai/message",
        json={"sessionId": sid, "text": "1–3 days", "inputMode": "TEXT", "action": "answer", "questionId": q["id"]},
        headers=h,
    )
    client.post("/api/v1/ai/structure-history", json={"visitId": vid, "sessionId": sid}, headers=h)
    s1 = client.post("/api/v1/ai/generate-summary", json={"visitId": vid}, headers=h)
    assert s1.json()["data"]["verificationStatus"] == "AI_DRAFT"
    s2 = client.post("/api/v1/ai/verify-summary", json={"visitId": vid, "action": "PATIENT_CONFIRMED"}, headers=h)
    assert s2.json()["data"]["verificationStatus"] == "PATIENT_CONFIRMED"
    assert s2.json()["data"]["version"] >= 2
    dtoken, _ = login(client, "DOC-001", "Doctor@1234", "DOCTOR")
    dh = {"Authorization": f"Bearer {dtoken}"}
    verified = client.post("/api/v1/doctor/verify/" + vid, json={"visitId": vid, "action": "DOCTOR_VERIFIED"}, headers=dh)
    assert verified.json()["data"]["verificationStatus"] == "DOCTOR_VERIFIED"
    # patient must not overwrite doctor-verified
    bad = client.post("/api/v1/ai/verify-summary", json={"visitId": vid, "action": "REJECTED"}, headers=h)
    assert bad.status_code in (403, 409)


def test_document_pipeline(client):
    token, user = login(client, "PCI-2026-000001", "Patient@1234", "PATIENT")
    files = {"file": ("prescription_rx.txt", io.BytesIO(b"Metformin 500mg"), "text/plain")}
    res = client.post(
        "/api/v1/documents/upload",
        data={"patientId": user["patientId"], "documentType": "PRESCRIPTION"},
        files=files,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    doc_id = res.json()["data"]["id"]
    ents = client.get(f"/api/v1/documents/{doc_id}/entities", headers={"Authorization": f"Bearer {token}"})
    assert ents.status_code == 200
    assert isinstance(ents.json()["data"]["entities"], list)


def test_patient_id_format_on_register(client):
    res = client.post(
        "/api/v1/patients",
        json={"fullName": "Test Person", "password": "Secret#123", "language": "en"},
    )
    assert res.status_code == 200
    pid = res.json()["data"]["patientId"]
    assert pid.startswith("PCI-")
    parts = pid.split("-")
    assert len(parts) == 3 and len(parts[2]) == 6


def test_login_cookie_and_repeat(client):
    for _ in range(3):
        token, user = login(client, "PCI-2026-000001", "Patient@1234", "PATIENT")
        assert user["role"] == "PATIENT"
        me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        assert me.json()["data"]["patientId"] == "PCI-2026-000001"
        own = client.get("/api/v1/patients/PCI-2026-000001", headers={"Authorization": f"Bearer {token}"})
        assert own.status_code == 200
        cookie_me = client.get("/api/v1/auth/me")
        assert cookie_me.status_code == 200
        header_me = client.get("/api/v1/auth/me", headers={"X-Access-Token": token})
        assert header_me.status_code == 200
    admin_token, _ = login(client, "NexusCare", "2525", "ADMIN")
    dash = client.get("/api/v1/admin/dashboard", headers={"Authorization": f"Bearer {admin_token}"})
    assert dash.status_code == 200
    doc_token, _ = login(client, "DOC-001", "Doctor@1234", "DOCTOR")
    queue = client.get("/api/v1/doctor/queue", headers={"Authorization": f"Bearer {doc_token}"})
    assert queue.status_code == 200


def test_frontend_static_contract():
    front = Path(__file__).resolve().parents[2] / "frontend"
    for name in ["index.html", "login.html", "admin.html", "doctor.html", "patient.html", "about.html", "how-it-works.html", "why.html"]:
        assert (front / name).exists()
    js = (front / "js" / "api.js").read_text()
    assert "/api/v1" in js
    assert "error.code" in Path(front / "js" / "common.js").read_text() or "error" in js
