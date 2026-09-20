import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, resolve_patient_scope
from app.models.tables import Document, DocumentEntity, User
from app.services.audit import audit
from app.services.documents import MAX_BYTES, queue_process, sniff_mime, storage_path
from app.utils.envelope import ApiError, ok
from app.utils.serialize import document_out, entity_out

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("/upload")
async def upload(
    request: Request,
    patientId: str = Form(...),
    documentType: str = Form("OTHER"),
    visitId: str | None = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    patient = resolve_patient_scope(patientId, user, db)
    data = await file.read()
    try:
        mime = sniff_mime(file.filename or "document", file.content_type)
    except ValueError as exc:
        raise ApiError("FILE_INVALID", f"File type {file.content_type or 'unknown'} is not allowed.") from exc
    if len(data) > MAX_BYTES:
        raise ApiError("FILE_INVALID", "File exceeds 12 MB limit.")
    if len(data) == 0:
        raise ApiError("FILE_INVALID", "Empty file.")
    key = f"{patient.id}/{uuid.uuid4()}_{Path(file.filename or 'document').name}"
    dest = storage_path(key)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    doc = Document(
        patient_uuid=patient.id,
        visit_id=visitId,
        document_type=documentType,
        original_filename=file.filename or "document",
        storage_key=key,
        mime_type=mime,
        size_bytes=len(data),
        processing_status="UPLOADED",
    )
    db.add(doc)
    db.flush()
    audit(db, actor_user_id=user.id, action="document.upload", resource_type="document", resource_id=doc.id, ip=request.client.host if request.client else None)
    try:
        queue_process(db, doc)
    except Exception:
        doc.processing_status = "DEFERRED"
    db.commit()
    db.refresh(doc)
    return ok(document_out(doc))


@router.get("/{document_id}/file")
def download_file(document_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = db.get(Document, document_id)
    if not doc:
        raise ApiError("DOCUMENT_NOT_FOUND", "Document was not found.")
    resolve_patient_scope(doc.patient_uuid, user, db)
    path = storage_path(doc.storage_key)
    if not path.exists():
        raise ApiError("DOCUMENT_NOT_FOUND", "Stored file is missing.")
    audit(db, actor_user_id=user.id, action="document.open", resource_type="document", resource_id=doc.id, ip=request.client.host if request.client else None)
    db.commit()
    return FileResponse(path, media_type=doc.mime_type or "application/octet-stream", filename=doc.original_filename)


@router.get("/{document_id}/view")
def view_document(document_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Authorized inline view (in-app viewers for PDF / image / text).

    Same permission model as download: the caller must be the patient or an
    authorized doctor/admin for that patient's record. Served inline (no
    Content-Disposition) and no filesystem paths are exposed.
    """
    doc = db.get(Document, document_id)
    if not doc:
        raise ApiError("DOCUMENT_NOT_FOUND", "Document was not found.")
    resolve_patient_scope(doc.patient_uuid, user, db)
    path = storage_path(doc.storage_key)
    if not path.exists():
        raise ApiError("DOCUMENT_NOT_FOUND", "This file is no longer available on the server.")
    if path.stat().st_size == 0:
        raise ApiError("FILE_INVALID", "This file is empty or corrupted and cannot be displayed.")
    audit(db, actor_user_id=user.id, action="document.view", resource_type="document", resource_id=doc.id, ip=request.client.host if request.client else None)
    db.commit()
    return FileResponse(path, media_type=doc.mime_type or "application/octet-stream")


@router.get("/{document_id}")
def get_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = db.get(Document, document_id)
    if not doc:
        raise ApiError("DOCUMENT_NOT_FOUND", "Document was not found.")
    resolve_patient_scope(doc.patient_uuid, user, db)
    audit(db, actor_user_id=user.id, action="document.access", resource_type="document", resource_id=doc.id)
    db.commit()
    return ok(document_out(doc))


@router.post("/{document_id}/process")
def process_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = db.get(Document, document_id)
    if not doc:
        raise ApiError("DOCUMENT_NOT_FOUND", "Document was not found.")
    resolve_patient_scope(doc.patient_uuid, user, db)
    try:
        queue_process(db, doc)
    except Exception as exc:  # OCR failure must queue, not crash
        doc.processing_status = "DEFERRED"
        db.commit()
        raise ApiError("OCR_PROVIDER_ERROR", "OCR unavailable. Document has been queued.") from exc
    db.commit()
    return ok(document_out(doc))


@router.get("/{document_id}/entities")
def entities(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = db.get(Document, document_id)
    if not doc:
        raise ApiError("DOCUMENT_NOT_FOUND", "Document was not found.")
    resolve_patient_scope(doc.patient_uuid, user, db)
    rows = db.query(DocumentEntity).filter(DocumentEntity.document_id == doc.id).all()
    return ok({"document": document_out(doc), "entities": [entity_out(e) for e in rows]})
