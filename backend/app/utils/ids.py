from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.tables import Patient


def next_patient_id(db: Session, year: int | None = None) -> str:
    year = year or datetime.utcnow().year
    prefix = f"PCI-{year}-"
    last = (
        db.query(Patient)
        .filter(Patient.patient_id.like(f"{prefix}%"))
        .order_by(Patient.patient_id.desc())
        .first()
    )
    n = 1
    if last:
        try:
            n = int(last.patient_id.split("-")[-1]) + 1
        except ValueError:
            n = db.query(func.count(Patient.id)).scalar() or 1
    return f"{prefix}{n:06d}"


def iso(dt) -> str | None:
    if dt is None:
        return None
    if hasattr(dt, "isoformat"):
        text = dt.isoformat()
        if not text.endswith("Z") and "T" in text:
            return text + "Z" if "+" not in text else text
        return text
    return str(dt)
