"""In-process job runner. Replace with Redis + Celery/RQ when REDIS_URL is set."""

from __future__ import annotations

from datetime import datetime
from typing import Callable

from sqlalchemy.orm import Session

from app.models.enums import JobStatus
from app.models.tables import ProcessingJob


def enqueue(db: Session, job_type: str, payload: dict, runner: Callable[[Session, ProcessingJob], dict]) -> ProcessingJob:
    job = ProcessingJob(job_type=job_type, status=JobStatus.QUEUED.value, payload=payload)
    db.add(job)
    db.flush()
    job.status = JobStatus.RUNNING.value
    try:
        job.result = runner(db, job) or {}
        job.status = JobStatus.SUCCEEDED.value
    except Exception as exc:  # noqa: BLE001 — isolate worker failures
        job.status = JobStatus.FAILED.value
        job.error = str(exc)
    job.finished_at = datetime.utcnow()
    return job
