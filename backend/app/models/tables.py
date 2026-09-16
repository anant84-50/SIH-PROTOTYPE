import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.utcnow()


class Role(Base):
    __tablename__ = "roles"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    description: Mapped[str] = mapped_column(Text, default="")


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    login_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), index=True)
    display_name: Mapped[str] = mapped_column(String(160))
    email: Mapped[str | None] = mapped_column(String(160), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    totp_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    patient: Mapped["Patient | None"] = relationship(back_populates="user", uselist=False)
    doctor: Mapped["Doctor | None"] = relationship(back_populates="user", uselist=False)


class Patient(Base):
    __tablename__ = "patients"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), unique=True)
    patient_id: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(160))
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    sex: Mapped[str | None] = mapped_column(String(24), nullable=True)
    language: Mapped[str] = mapped_column(String(16), default="en")
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    blood_group: Mapped[str | None] = mapped_column(String(8), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    user: Mapped[User] = relationship(back_populates="patient")
    visits: Mapped[list["Visit"]] = relationship(back_populates="patient")


class Doctor(Base):
    __tablename__ = "doctors"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), unique=True)
    doctor_id: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(160))
    qualification: Mapped[str] = mapped_column(String(160), default="")
    department: Mapped[str] = mapped_column(String(120), default="Kayachikitsa")
    registration_no: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    user: Mapped[User] = relationship(back_populates="doctor")


class Visit(Base):
    __tablename__ = "visits"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    patient_uuid: Mapped[str] = mapped_column(String(36), ForeignKey("patients.id"), index=True)
    doctor_uuid: Mapped[str | None] = mapped_column(String(36), ForeignKey("doctors.id"), nullable=True)
    complaint_pathway: Mapped[str] = mapped_column(String(32))
    chief_complaint: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(32), default="DRAFT", index=True)
    language: Mapped[str] = mapped_column(String(16), default="en")
    started_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    patient: Mapped[Patient] = relationship(back_populates="visits")
    doctor: Mapped[Doctor | None] = relationship()


class Consent(Base):
    __tablename__ = "consents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    patient_uuid: Mapped[str] = mapped_column(String(36), ForeignKey("patients.id"), index=True)
    visit_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("visits.id"), nullable=True)
    consent_type: Mapped[str] = mapped_column(String(64))
    granted: Mapped[bool] = mapped_column(Boolean, default=False)
    granted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    version: Mapped[str] = mapped_column(String(16), default="1.0")


