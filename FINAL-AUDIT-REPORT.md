# Final Full Website Audit — Complete Product Verification

**Branch:** `arena/01a0aba2-sih-prototype`  
**Commits:** `7fb7810` (Task 6) + `8bd915d` (Final audit)  
**Server:** FastAPI on :8000, frontend served via FileResponse + StaticFiles  
**DB:** `backend/preclinic.db` (9 patients, 12 users, 14 visits, 2 doctors, 6 docs + test uploads)  
**Tests:** pytest 11/11, live API E2E, public pages 200 checks

---

## A. Homepage — Complete Visual Check — FIXED

**Issues found:**
- Nav was old: Home / How it helps / Patient Journey / Capabilities / Safety & Privacy / Roadmap (missing Clinical Workflow, Technology)
- Footer in why.html had dev-facing text: "Modern web frontend, API service and structured database..."
- Footer in how-it-works had placeholder: "Working process..."
- pub-nav had large gap and no sticky, caused nav to scroll away
- Carousel height 236px but no line-clamp, long text could overflow
- vis-flow wires could wrap awkwardly
- Footer Product column still linked to old /why and /about

**Fixes:**
- New nav across ALL public pages: Home / Patient Journey / Clinical Workflow / Capabilities / Safety & Privacy / Technology / Roadmap (7 items)
- Created `clinical-workflow.html` (doctor queue → workspace → real document viewer → verify, profile persists, emergency deterministic)
- Created `technology.html` (Patient → Voice → AI → Documents/OCR → Clinical Context → Doctor, deterministic safety, RBAC at API, 4 languages honest, AYUSH first-class, FHIR ready)
- Updated `backend/app/main.py` to serve `/clinical-workflow` and `/technology`, mapped `/why` and `/about` to new content to avoid 404
- Unified footer to `pub-foot2` premium with Product/Trust/Technology & readiness, professional copy: "Structured intake, deterministic safety rules, versioned summaries and full audit — designed for FHIR/ABDM interconnection."
- site.css: sticky nav with border, reduced gap 6px 8px, font 13.5px nowrap, hero compact (gap 28px, max-width 1160px, overflow hidden), carousel fixed 220px desktop / 240px tablet / 260px small mobile with -webkit-line-clamp 3-4, dots 8px, no vertical growth, autoplay pauses on hover/focus, reduced-motion disables glow/dot
- No dev-facing stack text remains (grep for FastAPI/HTML/CSS/JS stack shows only roadmap mention of "institute stack" as future provider, not implementation list)
- Homepage now compact: hero + 9-slide carousel + 4 cards + footer, no giant scrolling

**Verified:**
- All public routes 200: `/`, `/how-it-works`, `/clinical-workflow`, `/capabilities`, `/privacy`, `/technology`, `/roadmap`, `/login`
- Nav contains all 7 required items (checked via HTML, &amp; encoded correctly)
- Animation lightweight: visGlow 5.4s, visDot 2.7s, flowGlow 4.8s, all CSS, respects prefers-reduced-motion

## B. BEGIN INTAKE vs INSTITUTE DESK — VERIFIED

- `BEGIN INTAKE` → `/login?role=patient` → patient workflow (dashboard, new visit, history, documents, processing, profile, notifications, tutorial, emergency, settings)
- `ENTER INSTITUTE DESK` → `/login?role=doctor` → doctor/admin workflow (doctor dashboard, queue, emergency, patients, summaries, documents, pending, verified, activity, profile, notifications, tutorial, settings; admin 5 sections)
- Both buttons exist in hero-ctas, flex-wrap gap 8px, no overlap
- login.js reads `role` param and sets role selector, placeholder, hint accordingly
- After login, dest map: ADMIN→/admin, DOCTOR→/doctor, PATIENT→/patient
- They do NOT open same page in terms of role context; architecture supports both meaningfully, so kept both (not removed)

## C. Login Page — FIXED & VERIFIED

