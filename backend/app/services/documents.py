from datetime import date, datetime
from pathlib import Path

from sqlalchemy.orm import Session

from app.config import settings
from app.models.enums import DocumentProcessStatus, JobStatus, SourceType, VerificationStatus
from app.models.tables import (
    Conflict,
    Document,
    DocumentEntity,
    Medication,
    ProcessingJob,
    TimelineEvent,
)
from app.services.providers import get_ocr
from app.services.queue import enqueue


ALLOWED_MIME = {
    "application/pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "text/plain",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
EXT_MIME = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".txt": "text/plain",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
MAX_BYTES = 12 * 1024 * 1024


def sniff_mime(filename: str, claimed: str | None) -> str:
    ext = Path(filename or "").suffix.lower()
    guessed = EXT_MIME.get(ext)
    claimed = (claimed or "").split(";")[0].strip().lower()
    if claimed in ALLOWED_MIME:
        return "image/jpeg" if claimed == "image/jpg" else claimed
    if claimed in {"", "application/octet-stream", "binary/octet-stream"} and guessed:
        return guessed
    if guessed:
        return guessed
    raise ValueError(claimed or "unknown")


def storage_path(key: str) -> Path:
    root = Path(settings.storage_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root / key


def process_document(db: Session, job: ProcessingJob) -> dict:
    doc = db.get(Document, job.payload["documentId"])
    if not doc:
        raise RuntimeError("document missing")
    doc.processing_status = DocumentProcessStatus.PROCESSING.value
    path = storage_path(doc.storage_key)
    data = path.read_bytes() if path.exists() else b""
    result = get_ocr().extract(data, doc.mime_type, doc.original_filename)
    if result.get("documentType") and doc.document_type == "OTHER":
        doc.document_type = result["documentType"]
    doc.handwritten = bool(result.get("handwritten"))
    entities = []
    for raw in result.get("entities") or []:
        ent = DocumentEntity(
            document_id=doc.id,
            entity_type=raw["entityType"],
            value=raw["value"],
            unit=raw.get("unit"),
            reference_range=raw.get("referenceRange"),
            confidence=float(raw.get("confidence") or 0.5),
            verification_status=raw.get("verificationStatus") or VerificationStatus.NEEDS_REVIEW.value,
        )
        db.add(ent)
        entities.append(raw)
        if raw["entityType"] == "medicine":
            _maybe_conflict_medication(db, doc, raw["value"])
            db.add(
                Medication(
                    patient_uuid=doc.patient_uuid,
                    name=raw["value"],
                    dosage=next((e["value"] for e in result["entities"] if e["entityType"] == "dosage"), ""),
                    frequency=next((e["value"] for e in result["entities"] if e["entityType"] == "frequency"), ""),
                    source_type=SourceType.DOCUMENT.value,
                    source_id=doc.id,
                    confidence=float(raw.get("confidence") or 0.5),
                    verification_status=VerificationStatus.NEEDS_REVIEW.value,
                )
            )
    db.add(
        TimelineEvent(
            patient_uuid=doc.patient_uuid,
            occurred_on=date.today(),
            title=f"Document · {doc.document_type.replace('_', ' ').title()}",
            detail=doc.original_filename,
            source_type=SourceType.DOCUMENT.value,
            source_id=doc.id,
            visit_id=doc.visit_id,
            document_id=doc.id,
        )
    )
    doc.processing_status = DocumentProcessStatus.PROCESSED.value
    return {"entities": entities, "documentType": doc.document_type}


def _maybe_conflict_medication(db: Session, doc: Document, extracted_name: str) -> None:
    # If patient previously said "no current medication"
    prior_none = (
        db.query(Medication)
        .filter(Medication.patient_uuid == doc.patient_uuid, Medication.name.ilike("none%"))
        .first()
    )
    if prior_none:
        db.add(
            Conflict(
                patient_uuid=doc.patient_uuid,
                visit_id=doc.visit_id,
                field="medications",
                left_value="No current medication (patient)",
                right_value=extracted_name,
                left_source=SourceType.PATIENT_INPUT.value,
                right_source=SourceType.DOCUMENT.value,
                status="OPEN",
            )
        )


def queue_process(db: Session, document: Document) -> ProcessingJob:
    document.processing_status = DocumentProcessStatus.QUEUED.value
    return enqueue(db, "ocr", {"documentId": document.id}, process_document)
