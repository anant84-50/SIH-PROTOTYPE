# Preclinic IQ AI — Database Schema

Internal primary keys: **UUID**.
Patient-facing ID: **PCI-YYYY-XXXXXX** (unique, not the PK).
Timestamps: UTC. API: ISO-8601.

## Enumerations

- `role_name`: ADMIN, DOCTOR, PATIENT
- `complaint_pathway`: FEVER, COUGH_COLD, HEADACHE, ABDOMINAL_PAIN, BODY_JOINT_PAIN, OTHER
- `visit_status`: DRAFT, IN_INTAKE, AWAITING_PATIENT, AWAITING_DOCTOR, VERIFIED, CLOSED
- `verification_status`: AI_DRAFT, PATIENT_CONFIRMED, DOCTOR_VERIFIED, REJECTED, NEEDS_REVIEW
- `confidence_band`: HIGH, MEDIUM, LOW, NEEDS_VERIFICATION
- `conflict_status`: OPEN, PATIENT_CONFIRMED, DOCTOR_CONFIRMED, DISMISSED
- `emergency_status`: ACTIVE, ACKNOWLEDGED, RESOLVED, FALSE_POSITIVE
- `priority`: NORMAL, HIGH, URGENT
- `document_type`: PRESCRIPTION, LAB_REPORT, DISCHARGE_SUMMARY, MEDICAL_CERTIFICATE, IMAGING_REPORT, PREVIOUS_DIAGNOSIS, OTHER
- `source_type`: PATIENT_INPUT, DOCUMENT, PREVIOUS_RECORD, DOCTOR, AI
- `job_status`: QUEUED, RUNNING, SUCCEEDED, FAILED, DEFERRED
- `input_mode`: VOICE, TEXT, TOUCH

## Tables

### users
id UUID PK, login_id TEXT UNIQUE, password_hash TEXT, role role_name, display_name TEXT, email TEXT, phone TEXT, is_active BOOL, totp_secret TEXT NULL, created_at, updated_at

### roles
id UUID PK, name role_name UNIQUE, description TEXT

### patients
id UUID PK, user_id UUID FK users UNIQUE, patient_id TEXT UNIQUE (PCI-…), full_name TEXT, date_of_birth DATE, sex TEXT, language TEXT, phone TEXT, address TEXT, blood_group TEXT, created_at, updated_at

### doctors
id UUID PK, user_id UUID FK users UNIQUE, doctor_id TEXT UNIQUE (DOC-…), full_name TEXT, qualification TEXT, department TEXT, registration_no TEXT, created_at

### visits
id UUID PK, patient_uuid UUID FK patients, doctor_uuid UUID FK doctors NULL, complaint_pathway, chief_complaint TEXT, status visit_status, language TEXT, started_at, closed_at

### consents
id UUID PK, patient_uuid FK, visit_id FK NULL, consent_type TEXT, granted BOOL, granted_at, version TEXT

### conversations / conversation_messages
session for adaptive interview. messages: role (system|assistant|patient), text, input_mode, created_at

### clinical_histories
one current row per visit + version. canonical fields in JSON + columns for chief_complaint, hpi, past_medical_history, past_surgical_history, medications JSON, allergies JSON, family_history, personal_history, review_of_systems JSON, investigations JSON, patient_concerns, version INT, verification_status

### ayush_histories
visit_id FK, prakriti, vikriti, sara, samhanana, pramana, satmya, sattva, ahara_shakti, vyayama_shakti, vaya, ahara, vihara, nidana, samprapti, verification_status, version

### documents
id UUID, patient_uuid, visit_id NULL, document_type, original_filename, storage_key, mime_type, size_bytes, processing_status, handwritten BOOL, created_at

### document_entities
document_id, entity_type, value, unit, reference_range, confidence, verification_status, raw_span

### medications / allergies / investigations
patient-scoped longitudinal facts with source_type, source_id, confidence, verification_status

### timeline_events
patient_uuid, occurred_on DATE, title, detail, source_type, source_id, visit_id, document_id

### ai_summaries
visit_id, version, body JSON, narrative TEXT, confidence, verification_status, created_by

### ai_sources
summary_id, field, value, source_type, source_id, confidence, verification_status

### conflicts
patient_uuid, visit_id, field, left_value, right_value, left_source, right_source, status

### red_flags
visit_id, code, label, priority, rule_id, triggered_by

### emergency_alerts
id, patient_uuid, visit_id, severity/priority, status, reason, rule_id, acknowledged_by, resolved_by, created_at

### audit_logs
actor_user_id, action, resource_type, resource_id, ip, meta JSON, created_at

### fhir_records / processing_jobs / system_settings
adapter payload snapshots; background jobs; key-value settings

## Indexes

patients(patient_id), users(login_id), visits(patient_uuid, status), emergency_alerts(status), audit_logs(created_at), documents(patient_uuid)
