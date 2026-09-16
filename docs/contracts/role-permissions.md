# Preclinic IQ AI — Role Permissions

Roles (enum `RoleName`): `ADMIN` | `DOCTOR` | `PATIENT`

Frontend UI hiding is **not** security. Every protected API re-checks these rules.

## ADMIN

- Full user directory (create/disable users, assign roles)
- System health, settings, audit logs
- All emergency alerts (acknowledge/resolve)
- Cannot silently alter doctor-verified clinical facts without audit
- 2FA mandatory in production (`REQUIRE_ADMIN_2FA=true`)

## DOCTOR

- Own queue and assigned / institution patients
- Read clinical history, AYUSH history, timeline, documents, summaries
- Verify / reject AI summaries (`DOCTOR_VERIFIED` | `REJECTED`)
- Confirm or dismiss conflicts
- Acknowledge / resolve emergencies for authorized patients
- **Must not** access unassigned patients (prototype: all doctors in same institute may read institute patients; cross-patient isolation still applies to patients)

## PATIENT

- Own profile, visits, documents, timeline, consents only
- Own AI interview session
- Confirm own draft summary (`PATIENT_CONFIRMED`)
- **Never** another patient's record

## Shared rules

- AI services never write `DOCTOR_VERIFIED` records
- AI never calls the database directly — only application services do
- Patient-facing ID is `PCI-YYYY-XXXXXX`; internal PK is UUID