class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    visit_id: Mapped[str] = mapped_column(String(36), ForeignKey("visits.id"), index=True)
    patient_uuid: Mapped[str] = mapped_column(String(36), ForeignKey("patients.id"))
    pathway: Mapped[str] = mapped_column(String(32))
    state: Mapped[dict] = mapped_column(JSON, default=dict)
    is_complete: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class ConversationMessage(Base):
    __tablename__ = "conversation_messages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    conversation_id: Mapped[str] = mapped_column(String(36), ForeignKey("conversations.id"), index=True)
    role: Mapped[str] = mapped_column(String(16))
    text: Mapped[str] = mapped_column(Text)
    input_mode: Mapped[str | None] = mapped_column(String(16), nullable=True)
    question_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class ClinicalHistory(Base):
    __tablename__ = "clinical_histories"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    visit_id: Mapped[str] = mapped_column(String(36), ForeignKey("visits.id"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    chief_complaint: Mapped[str] = mapped_column(Text, default="")
    hpi: Mapped[str] = mapped_column(Text, default="")
    past_medical_history: Mapped[str] = mapped_column(Text, default="")
    past_surgical_history: Mapped[str] = mapped_column(Text, default="")
    medications: Mapped[list] = mapped_column(JSON, default=list)
    allergies: Mapped[list] = mapped_column(JSON, default=list)
    family_history: Mapped[str] = mapped_column(Text, default="")
    personal_history: Mapped[str] = mapped_column(Text, default="")
    review_of_systems: Mapped[dict] = mapped_column(JSON, default=dict)
    investigations: Mapped[list] = mapped_column(JSON, default=list)
    patient_concerns: Mapped[str] = mapped_column(Text, default="")
    lifestyle: Mapped[str] = mapped_column(Text, default="")
    verification_status: Mapped[str] = mapped_column(String(32), default="AI_DRAFT")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class AyushHistory(Base):
    __tablename__ = "ayush_histories"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    visit_id: Mapped[str] = mapped_column(String(36), ForeignKey("visits.id"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    prakriti: Mapped[str] = mapped_column(String(80), default="")
    vikriti: Mapped[str] = mapped_column(String(80), default="")
    sara: Mapped[str] = mapped_column(String(80), default="")
    samhanana: Mapped[str] = mapped_column(String(80), default="")
    pramana: Mapped[str] = mapped_column(String(80), default="")
    satmya: Mapped[str] = mapped_column(String(80), default="")
    sattva: Mapped[str] = mapped_column(String(80), default="")
    ahara_shakti: Mapped[str] = mapped_column(String(80), default="")
    vyayama_shakti: Mapped[str] = mapped_column(String(80), default="")
    vaya: Mapped[str] = mapped_column(String(80), default="")
    ahara: Mapped[str] = mapped_column(Text, default="")
    vihara: Mapped[str] = mapped_column(Text, default="")
    nidana: Mapped[str] = mapped_column(Text, default="")
    samprapti: Mapped[str] = mapped_column(Text, default="")
    verification_status: Mapped[str] = mapped_column(String(32), default="AI_DRAFT")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    patient_uuid: Mapped[str] = mapped_column(String(36), ForeignKey("patients.id"), index=True)
    visit_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("visits.id"), nullable=True)
    document_type: Mapped[str] = mapped_column(String(40))
    original_filename: Mapped[str] = mapped_column(String(255))
    storage_key: Mapped[str] = mapped_column(String(512))
    mime_type: Mapped[str] = mapped_column(String(80))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    processing_status: Mapped[str] = mapped_column(String(24), default="UPLOADED")
    handwritten: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class DocumentEntity(Base):
    __tablename__ = "document_entities"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(String(36), ForeignKey("documents.id"), index=True)
    entity_type: Mapped[str] = mapped_column(String(40))
    value: Mapped[str] = mapped_column(Text)
    unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    reference_range: Mapped[str | None] = mapped_column(String(64), nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    verification_status: Mapped[str] = mapped_column(String(32), default="NEEDS_REVIEW")
    raw_span: Mapped[str | None] = mapped_column(Text, nullable=True)


class Medication(Base):
    __tablename__ = "medications"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    patient_uuid: Mapped[str] = mapped_column(String(36), ForeignKey("patients.id"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    dosage: Mapped[str] = mapped_column(String(80), default="")
    frequency: Mapped[str] = mapped_column(String(80), default="")
    duration: Mapped[str] = mapped_column(String(80), default="")
    source_type: Mapped[str] = mapped_column(String(32), default="PATIENT_INPUT")
    source_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    verification_status: Mapped[str] = mapped_column(String(32), default="PATIENT_CONFIRMED")
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)


class Allergy(Base):
    __tablename__ = "allergies"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    patient_uuid: Mapped[str] = mapped_column(String(36), ForeignKey("patients.id"), index=True)
    substance: Mapped[str] = mapped_column(String(160))
    reaction: Mapped[str] = mapped_column(String(160), default="")
    source_type: Mapped[str] = mapped_column(String(32), default="PATIENT_INPUT")
    source_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    verification_status: Mapped[str] = mapped_column(String(32), default="PATIENT_CONFIRMED")


class Investigation(Base):
    __tablename__ = "investigations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    patient_uuid: Mapped[str] = mapped_column(String(36), ForeignKey("patients.id"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    value: Mapped[str] = mapped_column(String(80), default="")
    unit: Mapped[str] = mapped_column(String(32), default="")
    observed_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    source_type: Mapped[str] = mapped_column(String(32), default="DOCUMENT")
    source_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.7)
    verification_status: Mapped[str] = mapped_column(String(32), default="NEEDS_REVIEW")


class TimelineEvent(Base):
    __tablename__ = "timeline_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    patient_uuid: Mapped[str] = mapped_column(String(36), ForeignKey("patients.id"), index=True)
    occurred_on: Mapped[date] = mapped_column(Date)
    title: Mapped[str] = mapped_column(String(200))
    detail: Mapped[str] = mapped_column(Text, default="")
    source_type: Mapped[str] = mapped_column(String(32))
    source_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    visit_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    document_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class AiSummary(Base):
    __tablename__ = "ai_summaries"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    visit_id: Mapped[str] = mapped_column(String(36), ForeignKey("visits.id"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    body: Mapped[dict] = mapped_column(JSON, default=dict)
    narrative: Mapped[str] = mapped_column(Text, default="")
    confidence: Mapped[str] = mapped_column(String(32), default="MEDIUM")
    confidence_score: Mapped[float] = mapped_column(Float, default=0.6)
    verification_status: Mapped[str] = mapped_column(String(32), default="AI_DRAFT")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class AiSource(Base):
    __tablename__ = "ai_sources"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    summary_id: Mapped[str] = mapped_column(String(36), ForeignKey("ai_summaries.id"), index=True)
    field: Mapped[str] = mapped_column(String(64))
    value: Mapped[str] = mapped_column(Text)
    source_type: Mapped[str] = mapped_column(String(32))
    source_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.6)
    verification_status: Mapped[str] = mapped_column(String(32), default="AI_DRAFT")


class Conflict(Base):
    __tablename__ = "conflicts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    patient_uuid: Mapped[str] = mapped_column(String(36), ForeignKey("patients.id"), index=True)
    visit_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    field: Mapped[str] = mapped_column(String(64))
    left_value: Mapped[str] = mapped_column(Text)
    right_value: Mapped[str] = mapped_column(Text)
    left_source: Mapped[str] = mapped_column(String(32))
    right_source: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="OPEN")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class RedFlag(Base):
    __tablename__ = "red_flags"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    visit_id: Mapped[str] = mapped_column(String(36), ForeignKey("visits.id"), index=True)
    code: Mapped[str] = mapped_column(String(64))
    label: Mapped[str] = mapped_column(String(240))
    priority: Mapped[str] = mapped_column(String(16), default="HIGH")
    rule_id: Mapped[str] = mapped_column(String(64))
    triggered_by: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class EmergencyAlert(Base):
    __tablename__ = "emergency_alerts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    patient_uuid: Mapped[str] = mapped_column(String(36), ForeignKey("patients.id"), index=True)
    visit_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("visits.id"), nullable=True)
    priority: Mapped[str] = mapped_column(String(16), default="HIGH")
    status: Mapped[str] = mapped_column(String(24), default="ACTIVE", index=True)
    reason: Mapped[str] = mapped_column(Text)
    rule_id: Mapped[str] = mapped_column(String(64))
    acknowledged_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    actor_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(80), index=True)
    resource_type: Mapped[str] = mapped_column(String(40))
    resource_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)


class FhirRecord(Base):
    __tablename__ = "fhir_records"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    patient_uuid: Mapped[str] = mapped_column(String(36), ForeignKey("patients.id"), index=True)
    resource_type: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class ProcessingJob(Base):
    __tablename__ = "processing_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    job_type: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(24), default="QUEUED")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class SystemSetting(Base):
    __tablename__ = "system_settings"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    key: Mapped[str] = mapped_column(String(80), unique=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class OtpChallenge(Base):
    __tablename__ = "otp_challenges"
    __table_args__ = (UniqueConstraint("login_id", name="uq_otp_login"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    login_id: Mapped[str] = mapped_column(String(64), index=True)
    code: Mapped[str] = mapped_column(String(8))
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
