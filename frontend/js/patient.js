/* Preclinic IQ AI — Patient workspace (hash-routed SPA).
 * Dashboard · 7-step visit wizard (with returning-visit intelligence) ·
 * History · Documents · Processing · Profile · Notifications · Emergency.
 * Every button performs a real API action; no fake state. */
(function (global) {
  "use strict";
  const UI = global.PreclinicUI;
  const API = global.PreclinicAPI;
  const I = global.PreclinicI18n;
  const E = UI.esc;
  const t = (k) => I.t(k);

  const user = PreclinicAuth.requireRole("PATIENT");
  if (!user) {
    document.body.innerHTML = '<div class="auth-wrap"><div class="card auth-card"><h2>Please sign in</h2><p class="muted">Your session is not on this page yet.</p><a class="btn" href="/login">Sign in</a></div></div>';
    return;
  }

  const patientId = user.patientId;
  const main = () => document.getElementById("patMain");
  const wiz = { step: 1, visit: null, sessionId: null, question: null, pathway: null, chiefExtra: "", reuseFrom: null, chat: [] };

  function setHeader(eyebrow, title) {
    const e = document.getElementById("pageEyebrow");
    const p = document.getElementById("pageTitle");
    if (e) e.textContent = eyebrow;
    if (p) p.textContent = title;
  }
  function setActiveNav(name) {
    UI.$$("#patNav a").forEach((a) => a.classList.toggle("active", a.dataset.route === name));
  }
  function chip(s) { return UI.chip(s); }

  /* ---------------- Routing ---------------- */
  const PAT_VIEWS = {
    dashboard: vDashboard, history: vHistory, "case": vCase, documents: vDocuments, processing: vProcessing,
    profile: vProfile, notifications: vNotifications, tutorial: vTutorial, emergency: vEmergency, settings: vSettings,
  };
  function runView(name, arg) {
    const fn = PAT_VIEWS[name];
    const host = main();
    setActiveNav(name);
    UI.state(host, "loading", "Loading…");
    fn(arg).catch((err) => {
      console.error(err);
      UI.state(host, "error", E(err.message || "Something went wrong."), '<button class="btn ghost tiny" onclick="location.hash=\'#/\'">Back to dashboard</button>');
    });
  }
  function route() {
    const h = (location.hash || "#/").replace(/^#/, "").split("/").filter(Boolean);
    document.title = "Patient · Preclinic IQ AI";
    if (!h.length) return runView("dashboard");
    if (h[0] === "new-visit") return wizardBoot(null);
    if (h[0] === "visit" && h[1]) {
      const host = main();
      return wizardBoot(h[1]).catch((err) => {
        console.error(err);
        UI.state(host, "error", E(err.message || "Could not resume this visit."),
          '<button class="btn ghost tiny" onclick="location.hash=\'#/\'">Back to dashboard</button>');
      });
    }
    if (PAT_VIEWS[h[0]]) return runView(h[0], h[1]);
    go("dashboard");
  }
  function go(name, arg) {
    location.hash = name === "dashboard" ? "#/" : "#/" + name + (arg ? "/" + arg : "");
  }

  /* ---------------- Dashboard ---------------- */
  async function vDashboard() {
    setActiveNav("dashboard");
    setHeader("All India Institute of Ayurveda", t("pDash"));
    const host = main();
    const [me, visits, proc, notifs] = await Promise.all([
      API.get("/patients/" + patientId),
      API.get("/patients/" + patientId + "/visits"),
      API.get("/patients/" + patientId + "/processing"),
      API.get("/patients/" + patientId + "/notifications?limit=5"),
    ]);
    if (!me.success) throw new Error(me.error.message);
    const p = me.data;
    const items = (visits.success ? visits.data.items : []) || [];
    const current = items[0] || null;
    const steps = (proc.success ? proc.data.steps : []) || [];
    const notList = (notifs.success ? notifs.data.items : []) || [];

    const pipe = buildPipeline(steps);
    const resumable = current && ["IN_INTAKE", "AWAITING_PATIENT"].includes(current.status);

    host.innerHTML =
      (resumable ?
        '<div class="resume-banner">' + UI.icon("history", 18) + "<div><strong>" + t("pResume") +
        "</strong> · " + E(current.chiefComplaint || current.complaintPathway || "") + "</div>" +
        '<button class="btn tiny" id="resumeBtn">' + t("pResumeGo") + "</button></div>" : "") +
      '<div class="grid-2"><div class="card"><div class="dash-hero">' +
      '<div><h3>' + E(p.fullName) + '</h3><div class="sub mono">' + E(p.patientId) + "</div>" +
      '<div class="sub">' + E(p.language || "en") + (p.bloodGroup ? " · " + E(p.bloodGroup) : "") + (p.sex ? " · " + E(p.sex) : "") + "</div></div>" +
      '<div style="margin-left:auto"><button class="btn tiny" id="newVisitBtn">' + UI.icon("plus", 13) + " " + t("pNew") + "</button></div></div>" +
      (current ?
        '<div class="sec-h">' + t("ovStatus") + " · " + E(current.complaintPathway || "") + "</div>" +
        '<div class="pipe">' + pipe + "</div>" +
        '<div class="v-actions btn-row">' +
        '<button class="btn tiny" data-case="' + E(current.visitId) + '/summary">' + t("pViewCase") + "</button>" +
        '<button class="btn ghost tiny" data-case="' + E(current.visitId) + '/documents">' + t("pViewDocs") + "</button>" +
        '<button class="btn ghost tiny" data-case="' + E(current.visitId) + '/timeline">' + t("pViewTl") + "</button></div>" :
        '<p class="muted small">' + t("noVisits") + "</p>") +
      "</div><div class=\"card\"><div class=\"eyebrow\">" + t("recentVisits") + "</div><div id=\"visitCards\">" +
      (items.slice(0, 5).map(visitCard).join("") || "<p class='muted'>" + t("noVisits") + "</p>") + "</div>" +
      (notList.length ? '<div class="sec-h">' + t("pNotif") + "</div><div class=\"feed\">" + notList.slice(0, 3).map(feedRow).join("") +
        '</div><div class="btn-row"><a class="btn ghost tiny" href="#/notifications">→</a></div>' : "") +
      "</div></div>";

    const resumeBtn = host.querySelector("#resumeBtn");
    if (resumeBtn) resumeBtn.addEventListener("click", () => { location.hash = "#/visit/" + current.visitId; });
    host.querySelector("#newVisitBtn").addEventListener("click", () => { location.hash = "#/new-visit"; });
    bindCaseLinks(host);
  }

  function buildPipeline(steps) {
    const byKey = {};
    steps.forEach((s) => { byKey[s.key] = s; });
    const spec = [
      { label: t("stIntakeDone"), done: byKey.patientInput ? byKey.patientInput.done : false },
      { label: t("stAiProc"), done: byKey.aiStructuring ? byKey.aiStructuring.done : false },
      { label: t("stDocsProc"), done: byKey.documentProcessing ? byKey.documentProcessing.done : false },
      { label: t("stAwaitDoc"), done: byKey.doctorReview ? byKey.doctorReview.done : false },
      { label: t("stDocVer"), done: byKey.doctorVerification ? byKey.doctorVerification.done : false },
      { label: t("stComplete"), done: byKey.visitComplete ? byKey.visitComplete.done : false },
    ];
    let activeSet = false;
    return spec.map((s, i) => {
      let cls = "step";
      if (s.done) cls += " done";
      else if (!activeSet) { cls += " now"; activeSet = true; }
      return '<span class="' + cls + '"><span class="dot">' + (s.done ? "✓" : i + 1) + "</span>" + E(s.label) + "</span>";
    }).join("");
  }

  function visitCard(v) {
    const actions =
      '<button class="btn tiny" data-case="' + E(v.visitId) + '/summary">' + t("pViewCase") + "</button>" +
      '<button class="btn ghost tiny" data-case="' + E(v.visitId) + '/documents">' + t("pViewDocs") + "</button>" +
      '<button class="btn ghost tiny" data-case="' + E(v.visitId) + '/timeline">' + t("pViewTl") + "</button>";
    return '<div class="visit-card" data-case="' + E(v.visitId) + '/overview" style="cursor:pointer">' +
      '<div class="v-top"><span class="v-name">' + E(v.chiefComplaint || v.complaintPathway || "Visit") + "</span>" + chip(v.status) +
      (v.summaryStatus ? " " + chip(v.summaryStatus) : "") + "</div>" +
      '<div class="v-sub">' + UI.fmtTime(v.startedAt) + ' · <span class="mono">' + E(String(v.visitId).slice(0, 8)) + "</span>" +
      (v.documentCount ? " · " + v.documentCount + " doc(s)" : "") + "</div>" +
      '<div class="v-actions">' + actions + "</div></div>";
  }

  function feedRow(it) {
    const cls = it.type === "EMERGENCY" ? "em" : it.type === "SUMMARY" ? "ai" : "";
    const ic = it.type === "EMERGENCY" ? "siren" : it.type === "SUMMARY" ? "summary" : "activity";
    return '<div><div class="f-ic ' + cls + '">' + UI.icon(ic, 14) + "</div><div>" +
      "<strong>" + E(it.title || it.label) + "</strong>" +
      (it.detail ? '<div class="sub">' + E(it.detail) + "</div>" : "") +
      '<div class="sub">' + UI.relTime(it.time || it.createdAt || it.at) + "</div></div></div>";
  }

  function bindCaseLinks(host) {
    host.querySelectorAll("[data-case]").forEach((el) => el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const [vid, tab] = String(el.dataset.case).split("/");
      location.hash = "#/case/" + vid + (tab ? "/" + tab : "");
    }));
  }

  /* ---------------- My History ---------------- */
  async function vHistory() {
    setActiveNav("history");
    setHeader("Longitudinal record", t("pHist"));
    const host = main();
    const [vRes, tlRes] = await Promise.all([
      API.get("/patients/" + patientId + "/visits"),
      API.get("/patients/" + patientId + "/timeline"),
    ]);
    if (!vRes.success) throw new Error(vRes.error.message);
    const items = vRes.data.items || [];
    const events = (tlRes.success ? tlRes.data.events : []) || [];
    if (!items.length) { UI.state(host, "empty", t("noVisits") + " " + t("pNew") + " →"); return; }
    host.innerHTML =
      '<div class="card"><div class="eyebrow">' + t("longTitle") + "</div>" +
      items.map((v) => {
        const evs = events.filter((e) => e.visitId === v.visitId).slice(0, 8);
        return '<div class="visit-card" id="vc-' + E(v.visitId) + '" data-case="' + E(v.visitId) + '/overview" style="cursor:pointer">' +
          '<div class="v-top"><span class="v-name">' + E(v.chiefComplaint || v.complaintPathway || "Visit") + "</span>" + chip(v.status) +
          (v.summaryStatus ? " " + chip(v.summaryStatus) : "") + (v.documentCount ? '<span class="chip">' + v.documentCount + " docs</span>" : "") + "</div>" +
          '<div class="v-sub">' + UI.fmtTime(v.startedAt) + ' · <span class="mono">' + E(String(v.visitId).slice(0, 8)) + "</span></div>" +
          '<div class="v-actions">' +
          '<button class="btn tiny" data-case="' + E(v.visitId) + '/summary">' + t("pViewCase") + "</button>" +
          '<button class="btn ghost tiny" data-case="' + E(v.visitId) + '/documents">' + t("pViewDocs") + "</button>" +
          '<button class="btn ghost tiny" data-case="' + E(v.visitId) + '/timeline">' + t("pViewTl") + "</button>" +
          '<button class="btn ghost tiny" data-tl="' + E(v.visitId) + '">Timeline ▾</button></div>' +
          (evs.length ? '<div id="tlc-' + E(v.visitId) + '" class="hidden" style="margin-top:10px"><div class="timeline">' +
            evs.map((e) => '<div class="tl-item"><div class="small"><strong>' + E(e.title) + "</strong> <span class='sub'>· " + E(e.sourceType) + "</span>" +
            (e.detail ? "<div class='sub'>" + E(e.detail) + "</div>" : "") +
            '<div class="sub">' + UI.fmtTime(e.createdAt || e.occurredOn) + "</div></div></div>").join("") + "</div></div>" : "") +
          "</div>";
      }).join("") + "</div>";
    bindCaseLinks(host);
    host.querySelectorAll("[data-tl]").forEach((b) => b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const el = document.getElementById("tlc-" + b.dataset.tl);
      if (el) el.classList.toggle("hidden");
    }));
  }

  /* ---------------- Case view (patient) ---------------- */
  async function vCase(visitId, tab) {
    setActiveNav("history");
    setHeader("Case", t("pHist"));
    const host = main();
    UI.state(host, "loading", "Loading…");
    const vRes = await API.get("/visits/" + visitId);
    if (!vRes.success) throw new Error(vRes.error.message);
    const v = vRes.data;
    const dRes = await API.get("/patients/" + patientId + "/documents");
    const docs = (dRes.success ? dRes.data.items : []) || [];
    const visitDocs = docs.filter((d) => d.visitId === v.visitId);
    const TABS = ["overview", "summary", "intake", "documents", "timeline"];
    if (!TABS.includes(tab)) tab = "overview";

    const tabsHtml = TABS.map((k) =>
      '<button data-tab="' + k + '" class="' + (k === tab ? "on" : "") + '">' + t("tab" + k.charAt(0).toUpperCase() + k.slice(1)) + "</button>"
    ).join("");

    host.innerHTML =
      '<div class="case-head"><div class="ch-row"><div><h3>' + E(v.chiefComplaint || v.complaintPathway || "Visit") + "</h3>" +
      '<div class="ch-meta"><span class="mono">' + E(String(v.visitId).slice(0, 8)) + "</span><span>" + UI.fmtTime(v.startedAt) + "</span></div></div>" +
      '<div class="ch-actions"><span>' + chip(v.status) + "</span>" + (v.summary ? " <span>" + chip(v.summary.verificationStatus) + "</span>" : "") + "</div></div></div>" +
      '<div class="tabbar case-tabs">' + tabsHtml + "</div>" +
      '<div id="caseBody"></div>';
    host.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
      location.hash = "#/case/" + v.visitId + "/" + b.dataset.tab;
    }));
    renderCaseTab(v, visitDocs, tab, host);
  }

  function renderCaseTab(v, visitDocs, tab, host) {
    const body = host.querySelector("#caseBody");
    UI.state(body, "loading", "Loading…");
    const NP = t("notProvided");
    const prov = (k) => '<span class="prov ' + k + '">' + t("src" + k.charAt(0).toUpperCase() + k.slice(1)) + "</span>";
    if (tab === "overview") {
      const b = v.summary ? v.summary.body || {} : {};
      const missing = b.missingInformation || [];
      body.innerHTML =
        '<div class="card"><div class="kv">' +
        '<div><b>' + t("ovComplaint") + "</b><span>" + E(v.chiefComplaint || NP) + "</span></div>" +
        '<div><b>' + t("ovStatus") + "</b><span>" + chip(v.status) + "</span></div>" +
        '<div><b>' + t("ovSummary") + '</b><span>' + (v.summary ? chip(v.summary.verificationStatus) + " v" + v.summary.version : "—") + "</span></div>" +
        '<div><b>' + t("ovDocs") + "</b><span>" + (visitDocs.length || "—") + "</span></div>" +
        '</div>' +
        (missing.length ? '<div class="sec-h">' + t("secMissing") + '</div><p class="small muted">' + missing.map(E).join(" · ") + " <em>(not provided — not an absence finding)</em></p>" : "") +
        (v.openConflicts && v.openConflicts.length ? '<div class="sec-h">Conflicts to resolve</div>' + v.openConflicts.map((c) =>
          '<div class="conflict-row"><div class="c-top"><strong>' + E(c.field) + "</strong>" + chip(c.status) + "</div>" +
          '<div class="c-desc">' + E(c.leftSource) + ": " + E(c.leftValue) + " ⇄ " + E(c.rightSource) + ": " + E(c.rightValue) + "</div></div>").join("") : "") +
        '<div class="btn-row">' +
        (v.summary && v.summary.verificationStatus === "AI_DRAFT" ? '<button class="btn tiny" data-act="review">Review the draft summary</button>' : "") +
        "</div></div>";
      const btn = body.querySelector("[data-act='review']");
      if (btn) btn.addEventListener("click", () => { location.hash = "#/visit/" + v.visitId; });
    } else if (tab === "summary") {
      if (!v.summary) { UI.state(body, "empty", t("noSum")); return; }
      const s = v.summary;
      const h = v.history || {};
      body.innerHTML =
        (s.verificationStatus !== "DOCTOR_VERIFIED"
          ? '<div class="banner-ai">' + UI.icon("summary", 16) + "<div><strong>" + t("aiBanner") + "</strong><br/>" + t("aiDisclaimer") + "</div></div>"
          : '<div class="banner-ai banner-verified">' + UI.icon("verified", 16) + "<div><strong>" + t("aiBannerVerified") + "</strong> · " + UI.relTime(s.createdAt) + "<br/>" + t("aiDisclaimer") + "</div></div>") +
        '<div class="card" style="margin-top:12px">' +
        sumSection(t("secPresenting"), '<strong>' + E(v.chiefComplaint || NP) + "</strong> · " + E(v.complaintPathway || "—")) +
        (s.body && s.body.patientWords && s.body.patientWords.length ? sumSection("In your words", s.body.patientWords.map((w) => '<span class="chip leaf" style="margin:2px 4px 2px 0">' + E(w) + "</span>").join("")) : "") +
        sumSection(t("secMedHist"), E(h.pastMedicalHistory || NP)) +
        sumSection(t("secSurgical"), E(h.pastSurgicalHistory || NP)) +
        sumSection(t("secFamily"), E(h.familyHistory || NP)) +
        sumSection(t("secMeds"), medText(h.medications)) +
        sumSection(t("secAllergies"), medText(h.allergies, "substance")) +
        (v.ayush && Object.keys(v.ayush).some((k) => v.ayush[k]) ? sumSection(t("secAyush"), ayushText(v.ayush)) : "") +
        (visitDocs.length ? sumSection(t("secDocDerived"), visitDocs.map((d) => E(d.originalFilename) + " · " + d.processingStatus).join(" · ")) : "") +
        (s.body && s.body.missingInformation && s.body.missingInformation.length ? sumSection(t("secMissing"), s.body.missingInformation.map((m) => E(m) + " <em>(not provided)</em>").join(" · ")) : "") +
        '<div class="sec-h">' + t("secNarrative") + prov("ai") + "</div>" +
        '<p class="small" style="white-space:pre-wrap">' + E(s.narrative || NP) + "</p></div>";
    } else if (tab === "intake") {
      if (!v.intake) { UI.state(body, "empty", t("intakeNotStarted")); return; }
      const it = v.intake;
      const stLabel = { ANSWERED: t("stAnswered"), SKIPPED: t("stSkipped"), PREFER_NOT: t("stPreferNot"), NOT_PROVIDED: t("stNotProvided") };
      const fields = {};
      it.items.forEach((q) => { (fields[q.field] = fields[q.field] || []).push(q); });
      body.innerHTML =
        '<div class="card"><div class="eyebrow">' + it.answered + "/" + it.total + " " + t("intakeAnswered") +
        (it.returning ? ' · <span class="chip gold">Returning visit</span>' : "") + "</div>" +
        Object.keys(fields).map((f) =>
          '<div class="sec-h">' + E(f) + "</div>" +
          fields[f].map((q) =>
            '<div class="intake-q' + (q.status !== "ANSWERED" ? " skipped" : "") + '">' +
            '<div class="q-text">' + E(q.question) + "</div>" +
            '<div class="q-ans">' + (q.status === "ANSWERED" ? "<strong>" + E(String(q.value || "")) + "</strong>" : "<span>" + chip(stLabel[q.status]) + "</span>") + "</div></div>"
          ).join("")
        ).join("") + "</div>";
    } else if (tab === "documents") {
      if (!visitDocs.length) { UI.state(body, "empty", t("noDocs")); return; }
      body.innerHTML = "<div>" + visitDocs.map(docCard).join("") + "</div>";
      bindDocActions(body);
    } else if (tab === "timeline") {
      API.get("/patients/" + patientId + "/timeline").then((r) => {
        const evs = (r.success ? r.data.events : []).filter((e) => e.visitId === v.visitId);
        if (!evs.length) { UI.state(body, "empty", "No events for this visit yet."); return; }
        body.innerHTML = '<div class="card"><div class="timeline">' + evs.map((e) =>
          '<div class="tl-item"><div class="small"><strong>' + E(e.title) + "</strong> <span class='sub'>· " + E(e.sourceType) + "</span>" +
          (e.detail ? "<div class='sub'>" + E(e.detail) + "</div>" : "") +
          '<div class="sub">' + UI.fmtTime(e.createdAt || e.occurredOn) + "</div></div></div>").join("") + "</div></div>";
      }).catch(() => UI.state(body, "error", E("Could not load timeline.")));
      return;
    }
  }

  function sumSection(title, html) {
    return '<div class="sum-sec"><h4>' + title + '</h4><div class="val">' + (html || E(t("notProvided"))) + "</div></div>";
  }
  function medText(list, key) {
    if (!list || !list.length) return "";
    return list.map((m) => E(typeof m === "string" ? m : (m[key || "name"] || ""))).join(", ");
  }
  function ayushText(a) {
    const keys = ["prakriti", "vikriti", "ahara", "vihara", "nidana", "sara", "samhanana", "pramana", "satmya", "sattva", "aharaShakti", "vyayamaShakti", "vaya", "samprapti"];
    return keys.filter((k) => a[k]).map((k) => "<strong>" + E(k) + ":</strong> " + E(a[k])).join("<br/>");
  }

  /* ---------------- Documents & Reports ---------------- */
  async function vDocuments() {
    setActiveNav("documents");
    setHeader("Uploads & reports", t("pDocs"));
    const host = main();
    const [vRes, dRes] = await Promise.all([
      API.get("/patients/" + patientId + "/visits"),
      API.get("/patients/" + patientId + "/documents"),
    ]);
    if (!dRes.success) throw new Error(dRes.error.message);
    const visits = (vRes.success ? vRes.data.items : []) || [];
    const docs = dRes.data.items || [];
    host.innerHTML =
      '<div class="card" style="max-width:760px"><div class="eyebrow">' + t("pUpTitle") + "</div>" +
      '<div class="dropzone" id="dz">' + UI.icon("doc", 26) +
      '<div style="margin-top:6px"><strong>' + t("pUpHint") + "</strong></div>" +
      '<input type="file" id="dzFile" accept="application/pdf,image/jpeg,image/png,.txt" hidden multiple/></div>' +
      '<div class="btn-row" style="max-width:760px"><select id="docVisitSel" style="border:1px solid var(--line);border-radius:10px;padding:8px;background:var(--white)">' +
      '<option value="">No visit (general)</option>' +
      visits.map((v) => '<option value="' + E(v.visitId) + '">' + E(v.chiefComplaint || v.complaintPathway || "visit") + " · " + UI.fmtTime(v.startedAt) + "</option>").join("") +
      '</select><select id="docTypeSel" style="border:1px solid var(--line);border-radius:10px;padding:8px;background:var(--white)">' +
      ["PRESCRIPTION", "LAB_REPORT", "MEDICAL_REPORT", "IMAGING", "OTHER"].map((x) => '<option>' + x + "</option>").join("") + "</select>" +
      '<button class="btn tiny" id="dzUpload">' + t("pUpBtn") + "</button></div>" +
      '<div id="dzOut" style="margin-top:10px"></div></div>' +
      '<div class="card" style="margin-top:14px"><div class="eyebrow">' + t("longTitle") + "</div><div id=\"docList\">" +
      (docs.length ? docs.map(docCard).join("") : '<div class="state"><div>' + t("noDocs") + "</div></div>") + "</div></div>";

    const dz = host.querySelector("#dz");
    const fileInput = host.querySelector("#dzFile");
    let picked = [];
    dz.addEventListener("click", () => fileInput.click());
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      dz.classList.remove("drag");
      picked = Array.from(e.dataTransfer.files || []);
      paintPicked();
    });
    fileInput.addEventListener("change", () => { picked = Array.from(fileInput.files || []); paintPicked(); });
    function paintPicked() {
      host.querySelector("#dzOut").innerHTML = picked.map((f, i) =>
        '<div class="doc-line">' + UI.icon("doc", 14) + " <strong>" + E(f.name) + '</strong><span class="sub">' + Math.round(f.size / 1024) + " KB</span>" +
        '<button class="ic-btn" data-rm="' + i + '" title="Remove">' + UI.icon("x", 12) + "</button></div>"
      ).join("");
      host.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { picked.splice(Number(b.dataset.rm), 1); paintPicked(); }));
    }
    host.querySelector("#dzUpload").addEventListener("click", async () => {
      if (!picked.length) { UI.toast("Choose or drop a file first"); return; }
      const visitSel = host.querySelector("#docVisitSel").value;
      const typeSel = host.querySelector("#docTypeSel").value;
      const out = host.querySelector("#dzOut");
      const results = [];
      for (const f of picked) {
        out.innerHTML = '<div class="state"><span class="st-ic st-spin"></span><div>Uploading ' + E(f.name) + "…</div></div>";
        const r = await API.upload("/documents/upload", formData({ patientId, visitId: visitSel || null, documentType: typeSel, file: f }));
        if (!r.success) { UI.toast(r.error.message); out.innerHTML = results.join(""); picked = []; return; }
        results.push(uploadLineHtml(r.data));
      }
      out.innerHTML = results.join("");
      bindDocActions(out);
      picked = [];
      setTimeout(async () => {
        const again = await API.get("/patients/" + patientId + "/documents");
        if (again.success) host.querySelector("#docList").innerHTML = again.data.items.map(docCard).join("");
        bindDocActions(host.querySelector("#docList"));
      }, 2500);
    });
    bindDocActions(host.querySelector("#docList"));

    function uploadLineHtml(doc) {
      const st = doc.processingStatus;
      const stages = ["UPLOADED", "PROCESSING", "PROCESSED"];
      const idx = Math.max(0, stages.indexOf(st));
      return (
        '<div class="doc-line">' + UI.icon("doc", 14) + " <strong>" + E(doc.originalFilename) + "</strong>" + chip(st) + "</div>" +
        '<div class="doc-pipe">' + stages.map((x, i) => '<span class="' + (i < idx ? "done" : i === idx ? "on" : "") + '">' + x + "</span>").join("") + "</div>" +
        (st === "PROCESSED" ? '<div class="btn-row"><button class="btn ghost tiny" data-ext="' + E(doc.id) + '">' + t("pUpReview") + "</button></div>" : "")
      );
    }
    function docUploaded(doc, out) {
      out.innerHTML = uploadLineHtml(doc);
      bindDocActions(out);
    }
  }

  function docCard(d) {
    return '<div class="doc-card2"><div class="d-top"><strong class="d-name">' + UI.icon("doc", 15) + " " + E(d.originalFilename) + "</strong>" +
      "<span>" + chip(d.documentType || "FILE") + "</span><span>" + chip(d.processingStatus) + "</span></div>" +
      '<div class="d-meta"><span>' + UI.fmtTime(d.createdAt) + "</span>" + (d.sizeBytes ? "<span>" + Math.round(d.sizeBytes / 1024) + " KB</span>" : "") + "</div>" +
      '<div class="btn-row"><button class="btn tiny" data-view="' + E(d.id) + '">' + t("docsView") + "</button>" +
      '<button class="btn ghost tiny" data-full="' + E(d.id) + '">' + t("docsFull") + "</button>" +
      '<button class="btn ghost tiny" data-ext="' + E(d.id) + '">' + t("docsExt") + "</button></div></div>";
  }

  function bindDocActions(scope) {
    if (!scope) return;
    const all = Array.from(scope.querySelectorAll("[data-view]")).map((b) => ({ id: b.dataset.view, btn: b }));
    // we need doc objects — fetch lazily via a global cache filled by lists
    all.forEach(({ id, btn }) => btn.addEventListener("click", () => openDocById(id)));
    scope.querySelectorAll("[data-ext]").forEach((b) => b.addEventListener("click", () => openDocById(b.dataset.ext, { extract: true })));
    scope.querySelectorAll("[data-full]").forEach((b) => b.addEventListener("click", () => {
      window.open("/api/v1/documents/" + b.dataset.full + "/view?access_token=" + encodeURIComponent(PreclinicAPI.token()), "_blank", "noopener");
    }));
  }

  async function openDocById(id, opts) {
    const r = await API.get("/documents/" + id);
    if (!r.success) { UI.toast(r.error.message); return; }
    PreclinicDocViewer.open(r.data, opts);
  }

  function formData(obj) {
    const fd = new FormData();
    Object.keys(obj).forEach((k) => { if (obj[k] !== null && obj[k] !== undefined) fd.append(k, obj[k]); });
    return fd;
  }

  /* ---------------- Processing Status ---------------- */
  async function vProcessing() {
    setActiveNav("processing");
    setHeader("Where things stand", t("pProc"));
    const host = main();
    const vRes = await API.get("/patients/" + patientId + "/visits");
    if (!vRes.success) throw new Error(vRes.error.message);
    const visits = vRes.data.items || [];
    if (!visits.length) { UI.state(host, "empty", t("pProcNone")); return; }
    host.innerHTML =
      '<div class="card" style="max-width:760px"><div class="field" style="max-width:420px"><label>' + t("longTitle") + "</label>" +
      '<select id="procSel">' + visits.map((v, i) => '<option value="' + E(v.visitId) + '"' + (i === 0 ? " selected" : "") + ">" +
      E(v.chiefComplaint || v.complaintPathway || "visit") + " · " + UI.fmtTime(v.startedAt) + "</option>").join("") + "</select></div>" +
      '<div id="procOut"></div></div>';
    const out = host.querySelector("#procOut");
    async function draw() {
      const visitId = host.querySelector("#procSel").value;
      UI.state(out, "loading", "Loading…");
      const r = await API.get("/patients/" + patientId + "/processing?visitId=" + visitId);
      if (!r.success) throw new Error(r.error.message);
      const steps = r.data.steps || [];
      out.innerHTML = steps.map((s) =>
        '<div class="proc-step' + (s.done ? " done" : (s.active ? " now" : "")) + '"><div class="p-dot">' + (s.done ? "✓" : "·") + "</div>" +
        "<div><b>" + E(s.label) + (s.at ? " <span class='sub'>· " + UI.fmtTime(s.at) + "</span>" : "") + "</b>" +
        '<div class="sub">' + E(s.detail || "") + "</div></div></div>"
      ).join("") +
      '<p class="small muted" style="margin-top:10px">Steps complete only when the backend confirms them.</p>';
    }
    host.querySelector("#procSel").addEventListener("change", () => draw().catch((e) => UI.toast(e.message)));
    draw().catch((e) => UI.toast(e.message));
  }

  /* ---------------- Profile ---------------- */
  async function vProfile() {
    setActiveNav("profile");
    setHeader("Your record", t("pProfile"));
    const host = main();
    const r = await API.get("/patients/" + patientId);
    if (!r.success) throw new Error(r.error.message);
    const p = r.data;
    host.innerHTML =
      '<div class="card profile-form"><div class="eyebrow">Account</div><div class="kv">' +
      '<div><b>Patient ID</b><span class="mono">' + E(p.patientId) + "</span></div>" +
      '<div><b>Role</b><span>Patient</span></div>' +
      '<div><b>Registered</b><span>' + UI.fmtTime(p.createdAt) + "</span></div>" +
      '<div><b>Login</b><span class="mono">' + E(user.loginId || patientId) + "</span></div></div>" +
      '<div class="sec-h">Profile</div>' +
      '<div class="grid-2">' +
      '<div class="field"><label>Full name</label><input id="pfName" value="' + E(p.fullName || "") + '"/></div>' +
      '<div class="field"><label>Date of birth</label><input id="pfDob" type="date" value="' + E(p.dateOfBirth ? String(p.dateOfBirth).slice(0, 10) : "") + '"/></div>' +
      '<div class="field"><label>Sex</label><select id="pfSex"><option value="">—</option><option ' + (p.sex === "FEMALE" ? "selected" : "") + ">FEMALE</option><option " + (p.sex === "MALE" ? "selected" : "") + ">MALE</option><option " + (p.sex === "OTHER" ? "selected" : "") + ">OTHER</option></select></div>" +
      '<div class="field"><label>Blood group</label><input id="pfBlood" value="' + E(p.bloodGroup || "") + '" placeholder="e.g. B+"/></div>' +
      "</div>" +
      '<div class="field"><label>Phone</label><input id="pfPhone" value="' + E(p.phone || "") + '"/></div>' +
      '<div class="field"><label>Address</label><textarea id="pfAddr" rows="2">' + E(p.address || "") + "</textarea></div>" +
      '<button class="btn" id="pfSave">Save profile</button>' +
      '<div class="sec-h">' + t("pConsent") + "</div>" +
      '<p class="small muted">Consent for AI-assisted intake is taken at the start of every visit. Read the ' +
      '<a href="/privacy">' + t("privTitle") + "</a> page for how your information is handled.</p></div>";
    host.querySelector("#pfSave").addEventListener("click", async () => {
      const g = (id) => host.querySelector(id).value.trim();
      const r2 = await API.patch("/patients/" + patientId, {
        fullName: g("#pfName") || null,
        dateOfBirth: g("#pfDob") || null,
        sex: g("#pfSex") || null,
        bloodGroup: g("#pfBlood") || null,
        phone: g("#pfPhone") || null,
        address: g("#pfAddr") || null,
      });
      UI.toast(r2.success ? "Profile saved" : (r2.error && r2.error.message));
      if (r2.success) vProfile();
    });
  }

  /* ---------------- Notifications ---------------- */
  async function vNotifications() {
    setActiveNav("notifications");
    setHeader("Real application events", t("pNotif"));
    const host = main();
    const r = await API.get("/patients/" + patientId + "/notifications?limit=35");
    if (!r.success) throw new Error(r.error.message);
    const items = r.data.items || [];
    UI.state(host, "empty", t("pNotifNone"));
    if (!items.length) return;
    host.innerHTML = '<div class="card" style="max-width:760px"><div class="feed">' + items.map(feedRow).join("") + "</div></div>";
  }

  /* ---------------- Emergency ---------------- */
  async function vEmergency() {
    setActiveNav("emergency");
    setHeader("Help desk", t("pEm"));
    const host = main();
    const r = await API.get("/patients/" + patientId + "/emergencies");
    const active = r.success ? (r.data.items || []).filter((e) => e.status === "ACTIVE" || e.status === "ACKNOWLEDGED") : [];
    host.innerHTML =
      '<div class="card" style="max-width:720px">' +
      (active.length ?
        active.map((e) => '<div class="em-card"><div class="e-top"><strong>' + E(e.status) + "</strong><span>" + chip(e.priority) + "</span></div>" +
          '<div class="e-reason">' + E(e.reason || "—") + "</div>" +
          '<div class="e-meta"><span>' + t("emTime") + " " + UI.fmtTime(e.createdAt) + "</span><span>" + t("emRule") + ": " + E(e.ruleId || t("emManual")) + "</span></div></div>").join("") +
        '<p class="small muted" style="margin-top:10px">' + t("pEmActive") + "</p>" :
        "") +
      '<div class="sec-h">New request</div>' +
      '<p class="small muted">' + t("pEmBody") + "</p>" +
      '<div class="field"><label>' + t("pEmReason") + '</label><textarea id="emReason" rows="3"></textarea></div>' +
      '<button class="btn warn" id="emSend">' + t("pEmSend") + "</button>" +
      '<div id="emConfirmBox" class="hidden" style="margin-top:12px"><div class="banner-ai">' + UI.icon("alert", 16) +
      "<div><strong>" + t("pEmTitle") + "</strong><div id=\"emConfirmText\" class=\"small\"></div></div></div>" +
      '<div class="btn-row"><button class="btn warn" id="emConfirm">' + t("pEmConfirm") + "</button>" +
      '<button class="btn ghost" id="emBack">' + t("pEmBack") + "</button></div></div>" +
      "</div>";
    let reason = "";
    host.querySelector("#emSend").addEventListener("click", () => {
      reason = host.querySelector("#emReason").value.trim();
      if (reason.length < 4) { UI.toast(t("pEmReason")); return; }
      host.querySelector("#emConfirmText").textContent = reason;
      host.querySelector("#emConfirmBox").classList.remove("hidden");
    });
    host.querySelector("#emBack").addEventListener("click", () => { host.querySelector("#emConfirmBox").classList.add("hidden"); });
    host.querySelector("#emConfirm").addEventListener("click", async () => {
      const vRes = await API.get("/patients/" + patientId + "/visits");
      const latest = (vRes.success ? vRes.data.items : [])[0];
      const r2 = await PreclinicEmergency.trigger(patientId, latest ? latest.visitId : null, reason);
      if (!r2.success) { UI.toast(r2.error.message); return; }
      UI.toast(t("pEmSent"));
      vEmergency();
    });
  }

  /* ---------------- Settings ---------------- */
  async function vSettings() {
    setActiveNav("settings");
    setHeader("Preferences", t("pSettings"));
    const host = main();
    host.innerHTML =
      '<div class="card" style="max-width:520px"><div class="eyebrow">Language</div>' +
      '<p class="small muted">' + I.t("langHelp") + "</p>" +
      '<div class="options">' +
      [["en", "English"], ["hi", "हिन्दी"], ["ta", "தமிழ்"], ["bn", "বাংলা"]].map(([c, l]) =>
        '<button type="button" class="lang-opt" data-lang="' + c + '">' + l + "</button>").join("") + "</div>" +
      '<div class="sec-h">' + t("pConsent") + '</div><p class="small"><a href="/privacy">' + t("privTitle") + " →</a></p>" +
      '<div class="btn-row"><a class="btn ghost" href="/login">Sign out &amp; switch account</a></div></div>';
  }

  /* ---------------- Tutorial ---------------- */
  async function vTutorial() {
    setActiveNav("tutorial");
    setHeader("Learn the patient desk", I.t("tutTitle"));
    const host = main();
    const done = window.PreclinicTutorial.isDone("PATIENT");
    host.innerHTML =
      '<div class="card" style="max-width:560px"><div class="eyebrow">' + I.t("tutEyebrow") + "</div>" +
      "<h3>" + I.t("tutTitle") + "</h3>" +
      '<p class="muted" style="font-size:14px">' + I.t("tutDesc") + "</p>" +
      (done ? '<p class="small" style="margin:10px 0"><span class="chip ok">' + I.t("tutDone") + "</span></p>" : "") +
      '<div class="btn-row">' +
      '<button class="btn" id="tutStart">' + UI.icon("guide", 15) + " " + I.t(done ? "tutReplay" : "tutStart") + "</button>" +
      '<button class="btn ghost" data-tut-back>' + I.t("back") + " ←</button>" +
      "</div></div>";
    host.querySelector("#tutStart").addEventListener("click", startPatientTour);
    host.querySelector("[data-tut-back]").addEventListener("click", () => go("dashboard"));
  }

  function startPatientTour() {
    const t = I.t;
    window.PreclinicTutorial.start("PATIENT", [
      { id: "dashboard", title: t("tutP1t"), body: t("tutP1b"), goFirst: "/", target: "#patMain .card" },
      { id: "newvisit", title: t("tutP2t"), body: t("tutP2b"), target: '#patNav a[data-route="new"]', goFirst: "/" },
      { id: "pathway", title: t("tutP3t"), body: t("tutP3b"), goFirst: "new-visit", target: ".pathway" },
      { id: "answer", title: t("tutP4t"), body: t("tutP4b"), target: "#qBox" },
      { id: "history", title: t("tutP5t"), body: t("tutP5b"), target: ".hist-grid" },
      { id: "docs", title: t("tutP6t"), body: t("tutP6b"), target: "#dz" },
      { id: "review", title: t("tutP7t"), body: t("tutP7b"), target: "#sumOut" },
      { id: "submit", title: t("tutP8t") + " / " + t("tutP9t"), body: t("tutP8b") + " " + t("tutP9b"), target: "#sumActions" },
    ]);
  }

  /* ================= Wizard (7 steps) ================= */
  async function wizardBoot(visitId) {
    setActiveNav("new");
    setHeader("New visit intake", t("pNew"));
    const host = main();
    if (!visitId) {
      wiz.step = 1; wiz.visit = null; wiz.sessionId = null; wiz.question = null; wiz.pathway = null; wiz.chiefExtra = ""; wiz.reuseFrom = null;
      UI.state(host, "loading", "Loading…");
      wizRender(1, host);
      return;
    }
    // Resume an existing visit.
    UI.state(host, "loading", "Loading…");
    const vRes = await API.get("/visits/" + visitId);
    if (!vRes.success) throw new Error(vRes.error.message);
    const v = vRes.data;
    wiz.visit = v;
    wiz.pathway = v.complaintPathway;
    wiz.chiefExtra = v.chiefComplaint || "";
    if (v.summary) { wizRender(7, host, true); return; }
    const sess = await API.post("/ai/session", { visitId: v.visitId });
    if (!sess.success) throw new Error(sess.error.message);
    wiz.sessionId = sess.data.sessionId;
    wiz.question = sess.data.question || null;
    if (v.history) { wizRender(6, host); return; } // structured but no summary → documents step
    if (sess.data.complete) { wizRender(5, host); return; }
    wiz.chat = [];
    wizRender(4, host, sess.data);
  }

  function wizStepBar(step) {
    const total = 7;
    const names = ["Language", "Consent", "Complaint", "Interview", "History & AYUSH", "Documents", "Summary review"];
    return '<div class="wizard-head"><div><div class="eyebrow">' + I.t("stepOf", { n: step }) + " · " + names[step - 1] + "</div>" +
      '<h3 style="margin:2px 0 0">' + t("pNew") + "</h3></div>" +
      '<button class="btn ghost tiny" id="wizBack">' + t("backDesk") + "</button></div>" +
      '<div class="progress"><span style="width:' + Math.round((step / total) * 100) + '%"></span></div>';
  }

  function wizRender(step, host, payload) {
    wiz.step = step;
    host.innerHTML = wizStepBar(step) + '<div id="wizBody" class="wizard-card"></div>';
    host.querySelector("#wizBack").addEventListener("click", () => { location.hash = "#/"; });
    const body = host.querySelector("#wizBody");
    UI.state(body, "loading", "Loading…");
    const fns = { 1: wizIntro, 2: wizConsent, 3: wizPathway, 4: wizInterview, 5: wizHistory, 6: wizDocuments, 7: wizSummary };
    fns[step](body, payload).catch((err) => {
      console.error(err);
      UI.state(body, "error", E(err.message || "Something went wrong."));
    });
  }

  /* Step 1 — intro + language */
  async function wizIntro(body) {
    body.innerHTML =
      '<div class="card"><h3>' + I.t("langTitle") + "</h3>" +
      '<p class="muted small">' + I.t("langHelp") + "</p>" +
      '<div class="options">' +
      [["en", "English"], ["hi", "हिन्दी"], ["ta", "தமிழ்"], ["bn", "বাংলা"]].map(([c, l]) =>
        '<button type="button" class="lang-opt" data-lang="' + c + '">' + l + "</button>").join("") + "</div>" +
      '<div class="sec-h">What happens next</div>' +
      '<ol class="small">' +
      "<li>" + I.t("consentGo") + "</li>" +
      "<li>" + I.t("aiTitle") + " — " + I.t("aiHelp") + "</li>" +
      "<li>" + I.t("histTitle") + "</li>" +
      "<li>" + I.t("docsHelp") + "</li>" +
      "<li>" + I.t("confirmHelp") + "</li></ol>" +
      '<div class="btn-row"><button class="btn" id="wNext">' + I.t("continue") + " →</button></div></div>";
    body.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => I.setLang(b.dataset.lang)));
    body.querySelector("#wNext").addEventListener("click", () => wizRender(2, hostOf(body)));
  }

  /* Step 2 — consent */
  async function wizConsent(body) {
    body.innerHTML =
      '<div class="card"><h3>' + I.t("consentTitle") + "</h3>" +
      '<p class="small">' + I.t("consentBody") + "</p>" +
      '<label style="display:flex;gap:10px;align-items:flex-start;margin:14px 0;font-size:14px">' +
      '<input type="checkbox" id="consentChk" style="width:18px;height:18px;margin-top:2px"/> <span>' + I.t("consentChk") + '</span></label>' +
      '<div class="btn-row"><button class="btn" id="wNext" disabled>' + I.t("continue") + " →</button></div></div>";
    body.querySelector("#consentChk").addEventListener("change", (e) => { body.querySelector("#wNext").disabled = !e.target.checked; });
    body.querySelector("#wNext").addEventListener("click", () => wizRender(3, hostOf(body)));
  }

  /* Step 3 — pathway + returning intelligence */
  async function wizPathway(body) {
    body.innerHTML =
      '<div class="card"><h3>' + I.t("complaintTitle") + '</h3><p class="small muted">' + I.t("complaintHelp") + "</p>" +
      '<div id="pathways" class="pathway-grid"></div>' +
      '<div class="field" style="margin-top:10px"><label>' + I.t("extraLabel") + '</label><input id="chiefExtra" placeholder="' + I.t("extraPh") + '"/></div>' +
      '<div id="prevPanel"></div>' +
      '<div class="btn-row"><button class="btn" id="wNext">' + I.t("continue") + " →</button></div></div>";
    function onPick(id) {
      wiz.pathway = id;
      PreclinicIntake.renderPathways(body.querySelector("#pathways"), id, onPick);
      checkRelated(id, body);
    }
    PreclinicIntake.renderPathways(body.querySelector("#pathways"), wiz.pathway, onPick);
    body.querySelector("#chiefExtra").addEventListener("input", (e) => { wiz.chiefExtra = e.target.value.trim(); });
    body.querySelector("#wNext").addEventListener("click", async () => {
      const panel = body.querySelector("#prevPanel");
      if (!wiz.pathway) { UI.toast(I.t("complaintTitle")); return; }
      if (panel.dataset.pending === "1") { UI.toast(t("pPrevFound") + " — " + t("pPrevReview") + " / " + t("pPrevFresh")); return; }
      await startVisitFlow(body);
    });

    async function checkRelated(pathway) {
      const panel = body.querySelector("#prevPanel");
      if (pathway === "OTHER") { panel.innerHTML = ""; panel.dataset.pending = "0"; return; }
      panel.innerHTML = '<div class="state"><span class="st-ic st-spin"></span><div>Checking previous visits…</div></div>';
      const r = await API.get("/patients/" + patientId + "/visits/related?pathway=" + pathway);
      panel.dataset.pending = "0";
      if (!r.success || !(r.data.items || []).length) { panel.innerHTML = ""; return; }
      const prev = r.data.items[0];
      panel.dataset.pending = "1";
      panel.innerHTML =
        '<div class="banner-ai" style="margin:12px 0">' + UI.icon("history", 16) +
        "<div><strong>" + t("pPrevFound") + "</strong> — " + E(prev.pathway || prev.chiefComplaint || "previous visit") + " · " + UI.fmtTime(prev.startedAt) + " · " + chip(prev.status) +
        (prev.reasons && prev.reasons.length ? '<div class="small" style="margin-top:3px">' + prev.reasons.map(E).join(" · ") + "</div>" : "") +
        '<div class="btn-row">' +
        '<button class="btn tiny" id="prevReview">' + t("pPrevReview") + "</button>" +
        '<button class="btn ghost tiny" id="prevFresh">' + t("pPrevFresh") + "</button></div></div></div>";
      panel.querySelector("#prevFresh").addEventListener("click", () => {
        panel.innerHTML = '<p class="small muted">' + t("pPrevFresh") + " ✓</p>";
        panel.dataset.pending = "0";
      });
      panel.querySelector("#prevReview").addEventListener("click", async () => {
        panel.innerHTML = '<div class="state"><span class="st-ic st-spin"></span><div>Loading previous visit…</div></div>';
        const v = await API.get("/visits/" + prev.visitId);
        if (!v.success) { panel.innerHTML = ""; return; }
        const h = v.data.history || {};
        const ay = v.data.ayush || {};
        const ayText = ["prakriti", "vikriti", "ahara", "vihara", "nidana"].filter((k) => ay[k]).map((k) => "<strong>" + E(k) + ":</strong> " + E(ay[k])).join("<br/>");
        const meds = (h.medications || []).map((m) => typeof m === "string" ? m : (m.name || "")).join(", ");
        const alls = (h.allergies || []).map((a) => typeof a === "string" ? a : (a.substance || "")).join(", ");
        panel.innerHTML =
          '<div class="card" style="background:#faf7ef;margin-top:10px"><div class="eyebrow">' + t("pPrevFound") + " · " + UI.fmtTime(v.data.startedAt) + " · " + chip(v.data.status) + "</div>" +
          '<div class="cmp-row"><b>Complaint</b>' + E(v.data.chiefComplaint || "—") + "</div>" +
          (meds ? '<div class="cmp-row"><b>' + t("secMeds") + "</b>" + E(meds) + "</div>" : "") +
          (alls ? '<div class="cmp-row"><b>' + t("secAllergies") + "</b>" + E(alls) + "</div>" : "") +
          (h.pastMedicalHistory ? '<div class="cmp-row"><b>' + t("secMedHist") + "</b>" + E(h.pastMedicalHistory) + "</div>" : "") +
          (ayText ? '<div class="cmp-row"><b>AYUSH</b>' + ayText + "</div>" : "") +
          '<p class="small muted" style="margin:8px 0">' + t("pPrevNote") + "</p>" +
          '<div class="btn-row"><button class="btn tiny" id="prevUse">' + t("pPrevUse") + "</button>" +
          '<button class="btn ghost tiny" id="prevAny">' + t("pPrevAny") + "</button></div></div>";
        panel.dataset.pending = "0";
        panel.querySelector("#prevUse").addEventListener("click", () => {
          wiz.reuseFrom = prev.visitId;
          panel.innerHTML = '<p class="small muted">Starting with previous information ✓</p>';
        });
        panel.querySelector("#prevAny").addEventListener("click", () => {
          wiz.reuseFrom = null;
          panel.innerHTML = '<p class="small muted">' + t("pPrevAny") + " ✓</p>";
        });
      });
    }
  }

  async function startVisitFlow(body) {
    const chief = wiz.chiefExtra || (wiz.pathway || "").replace(/_/g, " ");
    const res = await API.post("/visits", {
      patientId,
      complaintPathway: wiz.pathway || "OTHER",
      chiefComplaint: chief,
      language: I.lang(),
      consent: true,
    });
    if (!res.success) throw new Error(res.error.message);
    wiz.visit = res.data;
    API.patch("/patients/" + patientId, { language: I.lang() }).catch(() => {});
    const sess = await API.post("/ai/session", { visitId: res.data.visitId, reuseFrom: wiz.reuseFrom });
    if (!sess.success) throw new Error(sess.error.message);
    wiz.sessionId = sess.data.sessionId;
    wiz.chat = [];
    wizRender(4, hostOf(body), sess.data);
  }

  /* Step 4 — interview */
  async function wizInterview(body, payload) {
    body.innerHTML =
      '<div class="card"><div class="eyebrow">' + I.t("aiTitle") +
      (payload && payload.returning ? ' · <span class="chip gold">Returning visit — only changes are asked</span>' : "") + "</div>" +
      '<div class="chat" id="chat" style="margin:10px 0"></div>' +
      '<div class="q-box" id="qBox"><div class="q-text" id="qText">…</div>' +
      '<div class="options" id="qOptions"></div></div>' +
      '<div class="progress" style="margin-top:10px"><span id="qProgress"></span></div>' +
      '<div class="field" style="margin-top:10px"><input id="ansText" placeholder="' + I.t("ansPh") + '" autocomplete="off"/></div>' +
      '<div class="voice-state hidden" id="voiceState" aria-live="polite"></div>' +
      '<div class="intake-actions">' +
      '<button class="btn tiny" id="sendAns">' + I.t("send") + "</button>" +
      '<button class="btn ghost tiny" id="voiceBtn">' + UI.icon("mic", 13) + ' <span id="voiceLbl">' + I.t("voice") + '</span> <span class="rec-dot hidden" id="recDot"></span></button>' +
      '<button class="btn ghost tiny" id="skipAns">' + I.t("dunno") + "</button>" +
      '<button class="btn ghost tiny" id="preferNot">' + I.t("preferNot") + "</button>" +
      '<button class="btn ghost tiny" id="repeatQ">' + I.t("repeat") + "</button></div>" +
      '<div class="btn-row hidden" id="interviewDone"><button class="btn" id="wNext">' + I.t("continue") + " →</button></div></div>";

    const chat = body.querySelector("#chat");
    function addBubble(text, me) {
      if (!text) return;
      const div = document.createElement("div");
      div.className = "bubble" + (me ? " me" : "");
      div.textContent = text;
      chat.appendChild(div);
      chat.scrollTop = 99999;
    }
    function paintQuestion(pl) {
      const qBox = body.querySelector("#qBox");
      const opts = body.querySelector("#qOptions");
      wiz.question = pl.question || null;
      if (pl.complete || !pl.question) {
        body.querySelector("#qText").textContent = I.t("intDone");
        opts.innerHTML = "";
        body.querySelector("#interviewDone").classList.remove("hidden");
        return;
      }
      body.querySelector("#interviewDone").classList.add("hidden");
      body.querySelector("#qText").textContent = pl.question.text;
      PreclinicIntake.speak(pl.question.text);
      opts.innerHTML = "";
      (pl.question.options || []).forEach((o) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = o;
        b.addEventListener("click", () => sendAnswer(o, "TOUCH"));
        opts.appendChild(b);
      });
      body.querySelector("#qProgress").style.width = Math.round((pl.progress || 0) * 100) + "%";
    }
    async function sendAnswer(text, mode, action) {
      if (!wiz.sessionId) return;
      if (text) addBubble(text, true);
      const res = await API.post("/ai/message", {
        sessionId: wiz.sessionId,
        text: text || "",
        inputMode: mode || "TEXT",
        action: action || "answer",
        questionId: wiz.question ? wiz.question.id : null,
      });
      if (!res.success) { UI.toast(res.error.message); return; }
      if (res.data.emergencies && res.data.emergencies.length) UI.toast(I.t("emAlert"));
      if (res.data.question) addBubble(res.data.question.text, false);
      else if (res.data.complete) addBubble(I.t("thanks"), false);
      paintQuestion(res.data);
    }
    // resume: show opening + current question
    if (payload) {
      addBubble(payload.opening || "", false);
      paintQuestion(payload);
    }
    body.querySelector("#sendAns").addEventListener("click", () => {
      const inp = body.querySelector("#ansText");
      const val = inp.value.trim();
      if (!val) return;
      inp.value = "";
      sendAnswer(val, "TEXT");
    });
    body.querySelector("#ansText").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); body.querySelector("#sendAns").click(); } });
    body.querySelector("#skipAns").addEventListener("click", () => sendAnswer("", "TOUCH", "i_dont_know"));
    body.querySelector("#preferNot").addEventListener("click", () => sendAnswer("", "TOUCH", "prefer_not_to_answer"));
    body.querySelector("#repeatQ").addEventListener("click", () => sendAnswer("", "TOUCH", "repeat"));
    /* Voice: transcript goes into the answer field (in the spoken language,
       never translated); the patient reviews and sends. States: ready /
       listening / transcript received / no speech / mic unavailable /
       access denied / browser unsupported. */
    let rec = null;
    let recTimer = null;
    let userStopped = false;
    const vState = () => body.querySelector("#voiceState");
    function setVoiceState(text, kind) {
      const el = vState();
      if (!el) return;
      if (!text) { el.classList.add("hidden"); el.textContent = ""; return; }
      el.classList.remove("hidden");
      el.className = "voice-state " + (kind || "");
      el.textContent = text;
    }
    function setListeningUI(on) {
      const btn = body.querySelector("#voiceBtn");
      const dot = body.querySelector("#recDot");
      const lbl = body.querySelector("#voiceLbl");
      if (!btn || !dot || !lbl) return;
      btn.classList.toggle("listening", !!on);
      dot.classList.toggle("hidden", !on);
      lbl.textContent = I.t(on ? "voiceStop" : "voice");
    }
    function clearRec() {
      if (recTimer) { clearTimeout(recTimer); recTimer = null; }
      if (rec) { try { rec.stop(); } catch (_e) { /* ignore */ } rec = null; }
      setListeningUI(false);
    }
    body.querySelector("#voiceBtn").addEventListener("click", () => {
      if (rec) { // toggle: stop listening
        userStopped = true;
        clearRec();
        return;
      }
      if (!PreclinicIntake.voiceSupported()) {
        setVoiceState(I.t("voiceUnsupported"), "err");
        return;
      }
      userStopped = false;
      setVoiceState(I.t("voiceReady"), "info");
      setListeningUI(true);
      rec = PreclinicIntake.listen((txt) => {
        rec = null;
        if (recTimer) { clearTimeout(recTimer); recTimer = null; }
        setListeningUI(false);
        if (txt) {
          const inp = body.querySelector("#ansText");
          inp.value = inp.value ? inp.value + " " + txt : txt;
          inp.focus();
          setVoiceState(I.t("voiceGot"), "ok");
        } else if (!userStopped) {
          setVoiceState(I.t("voiceNoSpeech"), "warn");
        }
      }, {
        onState: (state) => {
          if (state === "listening") { setVoiceState(I.t("voiceListening"), "live"); return; }
          if (state === "transcript" || state === "ready") return;
          if (userStopped) return;
          const map = {
            ended: ["voiceNoSpeech", "warn"],
            nospeech: ["voiceNoSpeech", "warn"],
            unavailable: ["voiceUnavail", "err"],
            denied: ["voiceDenied", "err"],
            unsupported: ["voiceUnsupported", "err"],
            langUnsupported: ["voiceLangUnsupported", "err"],
          };
          const m = map[state];
          if (!m) return;
          if (state !== "unsupported" && state !== "langUnsupported") clearRec();
          setVoiceState(I.t(m[0]), m[1]);
        },
      });
      if (!rec) { setListeningUI(false); setVoiceState(I.t("voiceUnsupported"), "err"); return; }
      recTimer = setTimeout(() => { if (rec) { userStopped = true; clearRec(); setVoiceState(I.t("voiceUnavail"), "err"); } }, 20000);
    });
    body.querySelector("#wNext").addEventListener("click", () => wizRender(5, hostOf(body)));
  }

  /* Step 5 — health history + AYUSH — fixed systematic layout, no giant gaps */
  async function wizHistory(body) {
    let h = {};
    let ay = {};
    if (wiz.visit) {
      const vRes = await API.get("/visits/" + wiz.visit.visitId);
      if (vRes.success) { h = vRes.data.history || {}; ay = vRes.data.ayush || {}; }
    }
    const reuseNote = wiz.reuseFrom
      ? '<div class="banner-ai" style="margin-bottom:12px">' + UI.icon("history", 14) + "<div class=\"small\">" + t("pPrevNote") + "</div></div>" : "";
    body.innerHTML =
      '<div class="card" style="max-width:780px">' + reuseNote +
      '<h3 style="margin:0 0 12px">' + t("pHistTitle") + "</h3>" +
      '<div class="hist-grid">' +
        '<div class="hist-group"><div class="eyebrow">Medical history</div>' +
          '<div class="field"><label>' + I.t("pmh") + '</label><textarea id="pmh" rows="2">' + E(h.pastMedicalHistory || "") + "</textarea></div>" +
          '<div class="field"><label>' + I.t("psh") + '</label><textarea id="psh" rows="2">' + E(h.pastSurgicalHistory || "") + "</textarea></div>" +
          '<div class="field"><label>' + I.t("fh") + '</label><textarea id="fh" rows="2">' + E(h.familyHistory || "") + "</textarea></div>" +
          '<div class="field"><label>' + I.t("worries") + '</label><textarea id="concerns" rows="2">' + E(h.patientConcerns || "") + "</textarea></div>" +
        "</div>" +
        '<div class="hist-group"><div class="eyebrow">' + t("pMeds") + " & " + t("pAllergies") + "</div>" +
          '<div class="field"><label>' + t("pMeds") + ' <span class="muted">(comma separated)</span></label><input id="meds" value="' + E((h.medications || []).map((m) => typeof m === "string" ? m : (m.name || "")).join(", ")) + '"/></div>' +
          '<div class="field"><label>' + t("pAllergies") + ' <span class="muted">(comma separated)</span></label><input id="alls" value="' + E((h.allergies || []).map((a) => typeof a === "string" ? a : (a.substance || "")).join(", ")) + '"/></div>' +
          '<div class="sec-h" style="margin-top:16px">' + t("pAyushOpt") + "</div>" +
          '<p class="small muted" style="margin:-4px 0 8px">' + t("pAyushNote") + "</p>" +
          '<div class="ayush-grid">' +
            ayushFieldRow("prakriti", ay.prakriti || "") + ayushFieldRow("vikriti", ay.vikriti || "") +
            ayushFieldRow("ahara", ay.ahara || "") + ayushFieldRow("vihara", ay.vihara || "") + ayushFieldRow("nidana", ay.nidana || "") +
          "</div>" +
        "</div>" +
      "</div>" +
      '<div class="form-actions"><button class="btn ghost" id="wBack">← ' + I.t("back") + "</button><button class=\"btn\" id=\"wNext\">" + I.t("continue") + " →</button></div>" +
      "</div>";

    const FIELDS = ["prakriti", "vikriti", "ahara", "vihara", "nidana"];
    FIELDS.forEach((f) => {
      const row = body.querySelector('[data-ayush="' + f + '"]');
      if (!row) return;
      row.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => {
        row.querySelector("input").value = "";
      }));
    });
    body.querySelector("#wBack").addEventListener("click", () => wizRender(4, hostOf(body)));
    body.querySelector("#wNext").addEventListener("click", async () => {
      const g = (id) => body.querySelector(id).value.trim();
      const res = await API.patch("/visits/" + wiz.visit.visitId, {
        history: {
          pastMedicalHistory: g("#pmh") || null,
          pastSurgicalHistory: g("#psh") || null,
          familyHistory: g("#fh") || null,
          patientConcerns: g("#concerns") || null,
          medications: g("#meds") ? g("#meds").split(",").map((s) => s.trim()).filter(Boolean) : [],
          allergies: g("#alls") ? g("#alls").split(",").map((s) => s.trim()).filter(Boolean) : [],
        },
        ayush: {
          prakriti: g("#prakriti") || "",
          vikriti: g("#vikriti") || "",
          ahara: g("#ahara") || "",
          vihara: g("#vihara") || "",
          nidana: g("#nidana") || "",
        },
      });
      if (!res.success) { UI.toast(res.error.message); return; }
      wizRender(6, hostOf(body));
    });
  }

  function ayushFieldRow(f, val) {
    return '<div class="field compact-field" data-ayush="' + f + '">' +
      '<label>' + f + "</label>" +
      '<div class="ayush-input-row"><input id="' + f + '" value="' + E(val) + '" placeholder="' + t("pNotSure") + " / " + t("pNone") + '"/>' +
      '<div class="btn-row tiny"><button type="button" class="btn ghost tiny" data-q="' + t("pNotSure") + '">' + t("pNotSure") + "</button>" +
      '<button type="button" class="btn ghost tiny" data-q="' + t("pNone") + '">' + t("pNone") + "</button>" +
      '<button type="button" class="btn ghost tiny" data-q="' + t("pSkip") + '">' + t("pSkip") + "</button></div></div></div>";
  }

  /* Step 6 — documents */
  async function wizDocuments(body) {
    body.innerHTML =
      '<div class="card"><h3>' + t("pUpTitle") + "</h3>" +
      '<div class="dropzone" id="dz">' + UI.icon("doc", 26) +
      '<div style="margin-top:6px"><strong>' + t("pUpHint") + "</strong></div>" +
      '<input type="file" id="dzFile" accept="application/pdf,image/jpeg,image/png,.txt" hidden multiple/></div>' +
      '<div class="btn-row"><select id="docTypeSel" style="border:1px solid var(--line);border-radius:10px;padding:8px;background:var(--white)">' +
      ["PRESCRIPTION", "LAB_REPORT", "MEDICAL_REPORT", "IMAGING", "OTHER"].map((x) => '<option>' + x + "</option>").join("") + "</select>" +
      '<button class="btn tiny" id="dzUpload" disabled>' + t("pUpBtn") + "</button></div>" +
      '<div id="dzOut" style="margin-top:10px"></div>' +
      '<div class="btn-row">' +
      '<button class="btn ghost" id="wBack">← ' + I.t("back") + "</button>" +
      '<button class="btn" id="wNext">' + t("pUpContinue") + "</button></div></div>";

    const dz = body.querySelector("#dz");
    const fileInput = body.querySelector("#dzFile");
    const out = body.querySelector("#dzOut");
    let picked = [];
    dz.addEventListener("click", () => fileInput.click());
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
    dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("drag"); picked = Array.from(e.dataTransfer.files || []); paint(); });
    fileInput.addEventListener("change", () => { picked = Array.from(fileInput.files || []); paint(); });
    function paint() {
      body.querySelector("#dzUpload").disabled = !picked.length;
      out.innerHTML = picked.map((f, i) =>
        '<div class="doc-line">' + UI.icon("doc", 14) + " <strong>" + E(f.name) + '</strong><span class="sub">' + Math.round(f.size / 1024) + " KB</span>" +
        '<button class="ic-btn" data-rm="' + i + '" title="Remove">' + UI.icon("x", 12) + "</button></div>"
      ).join("");
      out.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { picked.splice(Number(b.dataset.rm), 1); paint(); }));
    }
    body.querySelector("#dzUpload").addEventListener("click", async () => {
      const typeSel = body.querySelector("#docTypeSel").value;
      const results = [];
      for (const f of picked) {
        out.innerHTML = '<div class="state"><span class="st-ic st-spin"></span><div>Uploading ' + E(f.name) + "…</div></div>";
        const r = await API.upload("/documents/upload", formData({ patientId, visitId: wiz.visit.visitId, documentType: typeSel, file: f }));
        if (!r.success) { UI.toast(r.error.message); out.innerHTML = results.join(""); return; }
        const d = r.data;
        const stages = ["UPLOADED", "PROCESSING", "PROCESSED"];
        const idx = Math.max(0, stages.indexOf(d.processingStatus));
        results.push(
          '<div class="doc-line">' + UI.icon("doc", 14) + " <strong>" + E(d.originalFilename) + "</strong>" + chip(d.processingStatus) + "</div>" +
          '<div class="doc-pipe">' + stages.map((x, i) => '<span class="' + (i < idx ? "done" : i === idx ? "on" : "") + '">' + x + "</span>").join("") + "</div>" +
          (d.processingStatus === "PROCESSED" ? '<div class="btn-row"><button class="btn ghost tiny" data-ext="' + E(d.id) + '">' + t("pUpReview") + "</button></div>" : "")
        );
      }
      out.innerHTML = results.join("");
      bindDocActions(out);
      picked = [];
      body.querySelector("#dzUpload").disabled = true;
    });
    body.querySelector("#wBack").addEventListener("click", () => wizRender(5, hostOf(body)));
    body.querySelector("#wNext").addEventListener("click", () => wizRender(7, hostOf(body)));
  }

  /* Step 7 — AI summary review */
  async function wizSummary(body, resumeOnly) {
    body.innerHTML =
      '<div class="card"><div class="eyebrow">' + t("pSumPrep") + "</div>" +
      '<div id="sumOut"><div class="state"><span class="st-ic st-spin"></span><div>' + t("pSumPrep") + "</div></div></div>" +
      '<div class="btn-row" id="sumActions" style="display:none">' +
      '<button class="btn ghost" id="sumMyAns">' + t("pSumMyAns") + "</button>" +
      '<button class="btn ghost" id="sumCorrect">' + t("pSumCorrect") + "</button>" +
      '<button class="btn ok" id="sumConfirm">' + t("pSumConfirm") + "</button>" +
      '<button class="btn ghost" id="sumWrong">' + t("pSumWrong") + "</button></div></div>";
    const out = body.querySelector("#sumOut");
    let s = null;
    if (resumeOnly && wiz.visit && wiz.visit.summary) {
      s = wiz.visit.summary;
    } else {
      const st = await API.post("/ai/structure-history", { visitId: wiz.visit.visitId, sessionId: wiz.sessionId });
      if (st.success) {
        const g = await API.post("/ai/generate-summary", { visitId: wiz.visit.visitId });
        if (g.success) s = g.data;
      }
    }
    if (!s) {
      out.innerHTML = '<div class="state"><span class="st-ic st-bad">!</span><div>' + E(t("pSumPrep").replace("…", "")) + " — could not be prepared. Try again." + '</div><div class="btn-row"><button class="btn tiny" id="sumRetry">Retry</button></div>';
      out.querySelector("#sumRetry").addEventListener("click", () => wizRender(7, hostOf(body)));
      return;
    }
    const h = wiz.visit.history || {};
    const b = s.body || {};
    const NP = t("notProvided");
    out.innerHTML =
      '<div class="banner-ai">' + UI.icon("summary", 16) + "<div><strong>" + t("aiBanner") + "</strong><br/>" + t("aiDisclaimer") + "</div></div>" +
      sumSection(t("secPresenting"), '<strong>' + E(wiz.visit.chiefComplaint || NP) + "</strong> · " + E(wiz.visit.complaintPathway || "—")) +
      (b.patientWords && b.patientWords.length ? sumSection("In your words", b.patientWords.map((w) => '<span class="chip leaf" style="margin:2px 4px 2px 0">' + E(w) + "</span>").join("")) : "") +
      sumSection(t("secMedHist"), E(h.pastMedicalHistory || NP)) +
      sumSection(t("secSurgical"), E(h.pastSurgicalHistory || NP)) +
      sumSection(t("secFamily"), E(h.familyHistory || NP)) +
      sumSection(t("secMeds"), medText(h.medications)) +
      sumSection(t("secAllergies"), medText(h.allergies, "substance")) +
      (wiz.visit.ayush && Object.keys(wiz.visit.ayush).some((k) => wiz.visit.ayush[k]) ? sumSection(t("secAyush"), ayushText(wiz.visit.ayush)) : "") +
      (b.missingInformation && b.missingInformation.length ? sumSection(t("secMissing"), b.missingInformation.map((m) => E(m) + " <em>(not provided)</em>").join(" · ")) : "") +
      '<div class="sec-h">' + t("secNarrative") + ' <span class="prov ai">' + t("srcAi") + "</span></div>" +
      '<p class="small" style="white-space:pre-wrap">' + E(s.narrative || NP) + "</p>";
    body.querySelector("#sumActions").style.display = "";

    body.querySelector("#sumMyAns").addEventListener("click", () => openMyAnswers());
    body.querySelector("#sumCorrect").addEventListener("click", () => wizRender(5, hostOf(body)));
    body.querySelector("#sumConfirm").addEventListener("click", async () => {
      const r = await API.post("/ai/verify-summary", { visitId: wiz.visit.visitId, action: "PATIENT_CONFIRMED" });
      if (!r.success) { UI.toast(r.error.message); return; }
      UI.toast(I.t("confirmed"));
      location.hash = "#/";
    });
    body.querySelector("#sumWrong").addEventListener("click", async () => {
      await API.post("/ai/verify-summary", { visitId: wiz.visit.visitId, action: "REJECTED" });
      UI.toast(I.t("rejected"));
      wizRender(4, hostOf(body));
    });

    async function openMyAnswers() {
      const vRes = await API.get("/visits/" + wiz.visit.visitId);
      if (!vRes.success) { UI.toast(vRes.error.message); return; }
      const it = vRes.data.intake;
      if (!it) { UI.toast(t("intakeNotStarted")); return; }
      const stLabel = { ANSWERED: t("stAnswered"), SKIPPED: t("stSkipped"), PREFER_NOT: t("stPreferNot"), NOT_PROVIDED: t("stNotProvided") };
      const fields = {};
      it.items.forEach((q) => { (fields[q.field] = fields[q.field] || []).push(q); });
      const ov = document.createElement("div");
      ov.className = "modal-ov";
      ov.innerHTML = '<div class="modal"><div class="modal-head"><strong>' + t("pSumMyAns") + '</strong><button class="ic-btn" id="maClose">✕</button></div><div style="max-height:70vh;overflow:auto">' +
        it.answered + "/" + it.total + " " + t("intakeAnswered") +
        Object.keys(fields).map((f) =>
          '<div class="sec-h">' + E(f) + "</div>" +
          fields[f].map((q) =>
            '<div class="intake-q' + (q.status !== "ANSWERED" ? " skipped" : "") + '"><div class="q-text">' + E(q.question) + "</div>" +
            '<div class="q-ans">' + (q.status === "ANSWERED" ? "<strong>" + E(String(q.value || "")) + "</strong>" : "<span>" + chip(stLabel[q.status]) + "</span>") + "</div></div>"
          ).join("")
        ).join("") + "</div></div>";
      document.body.appendChild(ov);
      ov.addEventListener("click", (e) => { if (e.target === ov) ov.remove(); });
      ov.querySelector("#maClose").addEventListener("click", () => ov.remove());
    }
  }

  function hostOf(el) { return main(); }

  /* ---------------- Boot ---------------- */
  function boot() {
    I.apply(document);
    // delegated: language buttons render dynamically (settings, wizard step 1)
    document.addEventListener("click", (e) => {
      const b = e.target && e.target.closest ? e.target.closest("[data-lang]") : null;
      if (b && b.hasAttribute("data-lang")) I.setLang(b.getAttribute("data-lang"));
    });
    document.addEventListener("preclinic:lang", () => route());
    const NAV_ICONS = { dashboard: "dashboard", new: "plus", history: "history", documents: "documents", processing: "clock", profile: "profile", notifications: "bell", tutorial: "guide", emergency: "siren", settings: "settings" };
    UI.$$("#patNav a").forEach((a) => {
      const slot = a.querySelector(".ic-slot");
      if (slot) slot.innerHTML = UI.icon(NAV_ICONS[a.dataset.route] || "dashboard");
    });
    UI.bindLogout("#logoutBtn");
    const who = document.getElementById("whoBox");
    if (who) who.innerHTML = "<strong>" + E(user.displayName || patientId) + '</strong><span class="small mono">' + E(patientId) + "</span>";
    const fab = document.getElementById("fabEm");
    if (fab) {
      fab.hidden = false;
      fab.innerHTML = UI.icon("siren", 15) + " " + t("pEm");
      fab.addEventListener("click", () => location.hash = "#/emergency");
    }
    window.addEventListener("hashchange", route);
    if (!location.hash) location.hash = "#/";
    route();
  }

  global.PreclinicPatient = { boot };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
