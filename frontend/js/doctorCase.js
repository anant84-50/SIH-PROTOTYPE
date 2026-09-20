/* Preclinic IQ AI — Doctor case workspace.
 * Tabs: Overview / AI Summary / History / Documents / Intake / Timeline.
 * All data from the database; every action writes through the API. */
(function (global) {
  "use strict";
  const UI = global.PreclinicUI;
  const API = global.PreclinicAPI;
  const I18n = global.PreclinicI18n;
  const E = UI.esc;
  const t = (k) => I18n.t(k);

  const TABS = ["overview", "summary", "history", "documents", "intake", "timeline"];

  let data = null; // { visit, patient, meds, allergies, timeline, visits }

  const main = () => document.getElementById("docMain");

  function setHeader(eyebrow, title) {
    const e = document.getElementById("pageEyebrow");
    const p = document.getElementById("pageTitle");
    if (e) e.textContent = eyebrow;
    if (p) p.textContent = title;
  }

  /* ---------------- Data loading ---------------- */
  async function loadCase(visitId) {
    const vRes = await API.get("/visits/" + visitId);
    if (!vRes.success) throw new Error(vRes.error.message);
    const visit = vRes.data;
    const pu = visit.patientUuid;
    const [patRes, medRes, allRes, tlRes, vListRes] = await Promise.all([
      API.get("/patients/" + pu),
      API.get("/patients/" + pu + "/medications"),
      API.get("/patients/" + pu + "/allergies"),
      API.get("/patients/" + pu + "/timeline"),
      API.get("/patients/" + pu + "/visits"),
    ]);
    return {
      visit,
      patient: patRes.success ? patRes.data : null,
      meds: medRes.success ? medRes.data.items || [] : [],
      allergies: allRes.success ? allRes.data.items || [] : [],
      timeline: tlRes.success ? tlRes.data.events || [] : [],
      visits: vListRes.success ? vListRes.data.items || [] : [],
    };
  }

  /* ---------------- Shell ---------------- */
  function open(visitId, tab) {
    if (!TABS.includes(tab)) tab = "overview";
    setHeader("Case workspace", "Patient case");
    const host = main();
    UI.state(host, "loading", "Loading case…");
    // Audit the access (fire and forget; UI must not block on it).
    API.post("/doctor/visits/" + visitId + "/open", {}).catch(() => {});

    loadCase(visitId).then((d) => {
      data = d;
      renderShell(tab);
    }).catch((err) => {
      console.error(err);
      UI.state(host, "error", E(err.message || "Could not load this case."),
        '<div class="btn-row"><button class="btn ghost tiny" data-back>Back to queue</button></div>');
      host.querySelector("[data-back]").addEventListener("click", () => { location.hash = "#/queue"; });
    });
  }

  function renderShell(tab) {
    const v = data.visit;
    const host = main();
    UI.$$("#docNav a").forEach((a) => a.classList.remove("active"));

    const backBtn = '<a class="btn ghost tiny" href="#/queue">' + UI.icon("back", 13) + t("caseBack") + "</a>";
    const tabsHtml = TABS.map((k) =>
      '<button data-tab="' + k + '" class="' + (k === tab ? "on" : "") + '">' + t("tab" + k.charAt(0).toUpperCase() + k.slice(1)) + "</button>"
    ).join("");

    host.innerHTML =
      '<div class="case-head"><div class="ch-row"><div style="min-width:0">' +
      "<h3>" + E(v.patientName || "—") + "</h3>" +
      '<div class="ch-meta"><span class="mono">' + E(v.patientId || "") + "</span>" +
      '<span class="mono">Visit ' + E(String(v.visitId).slice(0, 8)) + "</span>" +
      "<span>" + UI.icon("calendar", 12) + " " + UI.fmtTime(v.startedAt) + "</span>" +
      (v.complaintPathway ? "<span>" + E(v.complaintPathway) + "</span>" : "") + "</div></div>" +
      '<div class="ch-actions"><span>' + UI.chip(v.status) + "</span>" +
      (v.summary ? '<span>' + UI.chip(v.summary.verificationStatus) + "</span>" : "") + "</div></div></div>" +
      '<div class="tabbar case-tabs">' + tabsHtml + "</div>" +
      '<div id="caseBody"></div>';

    host.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.tab;
      location.hash = "#/case/" + v.visitId + "/" + k;
    }));
    renderTab(tab);
  }

  function renderTab(tab) {
    const body = main().querySelector("#caseBody");
    UI.state(body, "loading", "Loading…");
    const fn = { overview: renderOverview, summary: renderSummary, history: renderHistory, documents: renderDocuments, intake: renderIntake, timeline: renderTimeline }[tab] || renderOverview;
    fn(body).catch((err) => {
      console.error(err);
      UI.state(body, "error", E(err.message || "Could not load this section."));
    });
  }

  /* ---------------- Overview ---------------- */
  async function renderOverview(body) {
    const v = data.visit;
    const missing = (v.summary && v.summary.body && v.summary.body.missingInformation) || [];
    const reviewItems = (v.summary && v.summary.body && v.summary.body.itemsRequiringVerification) || [];
    body.innerHTML =
      '<div class="card"><div class="kv">' +
      '<div><b>' + t("ovComplaint") + '</b><span>' + E(v.chiefComplaint || t("notProvided")) + '<span class="prov patient">' + t("srcPatient") + "</span></span></div>" +
      '<div><b>' + t("ovStatus") + "</b><span>" + UI.chip(v.status) + "</span></div>" +
      '<div><b>' + t("ovSummary") + '</b><span>' + (v.summary ? UI.chip(v.summary.verificationStatus) + ' <span class="sub">v' + v.summary.version + " · " + (v.summary.confidence || "—") + "</span>" : "—") + "</span></div>" +
      '<div><b>' + t("ovDocs") + '</b><span>' + (v.visitDocuments.length ? v.visitDocuments.length + " file(s)" : "None uploaded") + "</span></div>" +
      '<div><b>' + t("ovReview") + '</b><span>' + (v.summary ? (v.summary.verificationStatus === "DOCTOR_VERIFIED" ? "Verified" : v.summary.verificationStatus === "REJECTED" ? "Rejected" : "Pending") : "No summary yet") + "</span></div>" +
      '<div><b>' + t("ovEm") + '</b><span>' + (v.visitEmergencies.length ? v.visitEmergencies.map((e) => UI.chip(e.status) + " " + E(e.reason || "")).join("<br/>") : "None") + "</span></div>" +
      "</div>" +
      (v.openConflicts.length ?
        '<div class="sec-h">Open conflicts</div>' +
        v.openConflicts.map((c) =>
          '<div class="conflict-row' + (/HIGH|URGENT/i.test(c.field || "") ? " high" : "") + '">' +
          '<div class="c-top"><strong>' + E(c.field) + '</strong><span>' + UI.chip("OPEN") + "</span></div>" +
          '<div class="c-desc">' + E(c.leftSource) + ": " + E(c.leftValue) + " &nbsp;⇄&nbsp; " + E(c.rightSource) + ": " + E(c.rightValue) + "</div>" +
          '<div class="btn-row"><button class="btn tiny" data-conf="' + E(c.id) + '" data-st="DOCTOR_CONFIRMED">Confirm</button>' +
          '<button class="btn ghost tiny" data-conf="' + E(c.id) + '" data-st="DISMISSED">Dismiss</button></div></div>'
        ).join("") : "") +
      (missing.length ?
        '<div class="sec-h">' + t("ovMissing") + "</div>" +
        '<div class="small muted">' + missing.map((m) => E(m) + " <em>(not provided — not an absence finding)</em>").join(" · ") + "</div>" : "") +
      (reviewItems.length ?
        '<div class="sec-h">' + t("secReview") + "</div>" +
        '<ul class="small">' + reviewItems.map((m) => "<li>" + E(m) + "</li>").join("") + "</ul>" : "") +
      '<div class="btn-row">' +
      '<a class="btn tiny" href="#/case/' + E(v.visitId) + '/summary">' + t("tabSummary") + "</a>" +
      '<a class="btn ghost tiny" href="#/case/' + E(v.visitId) + '/documents">' + t("tabDocuments") + "</a>" +
      (v.summary && !/VERIFIED|REJECTED/i.test(v.summary.verificationStatus) ?
        '<button class="btn tiny ok" data-verify="DOCTOR_VERIFIED">' + t("verifyCase") + "</button>" : "") +
      "</div></div>";

    body.querySelectorAll("[data-conf]").forEach((b) => b.addEventListener("click", async () => {
      const res = await API.patch("/visits/" + v.visitId, { conflictId: b.dataset.conf, conflictStatus: b.dataset.st });
      UI.toast(res.success ? "Conflict " + b.dataset.st.toLowerCase() + " (new summary review may be required)" : (res.error && res.error.message));
      open(v.visitId, "overview");
    }));
    body.querySelectorAll("[data-verify]").forEach((b) => b.addEventListener("click", () => doVerify(b.dataset.verify)));
  }

  async function doVerify(action) {
    const v = data.visit;
    if (action === "DOCTOR_VERIFIED" && !window.confirm("Verify this case? The AI draft becomes doctor-verified and the patient is notified.")) return;
    if (action === "REJECTED" && !window.confirm("Reject this draft? The visit returns to intake for correction.")) return;
    const res = await API.post("/doctor/verify/" + v.visitId, { visitId: v.visitId, action });
    if (!res.success) { UI.toast(res.error.message); return; }
    UI.toast(action === "DOCTOR_VERIFIED" ? "Case verified" : "Draft rejected");
    // Refresh case state from the database and re-render.
    data = await loadCase(v.visitId);
    const tab = (location.hash.split("/")[3]) || "summary";
    renderTab(TABS.includes(tab) ? tab : "summary");
  }

  /* ---------------- AI Summary ---------------- */
  async function renderSummary(body) {
    const v = data.visit;
    const s = v.summary;
    if (!s) {
      UI.state(body, "empty", "No AI summary yet for this visit. Generate it from the patient flow, or wait for the patient to confirm their draft.");
      return;
    }
    const b = s.body || {};
    const st = s.verificationStatus;

    let banner;
    if (st === "DOCTOR_VERIFIED") {
      banner = '<div class="banner-ai banner-verified">' + UI.icon("verified", 16) + "<div><strong>" + t("aiBannerVerified") + "</strong> · " + UI.relTime(s.createdAt) + "<br/>" + t("aiDisclaimer") + "</div></div>";
    } else if (st === "REJECTED") {
      banner = '<div class="banner-ai banner-rejected">' + UI.icon("alert", 16) + "<div><strong>" + t("aiBannerRejected") + "</strong> — the patient may correct and regenerate.</div></div>";
    } else {
      banner = '<div class="banner-ai">' + UI.icon("summary", 16) + "<div><strong>" + t("aiBanner") + "</strong><br/>" + t("aiDisclaimer") + "</div></div>";
    }

    const prov = (kind, label) => '<span class="prov ' + kind + '">' + (label || t("src" + kind.charAt(0).toUpperCase() + kind.slice(1))) + "</span>";
    const val = (txt, label) => txt ? '<div class="ai-val">' + E(txt) + (label ? " " + label : "") + "</div>" : '<div class="ai-val empty">' + t("notProvided") + "</div>";
    const hist = v.history || {};

    const ros = hist.reviewOfSystems || {};
    const rosHtml = Object.keys(ros).map((k) => "<li><strong>" + E(k) + "</strong>: " + E(ros[k]) + "</li>").join("");
    const redFlags = b.redFlags || (hist.reviewOfSystems && hist.reviewOfSystems["Red flags"]) ? (b.redFlags || []) : [];

    const medsHtml = data.meds.length
      ? '<div class="meds-list">' + data.meds.map((m) =>
        '<div class="med-row"><span class="m-name">' + E(m.name) + "</span>" +
        (m.dosage ? '<span class="m-dose">' + E(m.dosage) + (m.frequency ? " · " + E(m.frequency) : "") + "</span>" : "") +
        " " + (m.verificationStatus === "DOCTOR_VERIFIED" ? prov("verified", t("srcVerified")) : prov(m.sourceType === "DOCUMENT" ? "doc" : "patient", m.sourceType === "DOCUMENT" ? t("srcDoc") : t("srcPatient"))) +
        (m.isCurrent === false ? '<span class="chip">not current</span>' : "") + "</div>"
      ).join("") + "</div>"
      : '<div class="ai-val empty">' + t("notProvided") + "</div>";

    const allHtml = data.allergies.length
      ? '<div class="meds-list">' + data.allergies.map((a) =>
        '<div class="med-row"><span class="m-name">' + E(a.substance) + "</span>" +
        (a.reaction ? '<span class="m-dose">' + E(a.reaction) + "</span>" : "") +
        " " + (a.verificationStatus === "DOCTOR_VERIFIED" ? prov("verified", t("srcVerified")) : prov(a.sourceType === "DOCUMENT" ? "doc" : "patient", a.sourceType === "DOCUMENT" ? t("srcDoc") : t("srcPatient"))) + "</div>"
      ).join("") + "</div>"
      : '<div class="ai-val empty">' + t("notProvided") + "</div>";

    const ay = v.ayush || {};
    const AYUSH_FIELDS = ["prakriti", "vikriti", "ahara", "vihara", "nidana", "sara", "samhanana", "pramana", "satmya", "sattva", "aharaShakti", "vyayamaShakti", "vaya", "samprapti"];
    const ayushHtml = AYUSH_FIELDS.map((k) => ay[k]).filter(Boolean).length
      ? AYUSH_FIELDS.map((k) => ay[k] ? '<div class="cmp-row"><b>' + E(k) + '</b>' + E(ay[k]) + "</div>" : null).join("")
      : '<div class="ai-val empty">' + t("notProvided") + "</div>";

    const docHtml = v.visitDocuments.length
      ? v.visitDocuments.map((d) =>
        '<div class="ext-row"><div class="e-h"><span class="e-type">' + E(d.originalFilename) + "</span><span>" + UI.chip(d.processingStatus) + "</span></div>" +
        '<div class="e-meta">' + E(d.documentType || "") + " · " + UI.fmtTime(d.createdAt) + '</div><div class="e-meta"><button class="btn ghost tiny" data-doc="' + E(d.id) + '">' + t("docsExt") + "</button></div></div>"
      ).join("") + '<div class="small muted" style="margin-top:6px">' + t("extNote") + "</div>"
      : '<div class="ai-val empty">No documents uploaded for this visit.</div>';

    const missing = b.missingInformation || [];
    const review = b.itemsRequiringVerification || [];

    body.innerHTML =
      banner +
      '<div class="card" style="margin-top:12px">' +
      '<div class="eyebrow">v' + s.version + " · " + E(s.confidence || "—") + " confidence · " + UI.relTime(s.createdAt) + "</div>" +
      '<div class="ai-sec"><div class="sec-h" style="margin-top:10px">' + t("secPresenting") + "</div>" +
      '<div class="kv">' +
      '<div><b>Chief complaint</b><span>' + E(v.chiefComplaint || t("notProvided")) + prov("patient") + "</span></div>" +
      '<div><b>Pathway</b><span>' + E(v.complaintPathway || "—") + "</span></div>" +
      "</div>" +
      (b.patientWords ? '<div class="small" style="margin-top:8px"><em>In the patient\'s words:</em> ' + b.patientWords.map((w) => "<span class=\"chip leaf\" style=\"margin:2px 4px 2px 0\">" + E(w) + "</span>").join("") + "</div>" : "") +
      "</div>" +
      '<div class="ai-sec"><div class="sec-h">' + t("secSymptoms") + "</div>" +
      (rosHtml ? "<ul class='small'>" + rosHtml + "</ul>" : val(hist.hpi)) +
      (redFlags && redFlags.length ? '<div class="small" style="margin-top:6px">Red flags: ' + redFlags.map((r) => '<span class="chip warn">' + E(r) + "</span>").join(" ") + "</div>" : "") +
      "</div>" +
      '<div class="ai-sec"><div class="sec-h">' + t("secMedHist") + "</div>" + val(hist.pastMedicalHistory, hist.pastMedicalHistory ? prov("patient") : "") +
      '<div class="sec-h">' + t("secSurgical") + "</div>" + val(hist.pastSurgicalHistory, hist.pastSurgicalHistory ? prov("patient") : "") +
      '<div class="sec-h">' + t("secFamily") + "</div>" + val(hist.familyHistory, hist.familyHistory ? prov("patient") : "") +
      '</div>' +
      '<div class="ai-sec"><div class="sec-h">' + t("secMeds") + "</div>" + medsHtml + "</div>" +
      '<div class="ai-sec"><div class="sec-h">' + t("secAllergies") + "</div>" + allHtml + "</div>" +
      '<div class="ai-sec"><div class="sec-h">' + t("secAyush") + "</div>" + ayushHtml + "</div>" +
      '<div class="ai-sec"><div class="sec-h">' + t("secDocDerived") + "</div>" + docHtml + "</div>" +
      (missing.length ? '<div class="ai-sec"><div class="sec-h">' + t("secMissing") + '</div><ul class="small">' + missing.map((m) => "<li>" + E(m) + " <em>— not provided, not an absence finding</em></li>").join("") + "</ul></div>" : "") +
      (review.length ? '<div class="ai-sec"><div class="sec-h">' + t("secReview") + '</div><ul class="small">' + review.map((m) => "<li>" + E(m) + "</li>").join("") + "</ul></div>" : "") +
      '<div class="ai-sec"><div class="sec-h">' + t("secNarrative") + "</div>" +
      '<div class="narrative-box"><textarea id="narrativeEdit" ' + (st === "DOCTOR_VERIFIED" ? "readonly" : "") + '>' + E(s.narrative || "") + "</textarea></div>" +
      (s.sources && s.sources.length ? '<div class="small muted" style="margin-top:8px">Sources: ' + s.sources.map((x) => E(typeof x === "string" ? x : (x.label || x.type || "source"))).join(", ") + "</div>" : "") +
      "</div>" +
      '<div class="btn-row">' +
      (st !== "DOCTOR_VERIFIED" && st !== "REJECTED"
        ? '<button class="btn tiny" id="saveNarrative">' + t("saveVer") + "</button>" +
          '<button class="btn ok tiny" data-verify="DOCTOR_VERIFIED">' + t("verifyCase") + "</button>" +
          '<button class="btn ghost tiny" data-verify="REJECTED">' + t("rejectDraft") + "</button>"
        : "") +
      '<a class="btn ghost tiny" href="#/case/' + E(v.visitId) + '/intake">' + t("tabIntake") + "</a>" +
      "</div>" +
      (st !== "DOCTOR_VERIFIED" && st !== "REJECTED" ? '<p class="small muted" style="margin-top:8px">' + t("editNarr") + "</p>" : "") +
      "</div>";

    const saveBtn = body.querySelector("#saveNarrative");
    if (saveBtn) saveBtn.addEventListener("click", async () => {
      const narrative = body.querySelector("#narrativeEdit").value;
      const res = await API.patch("/doctor/summary/" + v.visitId, { narrative });
      UI.toast(res.success ? "Saved as version " + res.data.version + " (needs review)" : (res.error && res.error.message));
      if (res.success) open(v.visitId, "summary");
    });
    body.querySelectorAll("[data-verify]").forEach((b) => b.addEventListener("click", () => doVerify(b.dataset.verify)));
    body.querySelectorAll("[data-doc]").forEach((b) => b.addEventListener("click", () => {
      const d = v.visitDocuments.find((x) => x.id === b.dataset.doc);
      if (d) PreclinicDocViewer.open(d);
    }));
  }

  /* ---------------- History ---------------- */
  async function renderHistory(body) {
    const v = data.visit;
    const h = v.history || {};
    const medsText = (h.medications || []).map((m) => typeof m === "string" ? m : (m.name || "")).join(", ");
    const allText = (h.allergies || []).map((a) => typeof a === "string" ? a : (a.substance || "")).join(", ");
    const rel = (v.relatedVisits || [])[0] || null;

    const ay = v.ayush || {};
    const AYUSH_FIELDS = ["prakriti", "vikriti", "ahara", "vihara", "nidana", "sara", "samhanana", "pramana", "satmya", "sattva", "aharaShakti", "vyayamaShakti", "vaya", "samprapti"];

    body.innerHTML =
      (rel ?
        '<div class="card" style="border-color:var(--gold)"><div class="eyebrow">' + t("relVisit") + "</div>" +
        "<strong>" + E(rel.pathway || rel.chiefComplaint || "Previous visit") + '</strong> <span class="mono small">' + E(String(rel.visitId).slice(0, 8)) + "</span> · " + UI.fmtTime(rel.startedAt) + " · " + UI.chip(rel.status) +
        (rel.reasons && rel.reasons.length ? '<div class="small muted" style="margin-top:4px">' + rel.reasons.map(E).join(" · ") + "</div>" : "") +
        '<div class="btn-row"><button class="btn tiny" data-compare="' + E(rel.visitId) + '">' + t("relCompare") + "</button>" +
        '<a class="btn ghost tiny" href="#/case/' + E(rel.visitId) + '">' + t("relOpen") + "</a></div></div>" : "") +
      '<div id="cmpHost"></div>' +
      '<div class="card" style="margin-top:12px"><div class="eyebrow">' + t("histEdit") + "</div>" +
      '<div class="grid-2">' +
      '<div class="field"><label>Chief complaint</label><input id="hChief" value="' + E(h.chiefComplaint || "") + '"/></div>' +
      '<div class="field"><label>Patient concerns</label><input id="hConcerns" value="' + E(h.patientConcerns || "") + '"/></div>' +
      "</div>" +
      '<div class="field"><label>HPI / symptom description</label><textarea id="hHpi" rows="3">' + E(h.hpi || "") + "</textarea></div>" +
      '<div class="field"><label>Past medical history</label><textarea id="hPmh" rows="2">' + E(h.pastMedicalHistory || "") + "</textarea></div>" +
      '<div class="field"><label>Past surgical history</label><textarea id="hPsh" rows="2">' + E(h.pastSurgicalHistory || "") + "</textarea></div>" +
      '<div class="field"><label>Family history</label><textarea id="hFamily" rows="2">' + E(h.familyHistory || "") + "</textarea></div>" +
      '<div class="grid-2">' +
      '<div class="field"><label>Current medications (comma separated)</label><input id="hMeds" value="' + E(medsText) + '"/></div>' +
      '<div class="field"><label>Allergies (comma separated)</label><input id="hAll" value="' + E(allText) + '"/></div>' +
      "</div>" +
      '<button class="btn" id="saveHist">' + t("saveHist") + "</button></div>" +
      '<div class="card" style="margin-top:12px"><div class="eyebrow">' + t("secAyush") + " · " + UI.chip(ay.verificationStatus || "AI_DRAFT") + "</div>" +
      (AYUSH_FIELDS.map((k) => ay[k] ? '<div class="cmp-row"><b>' + E(k) + '</b>' + E(ay[k]) + "</div>" : "").join("") || '<div class="ai-val empty">' + t("notProvided") + "</div>") +
      "</div>" +
      '<div class="card" style="margin-top:12px"><div class="eyebrow">' + t("longTitle") + "</div>" +
      data.visits.map((w) =>
        '<div class="visit-card' + (w.visitId === v.visitId ? " this-visit" : "") + '" style="cursor:pointer" data-open="' + E(w.visitId) + '">' +
        '<div class="v-top"><span class="v-name">' + E(w.chiefComplaint || w.complaintPathway || "Visit") + "</span>" + UI.chip(w.status) +
        (w.summaryStatus ? " " + UI.chip(w.summaryStatus) : "") + "</div>" +
        '<div class="v-sub">' + UI.fmtTime(w.startedAt) + (w.documentCount ? " · " + w.documentCount + " doc(s)" : "") + (w.visitId === v.visitId ? " · " + t("curVisit") : "") + "</div></div>"
      ).join("") + "</div>";

    body.querySelector("#saveHist").addEventListener("click", async () => {
      const g = (id) => body.querySelector(id).value.trim();
      const res = await API.patch("/visits/" + v.visitId, {
        history: {
          chiefComplaint: g("#hChief") || null,
          patientConcerns: g("#hConcerns") || null,
          hpi: g("#hHpi") || null,
          pastMedicalHistory: g("#hPmh") || null,
          pastSurgicalHistory: g("#hPsh") || null,
          familyHistory: g("#hFamily") || null,
          medications: g("#hMeds") ? g("#hMeds").split(",").map((s) => s.trim()).filter(Boolean) : [],
          allergies: g("#hAll") ? g("#hAll").split(",").map((s) => s.trim()).filter(Boolean) : [],
        },
      });
      UI.toast(res.success ? "History saved (version " + (res.data.history ? res.data.history.version : "?") + ", needs review)" : (res.error && res.error.message));
      if (res.success) open(v.visitId, "history");
    });

    body.querySelectorAll("[data-compare]").forEach((b) => b.addEventListener("click", async () => {
      const prevRes = await API.get("/visits/" + b.dataset.compare);
      if (!prevRes.success) { UI.toast(prevRes.error.message); return; }
      const p = prevRes.data;
      const ph = p.history || {};
      const row = (label, cur, prev) =>
        '<div class="cmp-row"><b>' + label + "</b><div>" + E(cur || t("notProvided")) + "</div><div class='sub'>" + E(prev || t("notProvided")) + "</div></div>";
      document.getElementById("cmpHost").innerHTML =
        '<div class="card" style="margin-top:12px;border-color:var(--gold)"><div class="eyebrow">' + t("prevVisit") + " ⇄ " + t("curVisit") + "</div>" +
        '<div class="cmp-grid"><div class="cmp-col cur"><h4>' + t("curVisit") + "</h4>" +
        row("Complaint", v.chiefComplaint) + row("Pathway", v.complaintPathway) + row("Meds", medsText) + row("Allergies", allText) + row("PMH", h.pastMedicalHistory) +
        '</div><div class="cmp-col prev"><h4>' + t("prevVisit") + " · " + UI.fmtTime(p.startedAt) + "</h4>" +
        row("Complaint", p.chiefComplaint) + row("Pathway", p.complaintPathway) + row("Meds", (ph.medications || []).map((m) => typeof m === "string" ? m : (m.name || "")).join(", ")) + row("Allergies", (ph.allergies || []).map((a) => typeof a === "string" ? a : (a.substance || "")).join(", ")) + row("PMH", ph.pastMedicalHistory) +
        "</div></div></div>";
      document.getElementById("cmpHost").scrollIntoView({ behavior: "smooth", block: "nearest" });
    }));
    body.querySelectorAll("[data-open]").forEach((el) => el.addEventListener("click", () => { location.hash = "#/case/" + el.dataset.open; }));
  }

  /* ---------------- Documents ---------------- */
  async function renderDocuments(body) {
    const v = data.visit;
    const allRes = await API.get("/patients/" + v.patientUuid + "/documents");
    if (!allRes.success) throw new Error(allRes.error.message);
    const all = allRes.data.items || [];
    if (!all.length) {
      UI.state(body, "empty", "This patient has not uploaded any documents.");
      return;
    }
    const visitIds = new Set(v.visitDocuments.map((d) => d.id));
    body.innerHTML =
      '<div class="card">' +
      all.map((d) => {
        const isVisit = visitIds.has(d.id) || d.visitId === v.visitId;
        return '<div class="doc-card2' + (isVisit ? " this-visit" : "") + '">' +
          '<div class="d-top"><strong class="d-name">' + UI.icon("doc", 15) + " " + E(d.originalFilename) + "</strong>" +
          "<span>" + UI.chip(d.documentType || "FILE") + "</span><span>" + UI.chip(d.processingStatus) + "</span>" +
          (isVisit ? '<span class="chip gold">' + t("curVisit") + "</span>" : "") + "</div>" +
          '<div class="d-meta"><span class="mono">' + E(v.patientId) + "</span><span>" + UI.fmtTime(d.createdAt) + "</span>" +
          (d.sizeBytes ? "<span>" + Math.round(d.sizeBytes / 1024) + " KB</span>" : "") + "</div>" +
          '<div class="btn-row"><button class="btn tiny" data-view="' + E(d.id) + '">' + t("docsView") + "</button>" +
          '<button class="btn ghost tiny" data-full="' + E(d.id) + '">' + t("docsFull") + "</button>" +
          '<button class="btn ghost tiny" data-ext="' + E(d.id) + '">' + t("docsExt") + "</button></div></div>";
      }).join("") + "</div>";
    const byId = {}; all.forEach((d) => { byId[d.id] = d; });
    body.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => PreclinicDocViewer.open(byId[b.dataset.view])));
    body.querySelectorAll("[data-ext]").forEach((b) => b.addEventListener("click", () => PreclinicDocViewer.open(byId[b.dataset.ext], { extract: true })));
    body.querySelectorAll("[data-full]").forEach((b) => b.addEventListener("click", () => {
      window.open("/api/v1/documents/" + b.dataset.full + "/view?access_token=" + encodeURIComponent(PreclinicAPI.token()), "_blank", "noopener");
    }));
  }

  /* ---------------- Intake ---------------- */
  async function renderIntake(body) {
    const v = data.visit;
    const it = v.intake;
    if (!it) { UI.state(body, "empty", t("intakeNotStarted")); return; }
    const stChip = { ANSWERED: "ok", SKIPPED: "", PREFER_NOT: "gold", NOT_PROVIDED: "" };
    const stLabel = { ANSWERED: t("stAnswered"), SKIPPED: t("stSkipped"), PREFER_NOT: t("stPreferNot"), NOT_PROVIDED: t("stNotProvided") };
    const fields = {};
    it.items.forEach((q) => { (fields[q.field] = fields[q.field] || []).push(q); });
    const order = Object.keys(fields);
    body.innerHTML =
      '<div class="card"><div class="eyebrow">' + it.answered + "/" + it.total + " " + t("intakeAnswered") +
      (it.returning ? ' · <span class="chip gold">Returning visit — carried from visit ' + E(String(it.reusedFrom).slice(0, 8)) + "</span>" : "") + "</div>" +
      order.map((f) =>
        '<div class="sec-h">' + E(f) + "</div>" +
        fields[f].map((q) =>
          '<div class="intake-q' + (q.status !== "ANSWERED" ? " skipped" : "") + '">' +
          '<div class="q-text">' + E(q.question) + "</div>" +
          '<div class="q-ans">' + (q.status === "ANSWERED" ? "<strong>" + E(String(q.value || "")) + "</strong>" : "<span>" + UI.chip(stLabel[q.status]) + "</span>") +
          (q.inputMode ? '<span class="sub">' + E(q.inputMode) + "</span>" : "") + "</div></div>"
        ).join("")
      ).join("") + "</div>";
  }

  /* ---------------- Timeline ---------------- */
  async function renderTimeline(body) {
    const v = data.visit;
    let events = data.timeline.slice();
    const onlyVisit = events.length && events.every((e) => e.visitId === null || e.visitId === v.visitId);
    body.innerHTML =
      '<div class="card"><div class="btn-row" style="margin-top:0"><div class="seg">' +
      '<button data-flt="all" class="on">' + t("tlAll") + '</button><button data-flt="visit">' + t("tlVisitOnly") + "</button></div></div>" +
      '<div id="tlHost" style="margin-top:12px"></div></div>';
    const host = body.querySelector("#tlHost");
    function draw(list) {
      if (!list.length) { UI.state(host, "empty", "No timeline events yet."); return; }
      host.innerHTML = '<div class="timeline">' + list.map((e) =>
        '<div class="tl-item"><div class="small"><strong>' + E(e.title) + "</strong> <span class='sub'>· " + E(e.sourceType) + "</span>" +
        (e.detail ? "<div class='sub'>" + E(e.detail) + "</div>" : "") +
        '<div class="sub">' + UI.fmtTime(e.createdAt || e.occurredOn) + "</div></div></div>"
      ).join("") + "</div>";
    }
    draw(events);
    body.querySelectorAll("[data-flt]").forEach((b) => b.addEventListener("click", () => {
      body.querySelectorAll("[data-flt]").forEach((x) => x.classList.toggle("on", x === b));
      draw(b.dataset.flt === "visit" ? events.filter((e) => e.visitId === v.visitId) : events);
    }));
  }

  /* ---------------- Patient records (no specific visit) ---------------- */
  function openPatient(patientId) {
    setHeader("Longitudinal record", "Patient");
    const host = main();
    UI.state(host, "loading", "Loading…");
    loadPatient(patientId).then((d) => renderPatient(d)).catch((err) => {
      console.error(err);
      UI.state(host, "error", E(err.message || "Could not load this patient."),
        '<div class="btn-row"><button class="btn ghost tiny" data-back>Back to records</button></div>');
      host.querySelector("[data-back]").addEventListener("click", () => { location.hash = "#/patients"; });
    });
  }

  async function loadPatient(patientId) {
    const res = await API.get("/patients/" + patientId);
    if (!res.success) throw new Error(res.error.message);
    const p = res.data;
    const [vRes, tlRes, medRes, allRes, dRes] = await Promise.all([
      API.get("/patients/" + patientId + "/visits"),
      API.get("/patients/" + patientId + "/timeline"),
      API.get("/patients/" + patientId + "/medications"),
      API.get("/patients/" + patientId + "/allergies"),
      API.get("/patients/" + patientId + "/documents"),
    ]);
    const visits = vRes.success ? vRes.data.items || [] : [];
    const tl = tlRes.success ? tlRes.data.events || [] : [];
    const meds = medRes.success ? medRes.data.items || [] : [];
    const alls = allRes.success ? allRes.data.items || [] : [];
    const docs = dRes.success ? dRes.data.items || [] : [];
    return { p, visits, tl, meds, alls, docs };
  }

  function renderPatient(d) {
    const host = main();
    const { p, visits, tl, meds, alls, docs } = d;
    host.innerHTML =
      '<div class="case-head"><div class="ch-row"><div><h3>' + E(p.fullName) + "</h3>" +
      '<div class="ch-meta"><span class="mono">' + E(p.patientId) + "</span>" +
      (p.dateOfBirth ? "<span>DOB " + E(p.dateOfBirth) + "</span>" : "") +
      (p.sex ? "<span>" + E(p.sex) + "</span>" : "") +
      (p.bloodGroup ? "<span>Blood " + E(p.bloodGroup) + "</span>" : "") +
      (p.phone ? "<span>" + E(p.phone) + "</span>" : "") + "</div></div>" +
      '<div class="ch-actions"><span>' + UI.chip(p.language || "en") + "</span></div></div></div>" +
      '<div class="card"><div class="eyebrow">Profile</div><div class="kv">' +
      "<div><b>Address</b><span>" + E(p.address || t("notProvided")) + "</span></div>" +
      "<div><b>Language</b><span>" + E(p.language || "en") + "</span></div>" +
      "<div><b>Visits</b><span>" + visits.length + "</span></div>" +
      "<div><b>Documents</b><span>" + docs.length + "</span></div></div></div>" +
      '<div class="card" style="margin-top:12px"><div class="eyebrow">' + t("secMeds") + " / " + t("secAllergies") + "</div><div class=\"grid-2\">" +
      "<div>" + (meds.length ? '<div class="meds-list">' + meds.map((m) => '<div class="med-row">' + E(m.name) + (m.dosage ? ' <span class="m-dose">' + E(m.dosage) + "</span>" : "") + "</div>").join("") + "</div>" : '<div class="ai-val empty">' + t("notProvided") + "</div>") + "</div>" +
      "<div>" + (alls.length ? '<div class="meds-list">' + alls.map((a) => '<div class="med-row">' + E(a.substance) + (a.reaction ? ' <span class="m-dose">' + E(a.reaction) + "</span>" : "") + "</div>").join("") + "</div>" : '<div class="ai-val empty">' + t("notProvided") + "</div>") + "</div></div></div>" +
      '<div class="card" style="margin-top:12px"><div class="eyebrow">' + t("longTitle") + "</div>" +
      (visits.length ? visits.map((w) =>
        '<div class="visit-card" data-open="' + E(w.visitId) + '" style="cursor:pointer">' +
        '<div class="v-top"><span class="v-name">' + E(w.chiefComplaint || w.complaintPathway || "Visit") + "</span>" + UI.chip(w.status) +
        (w.summaryStatus ? " " + UI.chip(w.summaryStatus) : "") + "</div>" +
        '<div class="v-sub">' + UI.fmtTime(w.startedAt) + (w.documentCount ? " · " + w.documentCount + " doc(s)" : "") + "</div></div>").join("") : '<div class="state"><div>No visits yet.</div></div>') +
      "</div>" +
      '<div class="card" style="margin-top:12px"><div class="eyebrow">Documents</div>' +
      (docs.length ? docs.map((d) =>
        '<div class="doc-card2"><div class="d-top"><strong class="d-name">' + E(d.originalFilename) + "</strong>" + UI.chip(d.documentType || "FILE") + " " + UI.chip(d.processingStatus) + "</div>" +
        '<div class="btn-row"><button class="btn tiny" data-view="' + E(d.id) + '">' + t("docsView") + "</button>" +
        '<button class="btn ghost tiny" data-ext="' + E(d.id) + '">' + t("docsExt") + "</button></div></div>").join("") : '<div class="state"><div>No documents uploaded.</div></div>') +
      "</div>" +
      '<div class="card" style="margin-top:12px"><div class="eyebrow">' + t("tlTitle") + "</div>" +
      (tl.length ? '<div class="timeline">' + tl.map((e) =>
        '<div class="tl-item"><div class="small"><strong>' + E(e.title) + "</strong> <span class='sub'>· " + E(e.sourceType) + "</span>" +
        (e.detail ? "<div class='sub'>" + E(e.detail) + "</div>" : "") +
        '<div class="sub">' + UI.fmtTime(e.createdAt || e.occurredOn) + "</div></div></div>").join("") + "</div>" : '<div class="state"><div>No timeline events.</div></div>') +
      "</div>";

    host.querySelectorAll("[data-open]").forEach((el) => el.addEventListener("click", () => { location.hash = "#/case/" + el.dataset.open; }));
    const byId = {}; docs.forEach((d) => { byId[d.id] = d; });
    host.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => PreclinicDocViewer.open(byId[b.dataset.view])));
    host.querySelectorAll("[data-ext]").forEach((b) => b.addEventListener("click", () => PreclinicDocViewer.open(byId[b.dataset.ext], { extract: true })));
  }

  global.PreclinicDoctorCase = { open, openPatient };
})(window);
