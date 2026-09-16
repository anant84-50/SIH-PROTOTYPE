"""Queue workers. Heavy OCR / summary / FHIR jobs run here.

When REDIS_URL is configured, swap app.services.queue.enqueue for Celery/RQ.
The in-process runner is the offline fallback so the API never hard-stops.
"""
