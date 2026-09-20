from typing import Any, Literal

from pydantic import BaseModel, Field

RoleLiteral = Literal["ADMIN", "DOCTOR", "PATIENT"]
PathwayLiteral = Literal[
    "FEVER", "COUGH_COLD", "HEADACHE", "ABDOMINAL_PAIN", "BODY_JOINT_PAIN", "OTHER"
]
VerifyLiteral = Literal["AI_DRAFT", "PATIENT_CONFIRMED", "DOCTOR_VERIFIED", "REJECTED", "NEEDS_REVIEW"]


class LoginIn(BaseModel):
    identifier: str = Field(min_length=3)
    password: str = Field(min_length=1)
    role: RoleLiteral
    otp: str | None = None


class OtpRequestIn(BaseModel):
    identifier: str
    role: RoleLiteral = "PATIENT"


class OtpVerifyIn(BaseModel):
    identifier: str
    code: str
    role: RoleLiteral = "PATIENT"


class RefreshIn(BaseModel):
    refreshToken: str


class PatientCreateIn(BaseModel):
    fullName: str
    dateOfBirth: str | None = None
    sex: str | None = None
    language: str = "en"
    phone: str | None = None
    address: str | None = None
    password: str = Field(min_length=8)
    bloodGroup: str | None = None


class PatientPatchIn(BaseModel):
    fullName: str | None = None
    dateOfBirth: str | None = None
    sex: str | None = None
    language: str | None = None
    phone: str | None = None
    address: str | None = None
    bloodGroup: str | None = None


class VisitCreateIn(BaseModel):
    patientId: str
    complaintPathway: PathwayLiteral
    chiefComplaint: str = ""
    language: str = "en"
    consent: bool = False


class VisitPatchIn(BaseModel):
    status: str | None = None
    chiefComplaint: str | None = None
    doctorUuid: str | None = None
    history: dict[str, Any] | None = None
    ayush: dict[str, Any] | None = None
    conflictId: str | None = None
    conflictStatus: str | None = None


class AiSessionIn(BaseModel):
    visitId: str
    # For returning patients: the previous visit whose verified information
    # should be carried forward, so the interview only asks what may have
    # changed. When set, the session uses the returning-visit question bank.
    reuseFrom: str | None = None


class AiMessageIn(BaseModel):
    sessionId: str
    text: str = ""
    inputMode: Literal["VOICE", "TEXT", "TOUCH"] = "TEXT"
    action: Literal["answer", "repeat", "i_dont_know", "prefer_not_to_answer"] = "answer"
    questionId: str | None = None


class StructureIn(BaseModel):
    visitId: str
    sessionId: str | None = None


class SummaryIn(BaseModel):
    visitId: str


class VerifyIn(BaseModel):
    visitId: str
    action: Literal["PATIENT_CONFIRMED", "DOCTOR_VERIFIED", "REJECTED", "NEEDS_REVIEW"]
    note: str | None = None


class EmergencyTriggerIn(BaseModel):
    patientId: str
    visitId: str | None = None
    text: str = ""
    reason: str | None = None
    priority: Literal["NORMAL", "HIGH", "URGENT"] = "HIGH"


class ResolveIn(BaseModel):
    resolution: Literal["RESOLVED", "FALSE_POSITIVE"] = "RESOLVED"
    note: str | None = None


class UserCreateIn(BaseModel):
    loginId: str
    password: str
    role: RoleLiteral
    displayName: str
    email: str | None = None
    phone: str | None = None


class SummaryPatchIn(BaseModel):
    narrative: str | None = None
    body: dict[str, Any] | None = None


class ProfilePatchIn(BaseModel):
    displayName: str | None = None
    email: str | None = None
    phone: str | None = None
    department: str | None = None
    qualification: str | None = None
