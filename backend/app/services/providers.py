"""Provider abstractions. Frontend never calls these. Swap mock → production later."""

from __future__ import annotations

from abc import ABC, abstractmethod


class AIProvider(ABC):
    @abstractmethod
    def structure_history(self, answers: dict, pathway: str) -> dict: ...

    @abstractmethod
    def generate_summary(self, context: dict) -> dict: ...


class SpeechToTextProvider(ABC):
    @abstractmethod
    def transcribe(self, audio_bytes: bytes, mime: str) -> str: ...


class TextToSpeechProvider(ABC):
    @abstractmethod
    def synthesize(self, text: str) -> bytes: ...


class OCRProvider(ABC):
    @abstractmethod
    def extract(self, file_bytes: bytes, mime: str, filename: str) -> dict: ...


class MockAIProvider(AIProvider):
    def structure_history(self, answers: dict, pathway: str) -> dict:
        hpi_bits = []
        meds, allergies = [], []
        pmh = psh = family = personal = concerns = chief = ""
        ros: dict = {}
        for qid, payload in answers.items():
            value = payload.get("value") if isinstance(payload, dict) else payload
            field = payload.get("field") if isinstance(payload, dict) else "hpi"
            if value in (None, "", "skip"):
                continue
            text = str(value)
            if field == "chiefComplaint":
                chief = text
            elif field == "hpi":
                hpi_bits.append(f"{qid.replace('_', ' ')}: {text}")
            elif field == "medications":
                if text.lower() not in {"none", "no", "nil"}:
                    meds.extend([m.strip() for m in text.replace(";", ",").split(",") if m.strip()])
            elif field == "allergies":
                if text.lower() not in {"none", "no", "nil"}:
                    allergies.extend([a.strip() for a in text.replace(";", ",").split(",") if a.strip()])
            elif field == "pastMedicalHistory":
                pmh = (pmh + "; " if pmh else "") + text
            elif field == "pastSurgicalHistory":
                psh = text
            elif field == "familyHistory":
                family = text
            elif field == "personalHistory":
                personal = (personal + "; " if personal else "") + text
            elif field == "patientConcerns":
                concerns = text
            elif field == "reviewOfSystems":
                ros[qid] = text
        return {
            "chiefComplaint": chief or pathway.replace("_", " ").title(),
            "hpi": ". ".join(hpi_bits),
            "pastMedicalHistory": pmh,
            "pastSurgicalHistory": psh,
            "medications": meds,
            "allergies": allergies,
            "familyHistory": family,
            "personalHistory": personal,
            "reviewOfSystems": ros,
            "investigations": [],
            "patientConcerns": concerns,
        }

    def generate_summary(self, context: dict) -> dict:
        hist = context.get("structuredHistory") or {}
        pathway = context.get("complaintPathway", "OTHER")
        name = context.get("patientName") or "The patient"
        hpi = hist.get("hpi") or "History is still being completed."
        narrative = (
            f"{name} presents with a chief complaint of "
            f"{hist.get('chiefComplaint') or pathway.replace('_', ' ').lower()}. {hpi} "
            "This is an AI-prepared pre-clinical summary for the consulting practitioner. "
            "It is not a diagnosis and must not be used to prescribe treatment."
        )
        answered = sum(1 for v in (context.get("answers") or {}).values() if v)
        score = min(0.92, 0.45 + answered * 0.05)
        band = "HIGH" if score >= 0.8 else "MEDIUM" if score >= 0.6 else "LOW"
        return {
            "schemaVersion": "1.0.0",
            "narrative": narrative,
            "structuredHistory": hist,
            "ayush": context.get("ayush") or {},
            "confidence": band,
            "confidenceScore": round(score, 2),
            "verificationStatus": "AI_DRAFT",
            "disclaimer": (
                "AI prepares structured context. It does not diagnose or prescribe. "
                "A registered practitioner must verify."
            ),
        }


class MockSTT(SpeechToTextProvider):
    def transcribe(self, audio_bytes: bytes, mime: str) -> str:
        # Browser sends a transcript alongside audio in the prototype.
        return ""


class MockTTS(TextToSpeechProvider):
    def synthesize(self, text: str) -> bytes:
        return b""


class MockOCR(OCRProvider):
    def extract(self, file_bytes: bytes, mime: str, filename: str) -> dict:
        name = filename.lower()
        entities = []
        doc_type = "OTHER"
        if "lab" in name or "report" in name:
            doc_type = "LAB_REPORT"
            entities = [
                {"entityType": "laboratory_test", "value": "HbA1c", "unit": "%", "referenceRange": "4.0–5.6", "confidence": 0.78},
                {"entityType": "value", "value": "6.4", "unit": "%", "referenceRange": "4.0–5.6", "confidence": 0.74},
            ]
        elif "rx" in name or "presc" in name:
            doc_type = "PRESCRIPTION"
            entities = [
                {"entityType": "medicine", "value": "Metformin", "unit": None, "referenceRange": None, "confidence": 0.86},
                {"entityType": "dosage", "value": "500mg", "unit": "mg", "referenceRange": None, "confidence": 0.81},
                {"entityType": "frequency", "value": "twice daily", "unit": None, "referenceRange": None, "confidence": 0.72},
            ]
        elif "discharge" in name:
            doc_type = "DISCHARGE_SUMMARY"
            entities = [{"entityType": "diagnosis", "value": "Previous admission — see source", "confidence": 0.55}]
        else:
            entities = [{"entityType": "note", "value": f"Document queued: {filename}", "confidence": 0.4}]
        handwritten = "hand" in name or mime.startswith("image/")
        for e in entities:
            e.setdefault("verificationStatus", "NEEDS_REVIEW" if handwritten or e["confidence"] < 0.8 else "AI_DRAFT")
            e.setdefault("unit", None)
            e.setdefault("referenceRange", None)
        return {"documentType": doc_type, "handwritten": handwritten, "entities": entities}


class FHIRAdapter(ABC):
    @abstractmethod
    def export_patient(self, patient: dict) -> dict: ...


class ABDMAdapter(ABC):
    @abstractmethod
    def health_id_status(self, patient_id: str) -> dict: ...


class MockFHIRAdapter(FHIRAdapter):
    def export_patient(self, patient: dict) -> dict:
        return {
            "resourceType": "Patient",
            "id": patient.get("id"),
            "identifier": [{"system": "https://preclinic.ayush.gov.in/patient-id", "value": patient.get("patientId")}],
            "name": [{"text": patient.get("fullName")}],
        }


class MockABDMAdapter(ABDMAdapter):
    def health_id_status(self, patient_id: str) -> dict:
        return {"linked": False, "abha": None, "patientId": patient_id, "mode": "mock"}


def get_ai() -> AIProvider:
    return MockAIProvider()


def get_ocr() -> OCRProvider:
    return MockOCR()


def get_stt() -> SpeechToTextProvider:
    return MockSTT()


def get_fhir() -> FHIRAdapter:
    return MockFHIRAdapter()


def get_abdm() -> ABDMAdapter:
    return MockABDMAdapter()