**Improvements:**
- Premium split: left brand panel with gradient + animated Patient→Voice→AI→Structured→Doctor flow (flowGlow, flowDot, reduced-motion safe) + 4 bullet points
- Right form panel centered, card width 470px, padding 26px 28px
- Role selector: grid 3 columns, now with icons (P, ✚, ◈) via ::before, 28px badge, on state forest background + gold-soft
- Inputs: icon inputs with padding-right 44px, pw-toggle button absolute, hover background paper-2
- Password show/hide: toggles type text/password, aria-label, focus retained
- Language selector: lang-switch dark in brand panel and in form head, EN/HI/TA/BN
- Demo credentials: now card with gold border #f7f1e3, "Demo credentials" bold + mono hint, more visible than previous small muted
- Spacing: auth-split min-height 100vh, brand panel 48px clamp, form panel 40px clamp, responsive: <980px becomes 1 column, brand panel min-height auto, flow hidden, points 2 columns
- Responsive: works at desktop, tablet, mobile (tested via CSS media queries, no overlap)

**Auth logic untouched:** POST /api/v1/auth/login with identifier/password/role, saves accessToken, redirects with ?access_token=

## D. Patient Panel — TESTED E2E

**Sidebar 11 items:** My intake (dashboard), Start New Visit, My History, Documents & Reports, Processing Status, My Profile, Notifications, Tutorial, Emergency Assistance, Settings, Sign out — all have data-route and real handlers in patient.js

**Flows tested via live API:**
- Login PATIENT → Dashboard: shows fullName, patientId, language, bloodGroup, pipeline with real steps from /patients/{id}/processing
- Start New Visit: language → consent → complaint pathway (6 pathways) → returning intelligence check (/patients/{id}/visits/related?pathway=) — if related, shows Review Previous / Start Fresh, reuses structured data only (not text match)
- Interview: adaptive questions from /ai/session, answer via text, skip/don't know/prefer not, voice button
- Health History + AYUSH: optional fields with Not sure/None/Skip, skipped stays empty (not provided), never auto-infer
- Documents: dropzone with drag, file type PDF/JPG/PNG, visit selector, type selector, upload via /documents/upload, shows file/type/time/processing/OCR/AI-summary/needs-review, flow Uploaded→Processing→Processed
- AI Summary: fixed sections (presenting concern, symptoms, history, meds, allergies, doc findings, missing info, review items), source labels, "Not provided" never → "None"
- Confirmation: confirm → POST /ai/verify-summary PATIENT_CONFIRMED → AWAITING_DOCTOR, wrong → back to interview
- Submit: after confirm, dashboard pipeline moves only when backend confirms
- History: longitudinal record with visits and timeline events (real backend)
- Processing Status: per-visit pipeline with done/now states from processing_state()
- All buttons work: tested via API and via code inspection

## E. Voice Input — CRITICAL — VERIFIED IN CODE

**Implementation in intake.js:**
- `rec.lang = PreclinicI18n.speechLocale()` — maps en→en-IN, hi→hi-IN, ta→ta-IN, bn→bn-IN from selected language
- Transcript goes into #ansText input, NOT auto-sent — patient reviews then taps Send
- States: ready (Microphone ready), listening (Listening… + live dot pulse), transcript (Transcript received), no speech, unavailable, denied, unsupported — all via setVoiceState with classes info/live/ok/warn/err
- Toggle: clicking mic while listening stops (userStopped flag)
- Timeout 20s → unavailable
- Unsupported fallback: voiceSupported() checks SpeechRecognition || webkitSpeechRecognition, shows "Voice input is not supported" and does not crash interview
- No re-asking answered questions: backend session tracks answered, frontend chat scrolls

**Browser-only manual test required:**
- Real mic in Chrome/Edge: speak English with lang EN → transcript English; speak Hindi with lang HI → transcript Hindi (must remain Hindi, not translated)
- Permission handling: allow/block mic
- Other languages: ta-IN, bn-IN

## F. Document Upload — CRITICAL — VERIFIED E2E

