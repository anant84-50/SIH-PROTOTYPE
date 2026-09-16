from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from app.models.tables import (
    AiSource,
    AiSummary,
    Allergy,
    AuditLog,
    AyushHistory,
    ClinicalHistory,
    Conflict,
    Consent,
    Doctor,
    EmergencyAlert,
    Medication,
    Patient,
    Role,
    SystemSetting,
    TimelineEvent,
    User,
    Visit,
)
from app.security.passwords import hash_password


def seed_if_empty(db: Session) -> None:
    if db.query(User).first():
        return
    for name, desc in [
        ("ADMIN", "Full administrative access"),
        ("DOCTOR", "Clinical records for authorized patients"),
        ("PATIENT", "Own records only"),
    ]:
        db.add(Role(name=name, description=desc))

    admin = User(
        login_id="NexusCare",
        password_hash=hash_password("2525"),
        role="ADMIN",
        display_name="NexusCare Administrator",
        email="admin@aiia.example",
        is_active=True,
    )
    db.add(admin)

    d1u = User(
        login_id="DOC-001",
        password_hash=hash_password("Doctor@1234"),
        role="DOCTOR",
        display_name="Dr. Ananya Sharma",
        email="ananya.sharma@aiia.example",
        is_active=True,
    )
    d2u = User(
        login_id="DOC-002",
        password_hash=hash_password("Doctor@1234"),
        role="DOCTOR",
        display_name="Dr. Rohan Mehta",
        email="rohan.mehta@aiia.example",
        is_active=True,
    )
    db.add_all([d1u, d2u])
    db.flush()
    d1 = Doctor(
        user_id=d1u.id,
        doctor_id="DOC-001",
        full_name="Dr. Ananya Sharma",
        qualification="BAMS, MD (Kayachikitsa)",
        department="Kayachikitsa",
        registration_no="AYUSH-DL-4421",
    )
    d2 = Doctor(
        user_id=d2u.id,
        doctor_id="DOC-002",
        full_name="Dr. Rohan Mehta",
        qualification="BAMS",
        department="Panchakarma",
        registration_no="AYUSH-DL-5510",
    )
    db.add_all([d1, d2])

    p1u = User(
        login_id="PCI-2026-000001",
        password_hash=hash_password("Patient@1234"),
        role="PATIENT",
        display_name="Priya Verma",
        phone="9876543210",
        is_active=True,
    )
    p2u = User(
        login_id="PCI-2026-000002",
        password_hash=hash_password("Patient@1234"),
        role="PATIENT",
        display_name="Amit Kumar",
        phone="9876501234",
        is_active=True,
    )
    db.add_all([p1u, p2u])
    db.flush()
    p1 = Patient(
        user_id=p1u.id,
        patient_id="PCI-2026-000001",
        full_name="Priya Verma",
        date_of_birth=date(1988, 4, 12),
        sex="Female",
        language="en",
        phone="9876543210",
        address="Meerut, Uttar Pradesh",
        blood_group="B+",
    )
    p2 = Patient(
        user_id=p2u.id,
        patient_id="PCI-2026-000002",
        full_name="Amit Kumar",
        date_of_birth=date(1979, 11, 3),
        sex="Male",
        language="hi",
        phone="9876501234",
        address="Ghaziabad, Uttar Pradesh",
        blood_group="O+",
    )
    db.add_all([p1, p2])
    db.flush()

    db.add_all(
        [
            Medication(
                patient_uuid=p1.id,
                name="Metformin",
                dosage="500mg",
                frequency="twice daily",
                duration="long-term",
                source_type="PREVIOUS_RECORD",
                source_id="RX-2024-019",
                confidence=0.94,
                verification_status="DOCTOR_VERIFIED",
            ),
            Allergy(
                patient_uuid=p1.id,
                substance="Sulfa drugs",
                reaction="Rash",
                source_type="PATIENT_INPUT",
                verification_status="PATIENT_CONFIRMED",
            ),
        ]
    )

    db.add_all(
        [
            TimelineEvent(
                patient_uuid=p1.id,
                occurred_on=date(2023, 6, 18),
                title="Type 2 diabetes recorded",
                detail="Diagnosed at district hospital. Lifestyle advice + Metformin.",
                source_type="PREVIOUS_RECORD",
                source_id="DX-2023",
            ),
            TimelineEvent(
                patient_uuid=p1.id,
                occurred_on=date(2024, 2, 9),
                title="Prescription renewed",
                detail="Metformin 500mg BD",
                source_type="DOCUMENT",
                source_id="RX-2024-019",
            ),
            TimelineEvent(
                patient_uuid=p1.id,
                occurred_on=date(2025, 11, 2),
                title="HbA1c laboratory report",
                detail="HbA1c 6.4%",
                source_type="DOCUMENT",
                source_id="LAB-2025-88",
            ),
            TimelineEvent(
                patient_uuid=p1.id,
                occurred_on=date.today(),
                title="Registered at Preclinic IQ AI",
                detail="Returning patient identity verified.",
                source_type="PATIENT_INPUT",
                source_id=p1.id,
            ),
            TimelineEvent(
                patient_uuid=p2.id,
                occurred_on=date(2024, 8, 1),
                title="Seasonal cough episode",
                detail="Self-limiting; no admission.",
                source_type="PREVIOUS_RECORD",
                source_id="NOTE-2024",
            ),
        ]
    )

    v1 = Visit(
        patient_uuid=p1.id,
        doctor_uuid=d1.id,
        complaint_pathway="FEVER",
        chief_complaint="Fever for 3 days with body ache",
        status="AWAITING_DOCTOR",
        language="en",
        started_at=datetime.utcnow() - timedelta(hours=2),
    )
    db.add(v1)
    db.flush()
    db.add(
        Consent(
            patient_uuid=p1.id,
            visit_id=v1.id,
            consent_type="INTAKE_AND_AI_ASSIST",
            granted=True,
            granted_at=datetime.utcnow() - timedelta(hours=2),
        )
    )
    db.add(
        ClinicalHistory(
            visit_id=v1.id,
            version=1,
            chief_complaint="Fever for 3 days with body ache",
            hpi="Intermittent fever 3 days, highest 101.2°F, chills in the evening. Paracetamol taken twice.",
            past_medical_history="Type 2 diabetes mellitus since 2023",
            medications=["Metformin 500mg"],
            allergies=["Sulfa drugs"],
            personal_history="Lives in Meerut; no recent travel",
            patient_concerns="Worried it may affect sugar control",
            verification_status="PATIENT_CONFIRMED",
        )
    )
    db.add(
        AyushHistory(
            visit_id=v1.id,
            prakriti="Pitta-Kapha",
            vikriti="Pitta aggravation",
            sara="Madhyama",
            samhanana="Madhyama",
            satmya="Madhura predominant",
            sattva="Madhyama",
            ahara_shakti="Madhyama",
            vyayama_shakti="Avara",
            vaya="Madhya",
            ahara="Irregular meal times, spicy preference",
            vihara="Desk work, reduced sleep",
            nidana="Exposure to heat, skipped meals",
            samprapti="Pitta dushti presenting as jwara",
            verification_status="AI_DRAFT",
        )
    )
    db.add(
        Conflict(
            patient_uuid=p1.id,
            visit_id=v1.id,
            field="medications",
            left_value="Metformin 500mg (previous prescription)",
            right_value="Patient said 'only paracetamol' during intake",
            left_source="PREVIOUS_RECORD",
            right_source="PATIENT_INPUT",
            status="OPEN",
        )
    )

    db.add(
        EmergencyAlert(
            patient_uuid=p2.id,
            priority="HIGH",
            status="ACTIVE",
            reason="Chest pain — needs same-day clinical review",
            rule_id="RF_CHEST_PAIN",
        )
    )

    db.add_all(
        [
            SystemSetting(key="institute", value="All India Institute of Ayurveda"),
            SystemSetting(key="ministry", value="Ministry of Ayush"),
            SystemSetting(key="sih", value="SIH 26047"),
        ]
    )
    db.add(AuditLog(actor_user_id=admin.id, action="system.seed", resource_type="system", resource_id="bootstrap", meta={}))
    db.commit()


def ensure_admin_credentials(db: Session) -> None:
    """Keep the institute admin login at NexusCare / 2525 even on existing databases."""
    desired_id = "NexusCare"
    desired_pw = "2525"
    admin = db.query(User).filter(User.role == "ADMIN").order_by(User.created_at.asc()).first()
    if not admin:
        db.add(
            User(
                login_id=desired_id,
                password_hash=hash_password(desired_pw),
                role="ADMIN",
                display_name="NexusCare Administrator",
                is_active=True,
            )
        )
        db.commit()
        return
    taken = db.query(User).filter(User.login_id == desired_id, User.id != admin.id).first()
    if not taken:
        admin.login_id = desired_id
    admin.password_hash = hash_password(desired_pw)
    admin.is_active = True
    if not admin.display_name:
        admin.display_name = "NexusCare Administrator"
    db.commit()