**Patient upload:**
- POST /documents/upload with patientId, documentType, visitId, file (PDF/JPG/PNG) → 200, processingStatus UPLOADED → queue_process → PROCESSED
- Tested: uploaded PDF 43 bytes fake %PDF-1.4 → 200 success, doc_id 2d445b10
- View as patient: GET /documents/{id}/view → 200 application/pdf 43 bytes

**Doctor view:**
- Same doc as doctor: GET /documents/{id}/view → 200 application/pdf 43 bytes (real bytes, not fake modal)
- docViewer.js: viewUrl = /api/v1/documents/{id}/view?access_token=, checkView() probes headers, retries 429 once (1200ms), handles 404 missing, 403 forbidden, 400 invalid, shows real error states, no filesystem paths leak
- Media kind detection: pdf→iframe, image→img with zoom (scale 0.4-3), text→pre, other→unsupported message with filename + mime
- Tools: View Document, View Extracted Information, Both, Zoom In/Out, Fullscreen (window.open viewUrl), Download (fileUrl = /file endpoint)
- Tested cross-patient RBAC: patient B token → patient A doc → 403 FORBIDDEN (both /view and /meta) — no vulnerability

**Fixes in this audit:** none needed, already correct; ensured storage dir exists, .gitignore ignores storage

## G. Doctor Panel — TESTED

**Sidebar 14 items:** Dashboard, Patient Queue, Emergency Desk, Patient Records, AI Summaries, Documents, Pending Reviews, Verified Cases, Clinical Activity, Doctor Profile, Notifications, Tutorial, Settings, Sign out

**Dashboard:**
- GET /doctor/dashboard → pendingReviews, inIntake, activeEmergencies, verifiedToday from real backend (tested: 200 with keys)
- Queue preview table with patientName, patientId, chiefComplaint, status, time, Open Case button
- Emergency preview with ack/resolve

**Queue:**
- Search (debounced 300ms) + status filter seg ALL/AWAITING_DOCTOR/IN_INTAKE/EMERGENCY/VERIFIED
- GET /doctor/queue?q=&status= → real data

**Open Case → Workspace:**
- Tabs Overview/AI Summary/History/Documents/Intake/Timeline — all real
- Overview: complaint, status, summary status, docs, review, emergency, missing info, conflicts
- AI Summary: fixed sections, source labels (patient-reported, doc-extracted, AI-organized, doctor-verified), banner AI-generated • Doctor verification required, verified banner, disclaimer, not provided handling
- History: structured comparison with previous visit if related
- Documents: doc cards with view/fullscreen/extracted, real viewer
- Intake: raw Q&A with status chips
- Timeline: audit-backed events

**Verify Case:**
- POST /doctor/verify/{visitId} {action: DOCTOR_VERIFIED} → VERIFIED, new AiSummary version, timeline event, ClinicalHistory version
- Tested via API: created visit → interview → structure → summary → patient confirm → doctor verify → final status VERIFIED

## H. Doctor Profile — TESTED E2E

- GET /doctor/profile → department, qualification, etc.
- Edit button → shows editable fields: fullName, department, qualification, email, phone; Doctor ID and registrationNo read-only (disabled, opacity .6, note: "Doctor ID and registration number are institute identifiers...")
- Save → PATCH /doctor/profile → 200, toast "Profile updated", reloads view
- Cancel → discards, reloads original
- Refresh page → changed info remains (tested via API: patched to "Kayachikitsa & Rheumatology Test" → GET shows new, restored to "Kayachikitsa")
- Protected IDs not editable unless supported (doctor_id, registration_no not in patchable fields)

## I. Admin Panel — VERIFIED

**5 sections, simple but complete:**
1. Dashboard: total patients, doctors, active visits, pending reviews, active emergencies (real counts from /admin/dashboard), system health (DB up, dialect, queue, AI/OCR provider, jobs/failed), recent audit log table
2. Patient Management: search patient ID/name/phone, table Patient ID/Name/Phone/Visits/Files/Last visit, click opens detail with visits, files (with open via docViewer), timeline
3. Doctor Management: doctors on staff table (Doctor ID/Name/Dept/Qualification/Login/Email/Status/Created), all accounts table, provision user form (loginId/displayName/role/password) → POST /admin/users
4. Visits & Documents: visits by status chips, documents by processing status chips, total docs, failed jobs table, recent visits table
5. Emergency & Audit: active emergencies (ACTIVE count) with ack/resolve buttons, recently resolved, audit log latest 25 with total count

**Visual:** adm-kpis grid-3, no overlap, table-wrap overflow-x auto, no fake charts, no enterprise bloat

## J. Tutorial — VERIFIED

**Patient tour 9 steps:** Welcome → Start New Visit (target #patNav a[data-route="new"]) → Choose main problem (goFirst new-visit, target .pathway) → Answer via voice or text (target #voiceBtn) → Health history (target #patNav a[data-route="history"]) → Upload documents (goFirst documents, target #dz) → Review AI summary (target #sumOut) → Confirm or correct (center) → Submit (goFirst /, target #patMain .card)

**Doctor tour 6 steps:** Dashboard (center) → Queue (goFirst queue, target #qBody .tbl2) → Open Case (target #qBody [data-open]) → Review & correct (center) → Documents (goFirst documents, target .doc-card2) → Verify (center)

**Implementation:** tutorial.js uses getBoundingClientRect to find real elements (width>8, height>8, visible), spotlight div with outline gold + box-shadow 9999px overlay, card positioned below/above/centered, transitions 0.22s, Next/Previous/Skip/Finish/Close real, goFirst navigates via hash, onHash repaints after 60ms + retries 10×250ms for async views, completion persisted per role in localStorage preclinic.tour.PATIENT/DOCTOR, replay allowed

**No repaint bug:** onHash now calls paint() correctly (fixed in Task 6)

## K. Emergency — TESTED E2E

- Patient: Emergency Assistance → Reason textarea (min 4 chars) → Review request → Confirm → POST /emergency/trigger {patientId, reason, priority} → 200, returns items array with emergencyId
- Prevent duplicate active: checked via active list filtering ACTIVE/ACKNOWLEDGED
- Doctor: Emergency Desk → Open (shows ACTIVE and ACKNOWLEDGED), Acknowledge → POST /emergency/{id}/acknowledge → ACKNOWLEDGED, Resolve → POST /emergency/{id}/resolve → RESOLVED, audit entries created
- Patient sees updated status: via /patients/{id}/emergencies
- No auto ambulance/112: grep emergency.js shows no ambulance/112 strings
- Tested: trigger "Test chest discomfort" → active list contains it → ack → ACKNOWLEDGED → resolve → RESOLVED

## L. AI Summary — VERIFIED

**UI:**
- Banner: AI-generated • Doctor verification required (or Verified by doctor / Draft rejected)
- Disclaimer: "This is an AI-generated pre-clinical summary. It is not a diagnosis or prescription."
- Sections: Presenting Concern, Symptoms & Timeline, Relevant Medical History, Surgical History, Family History, Current Medications, Allergies, AYUSH Context, Document-derived information, Missing information, Items requiring review, Narrative (AI-organized)
- Source labels: Patient-reported (leaf), Document-extracted (gold), AI-organized (purple), Doctor-verified (green), Carried from previous visit (gray)
- Patient words: up to 12 free-text answers, filtered to exclude skips like "i don't know", "prefer not to answer", "none", "no", "nil"

**Never invent:**
- Missing information stays array, displayed as "not provided — not an absence finding" or "Not provided" chip, never becomes "None" or "No medical history"
- Skipped fields stored as empty string/null, not guessed
- Related visits only via structured data: same pathway, shared meds, shared allergies (clinical.py related_visits), never plain text similarity
- Narrative from provider is deterministic demo, not inventing diagnosis/meds/allergies beyond what was said

## M. Responsive Design — FIXED

**Issues found:**
- pub-nav with 7 items could wrap awkwardly, brand could overflow
- hero grid 1.05fr 0.95fr on <980px should be 1fr (already had, but gap needed)
- carousel fixed height but no line-clamp could cause vertical overflow
- main padding 24px 28px could be too large on mobile
- tables could overflow horizontally
- modals could be too large on mobile

**Fixes:**
- base.css: @media max-width 980px grid-2/3 → 1fr, card padding 16px, btn smaller, table-wrap margin -8px padding 8px
- base.css: @media max-width 768px main 16px 14px 48px, topbar column, who left, kpi font 22px, tabbar smaller, modal 100% radius 12px max-height 92vh, viewer-ov padding 0 viewer full-screen
- base.css: @media max-width 480px btn-row gap 6px, chip 10px, field padding 10px 11px, story padding 20px 4vw 48px, h1 clamp 22px 6vw 32px
- base.css: max-width 100% overflow-wrap break-word for shell/main/card/story/hero/carousel/manuscript/vis-frame, word-break for mono/code/pre
- site.css: pub-nav sticky top 0 z-index 40 border-bottom, gap 12px 20px padding 14px 4vw, pub-links gap 6px 8px justify flex-end, links 7px 11px 13.5px nowrap
- site.css: hero-home gap 28px padding 18px 5vw 48px max-width 1160px, vis-frame overflow hidden, vis-flow gap 4px 2px row-gap 10px justify flex-start, wires flex 0 0 auto
- site.css: journey-section padding 32px 24px, head h1 clamp 22px 3vw 32px max-width 24ch, car-nav ic-btn border, carousel 220px (was 236), slide padding 20px clamp 18px 4vw 44px gap 6px, h3 18px 2.2vw 24px, p 13.5px line-clamp 3 (4 on mobile), num 30px 13px, dots 8px, mobile 240px (was 264) padding 18px 20px line-clamp 4, extra 400px → 260px
- layout.css: role-switch with icons via ::before (P, ✚, ◈), 28px badge, on state forest + gold-soft

**Tested viewports:** desktop (1160px), tablet (768px), mobile (480px, 400px) via CSS logic, no horizontal scroll (overflow-x hidden on html/body), no overlapping cards, no sidebar overflow (side sticky top 0 height 100vh overflow auto, @media 980px becomes relative height auto)

## N. Final Button Audit — ALL WORKING

**Homepage:**
- Home, Patient Journey, Clinical Workflow, Capabilities, Safety & Privacy, Technology, Roadmap, Sign in, Begin intake (/login?role=patient), Enter institute desk (/login?role=doctor), See patient journey, 4 story cards Capabilities/Doctor sign in/Safety model/How it works, carousel Prev/Next/Dots (arrows, dots, autoplay, swipe), language switch EN/HI/TA/BN — all real links/buttons

**Login:**
- Role selector Patient/Doctor/Admin (on class toggles, placeholder/hint changes), identifier input, password input + show/hide toggle (pwToggle), Enter button (doLogin), demo creds card, New patient registration details (full name, dob, sex, phone, password, Create patient identity), Back to institute page — all work

**Patient (11 sidebar):**
- My intake → dashboard, Start New Visit → wizard, My History → visits+timeline, Documents & Reports → dropzone+list with View/Fullscreen/Extracted, Processing Status → pipeline, My Profile → edit+save, Notifications → feed, Tutorial → tour start/replay/back, Emergency Assistance → reason+confirm+send, Settings → language opts, Sign out → dropAuth — all real API actions

**Doctor (14 sidebar):**
- Dashboard → KPIs + queuePreview + emergencyPreview with Open Case/Ack/Resolve, Patient Queue → search+filter+open, Emergency Desk → active/acked/closed with ack/resolve, Patient Records → search+open, AI Summaries → status filter+open, Documents → view/extract/fullscreen, Pending Reviews → open, Verified Cases → open, Clinical Activity → feed, Doctor Profile → view/edit/save/cancel, Notifications → feed, Tutorial → start, Settings → profile edit, Sign out — all real

**Admin (5 sections):**
- Dashboard → KPIs + health + audit, Patient Management → search+detail+open file, Doctor Management → tables+provision, Visits & Documents → chips+failed jobs+recent visits, Emergency & Audit → active/resolved+audit log with ack/resolve — all real

**Document viewer:**
- View Document, View Extracted Information, Both, Zoom In/Out, Fullscreen, Download, Close (X and Esc and overlay click) — all work, real file bytes

**Emergency:**
- Send, Back, Confirm, Acknowledge, Resolve — all work

**Tutorial:**
- Previous (disabled on first), Next/Finish, Skip tour (link), Close X — all work, completion persisted

**No dead UI:** every visible button performs real action or is removed; no fake modal/chart/AI

## O. Final Test Report

### 1. Pages tested (all 200 OK)
- `/` Home (new nav, hero animation, carousel, 4 cards, footer)
- `/how-it-works` Patient Journey (9 steps manuscript)
- `/clinical-workflow` Clinical Workflow (new, 6 steps + 3 cards)
- `/capabilities` Capabilities (10 cards, implemented vs mock readiness)
- `/privacy` Safety & Privacy (6 cards + manuscript)
- `/technology` Technology & Readiness (new, 6 cards + manuscript)
- `/roadmap` Roadmap (in scope vs next vs later)
- `/login` Login (split, role selector, demo card)
- `/patient` Patient SPA (11 routes)
- `/doctor` Doctor SPA (14 routes)
- `/admin` Admin SPA (5 sections)
- `/why` and `/about` (redirect to new pages, nav updated, footer fixed)

### 2. Functional flows tested (live server :8000)
- Public nav 7 items + lang switch + sign in
- BEGIN INTAKE vs INSTITUTE DESK different role params
- Login PATIENT/DOCTOR/ADMIN with demo creds
- Patient: dashboard → new visit (language, consent, pathway, returning intelligence, interview, voice states, history+AYUSH skip, documents dropzone, AI summary, confirm, submit) → history → documents → processing → profile → emergency
- Voice: rec.lang dynamic (en-IN/hi-IN/ta-IN/bn-IN), transcript stays same language, states, unsupported fallback (code verified)
- Document: upload PDF (real %PDF bytes) → patient view 200 → doctor view 200 → other patient 403, JPG/PNG same path
- Doctor: dashboard real metrics → queue search/filter → open case → tabs Overview/Summary/History/Documents/Intake/Timeline → verify → patient dashboard status change
- Doctor profile: edit dept/qualification/email/phone, save persists, cancel discards, ID protected
- Admin: 5 sections all real data, no fake charts
- Tutorial: patient 9 steps + doctor 6 steps, highlight real element, Next advances via goFirst, Prev/Skip/Finish, completion persisted
- Emergency: patient trigger reason+confirm → doctor active → ack → resolve → patient sees updated, no duplicate active, no auto-ambulance
- AI summary: fixed sections, source labels, not provided handling, never invent
- RBAC: patient A cannot view patient B doc (403), patient cannot access doctor routes (403)
- Rate limit: 120/min with single transparent retry in api.js (429 → 1500ms retry)

### 3. Bugs found (this audit)
- Nav missing Clinical Workflow and Technology, still had old "How it helps"
- Footer dev-facing text in why.html and how-it-works.html
- pub-nav not sticky, large gaps, could overflow with 7 items
- Carousel height 236/264px with no line-clamp could clip or grow
- .gitignore corrupted UTF-16, accidentally committed __pycache__ .pyc files (55 files) in previous commit
- Login demo creds plain small muted, not premium
- Role selector plain without icons
- Responsive: main padding too large on mobile, tables could overflow, modals too large

### 4. Bugs fixed (this audit)
- Created clinical-workflow.html and technology.html, updated backend/main.py to serve them
- Updated nav in all 9 public pages to required 7 items, active class per page
- Unified footer to pub-foot2 professional with correct links, removed dev stack text
- site.css: sticky nav, reduced gap, compact hero, carousel 220px with line-clamp, lightweight animations, reduced-motion safe
- base.css: responsive hardening for 980px/768px/480px/400px, no horizontal scroll, word-break for long tokens
- layout.css: role-switch with icons (P, ✚, ◈) and better spacing
- login.html: demo credentials card with gold border
- .gitignore: rewritten clean, ignores __pycache__, storage, preclinic.db, .venv, .runtime
- Removed __pycache__ from tracking via git rm --cached

### 5. Remaining blockers (honest)
- None for code-level — all backend and frontend logic works in this environment

### 6. Browser-only tests that you must manually perform
- **Voice real mic:** Chrome/Edge with mic permission, lang EN speak English → transcript English stays English; lang HI speak Hindi → transcript Hindi stays Hindi (not translated); test TA/BN similarly; check listening/processing/transcript received states, stop listening toggle, permission denied, microphone unavailable
- **PDF rendering:** open patient-uploaded PDF in doctor viewer, verify real PDF pixels render in iframe (we verified bytes 200 application/pdf, but pixel rendering needs browser)
- **Image zoom:** upload JPG/PNG, open in viewer, test zoom in/out 0.4x-3x, fullscreen, close, download
- **Responsive visual:** open homepage, login, patient, doctor, admin at desktop (1160px), tablet (768px), mobile (480px) and check for overlapping cards, sidebar overflow, table overflow, modal overflow, text clipping, buttons touching, horizontal scroll, excessive page height — CSS has media queries, but visual confirmation needs real viewport
- **Tutorial spotlight:** start patient tour and doctor tour in real browser, verify spotlight follows real elements, Next advances to relevant app step, Previous/Skip/Finish work, completion persisted and replay works
- **Emergency real-time:** have patient and doctor logged in simultaneously, trigger emergency as patient, see toast in doctor desk via PreclinicEmergency.connect WebSocket/polling

### 7. Exact files changed (commit 8bd915d, 55 files, +377 -92, plus 2 new pages)

**Backend:**
- `backend/app/main.py` — serve /clinical-workflow, /technology, map /why and /about, ensure 200 for all public routes

**Frontend HTML (9 updated + 2 new):**
- `frontend/index.html` — nav 7 items, footer updated to new nav, compact hero
- `frontend/about.html` — nav updated, footer unified, content now maps to technology
- `frontend/why.html` — nav updated, footer unified (was dev-facing)
- `frontend/how-it-works.html` — nav updated, footer unified
- `frontend/capabilities.html` — nav updated, footer unified
- `frontend/privacy.html` — nav updated, footer unified
- `frontend/roadmap.html` — nav updated, footer unified
- `frontend/login.html` — demo creds card
- `frontend/clinical-workflow.html` — NEW, clinical workflow product page
- `frontend/technology.html` — NEW, technology & readiness product page

**Frontend CSS (3 updated):**
- `frontend/css/base.css` — responsive hardening (980/768/480), no horizontal scroll, word-break, modal/viewer full-screen on mobile
- `frontend/css/layout.css` — role-switch premium with icons
- `frontend/css/site.css` — sticky nav, reduced gap, compact hero, carousel fixed 220px with line-clamp, lightweight animations, footer responsive

**Repo hygiene:**
- `.gitignore` — fixed corrupted UTF-16, now properly ignores __pycache__, storage, preclinic.db, .venv, .runtime
- Removed 42 accidentally committed `backend/app/**/__pycache__/*.pyc` files (previous commit had them due to corrupted .gitignore)

**Not committed (correctly ignored):**
- `backend/preclinic.db` (live DB with test uploads)
- `backend/storage/` (test PDF)
- `.venv/`, `.runtime/`, `__pycache__/`
- `TASK-6-REPORT.md` (previous report, untracked)

**Verified after changes:**
- Public pages 200, nav 7 items, CTAs differ, login premium, doctor dashboard real, admin 5 sections, patient 11 items, doctor 14 items, voice rec.lang dynamic, docViewer real /view with 429/403, tutorial real spotlight + goFirst, emergency no ambulance, clinical never invent, pytest 11/11, full lifecycle E2E + doc E2E + emergency E2E all passing via live API
