/* Preclinic IQ AI — Doctor workspace (hash-routed SPA).
 * Every button performs a real API action; state comes from the database only. */
(function (global) {
  "use strict";
  const UI = global.PreclinicUI;
  const API = global.PreclinicAPI;
  const I18n = global.PreclinicI18n;
  const E = UI.esc;
  const t = (k) => I18n.t(k);

  let user = null;
  const queueState = { q: "", status: "ALL" };
  const sumState = { q: "", status: "ALL" };
  const docState = { q: "" };

  const main = () => document.getElementById("docMain");

  function setHeader(eyebrow, title) {
    const e = document.getElementById("pageEyebrow");
    const p = document.getElementById("pageTitle");
    if (e) e.textContent = eyebrow;
    if (p) p.textContent = title;
  }

  function setActiveNav(name) {
    UI.$$("#docNav a").forEach((a) => a.classList.toggle("active", a.dataset.route === name));
  }

  function statusChip(s) { return UI.chip(s); }

  function retryHost(msg) {
    return UI.state(main(), "error", E(msg), '<button class="btn ghost tiny" data-retry>Retry</button>');
  }

  /* ---------------- Routing ---------------- */
  function parseHash() {
    const raw = (location.hash || "#/").replace(/^#/, "");
    const [pathPart, queryPart] = raw.split("?");
    const parts = pathPart.split("/").filter(Boolean);
    const q = {};
    if (queryPart) new URLSearchParams(queryPart).forEach((v, k) => { q[k] = v; });
    return { parts, q };
  }

  function route() {
    const { parts, q } = parseHash();
    document.title = "Doctor · Preclinic IQ AI";
    if (parts[0] === "case" && parts[1]) return PreclinicDoctorCase.open(parts[1], parts[2] || "overview");
    if (parts[0] === "patient" && parts[1]) return PreclinicDoctorCase.openPatient(parts[1]);
    const name = parts[0] || "dashboard";
    setActiveNav(name === "" ? "dashboard" : name);
    const views = {
      dashboard: vDashboard, queue: vQueue, emergency: vEmergency, patients: vPatients,
      summaries: vSummaries, documents: vDocuments, pending: vPending, verified: vVerified,
      activity: vActivity, notifications: vNotifications, profile: vProfile, settings: vSettings, tutorial: vTutorial,
    };
    const host = main();
    UI.state(host, "loading", "Loading…");
    const fn = views[name] || vDashboard;
    fn(q).catch((err) => {
      console.error(err);
      UI.state(host, "error", E(err.message || "Something went wrong."), '<button class="btn ghost tiny" onclick="location.reload()">Retry</button>');
    });
  }

  /* ---------------- Dashboard ---------------- */
  async function vDashboard() {
    setHeader("Kayachikitsa · Pre-clinical context", t("todayDesk"));
    const host = main();
    const res = await API.get("/doctor/dashboard");
    if (!res.success) throw new Error(res.error.message);
    const d = res.data;

    const kpis = [
      { n: d.pendingReviews, l: t("kpiPending"), ic: "clock", em: false, to: "#/queue?status=AWAITING_DOCTOR" },
      { n: d.inIntake, l: t("kpiIntake"), ic: "queue", em: false, to: "#/queue?status=IN_INTAKE" },
      { n: d.activeEmergencies, l: t("kpiEm"), ic: "siren", em: true, to: "#/emergency" },
      { n: d.verifiedToday, l: t("kpiVerified"), ic: "verified", em: false, to: "#/verified" },
    ].map((k) =>
      '<div class="kpi2' + (k.em ? " em" : "") + '" data-to="' + k.to + '"><div class="n">' + k.n +
      '</div><div class="l">' + UI.icon(k.ic, 14) + E(k.l) + "</div></div>"
    ).join("");

    const emCards = (d.emergencyPreview || []).map(emCard).join("");
    const emBlock = (d.emergencyPreview || []).length
      ? '<div>' + (d.emergencyPreview || []).map(emCard).join("") +
        '<div class="btn-row"><a class="btn ghost tiny" href="#/emergency">' + t("emDesk") + " →</a></div></div>"
      : '<div class="state"><span class="st-ic">✓</span><div>' + t("emNone") + "</div></div>";

    const queueRows = d.queuePreview.map((v) =>
      '<tr class="clickable" data-visit="' + E(v.visitId) + '"><td><strong>' + E(v.patientName) + '</strong><div class="sub mono">' + E(v.patientId) + "</div></td>" +
      "<td>" + E(v.chiefComplaint || "—") + "</td><td>" + statusChip(v.status) + "</td>" +
      '<td>' + UI.relTime(v.startedAt) + '</td><td><button class="btn tiny" data-open="' + E(v.visitId) + '">' + t("openCase") + "</button></td></tr>"
    ).join("");

    host.innerHTML =
      '<div class="dash-grid">' + kpis + "</div>" +
      '<div class="two-col"><div class="card"><div class="eyebrow">' + t("navQueue") + "</div>" +
      '<div class="table-wrap"><table class="tbl2"><thead><tr><th>Patient</th><th>' + t("ovComplaint") + "</th><th>" + t("sumStatus") + "</th><th>" + t("emTime") + "</th><th></th></tr></thead>" +
      "<tbody>" + (queueRows || '<tr><td colspan="5"><div class="state"><div>' + t("queueNone") + "</div></div></td></tr>") + "</tbody></table></div>" +
      '<div class="btn-row"><a class="btn ghost tiny" href="#/queue">' + t("navQueue") + " →</a></div></div>" +
      '<div class="card"><div class="eyebrow">' + t("emDesk") + "</div>" + emBlock + "</div></div>";

    host.querySelectorAll("[data-to]").forEach((el) => el.addEventListener("click", () => { location.hash = el.dataset.to; }));
    host.querySelectorAll("[data-open]").forEach((el) => el.addEventListener("click", (ev) => {
      ev.stopPropagation(); location.hash = "#/case/" + el.dataset.open;
    }));
    host.querySelectorAll("tr[data-visit]").forEach((tr) => tr.addEventListener("click", () => { location.hash = "#/case/" + tr.dataset.visit; }));
    bindEmActions(host);
  }

  function emCard(em) {
    const isAck = em.status === "ACKNOWLEDGED";
    return '<div class="em-card' + (isAck ? " ack" : "") + '" data-alert="' + E(em.id) + '">' +
      '<div class="e-top"><strong>' + E(em.patientName) + '</strong><span class="mono small">' + E(em.patientId) + "</span>" +
      "<span>" + UI.chip(em.priority) + "</span><span>" + statusChip(em.status) + "</span></div>" +
      '<div class="e-reason">' + E(em.reason || "—") + "</div>" +
      '<div class="e-meta"><span>' + t("emRule") + ": <strong>" + E(em.ruleId || t("emManual")) + "</strong></span>" +
      "<span>" + UI.fmtTime(em.createdAt) + "</span>" +
      (em.visitId ? '<span class="mono">' + E(String(em.visitId).slice(0, 8)) + "</span>" : "") + "</div>" +
      '<div class="btn-row">' +
      (em.visitId ? '<a class="btn ghost tiny" href="#/case/' + E(em.visitId) + '">' + t("openCase") + "</a>" : "") +
      (em.status === "ACTIVE" ? '<button class="btn tiny" data-ack="' + E(em.id) + '">' + t("ack") + "</button>" : "") +
      (em.status !== "RESOLVED" && em.status !== "FALSE_POSITIVE" ? '<button class="btn tiny ok" data-res="' + E(em.id) + '">' + t("resolve") + "</button>" : "") +
      "</div></div>";
  }

  function bindEmActions(host) {
    host.querySelectorAll("[data-ack]").forEach((b) => b.addEventListener("click", async () => {
      const res = await API.post("/emergency/" + b.dataset.ack + "/acknowledge", {});
      UI.toast(res.success ? "Acknowledged" : (res.error && res.error.message));
      route();
    }));
    host.querySelectorAll("[data-res]").forEach((b) => b.addEventListener("click", async () => {
      const res = await API.post("/emergency/" + b.dataset.res + "/resolve", { resolution: "RESOLVED" });
      UI.toast(res.success ? "Resolved" : (res.error && res.error.message));
      route();
    }));
  }

  /* ---------------- Queue ---------------- */
  async function vQueue(q) {
    if (q.status) queueState.status = q.status;
    if (q.q !== undefined) queueState.q = q.q;
    setHeader("Clinical workflow", t("navQueue"));
    const host = main();
    const labels = { ALL: t("qAll"), AWAITING_DOCTOR: t("qAwaiting"), IN_INTAKE: t("qIntake"), EMERGENCY: t("qEmergency"), VERIFIED: t("qVerified") };
    const seg = Object.keys(labels).map((s) =>
      '<button data-f="' + s + '" class="' + (queueState.status === s ? "on" : "") + '">' + labels[s] + "</button>"
    ).join("");
    host.innerHTML =
      '<div class="card"><div class="btn-row" style="margin-top:0"><div class="searchbar">' + UI.icon("search", 15) +
      '<input id="qSearch" placeholder="' + E(t("searchPh")) + '" value="' + E(queueState.q) + '"/></div>' +
      '<div class="seg">' + seg + "</div></div><div id=\"qBody\" style=\"margin-top:12px\"></div></div>";
    const body = host.querySelector("#qBody");
    UI.state(body, "loading", "Loading…");

    async function load() {
      UI.state(body, "loading", "Loading…");
      const params = new URLSearchParams();
      if (queueState.status !== "ALL") params.set("status", queueState.status);
      if (queueState.q) params.set("q", queueState.q);
      const res = await API.get("/doctor/queue?" + params.toString());
      if (!res.success) throw new Error(res.error.message);
      const items = res.data.items || [];
      if (!items.length) { UI.state(body, "empty", t("queueNone")); return; }
      const rows = items.map((v) =>
        '<tr class="clickable" data-visit="' + E(v.visitId) + '">' +
        "<td><strong>" + E(v.patientName) + "</strong>" + (v.hasEmergency ? " " + UI.icon("siren", 13) : "") + "</td>" +
        '<td class="mono">' + E(v.patientId) + "</td>" +
        "<td>" + E(v.chiefComplaint || "—") + "</td>" +
        "<td>" + statusChip(v.status) + "</td>" +
        "<td>" + UI.fmtTime(v.startedAt) + "</td>" +
        '<td class="sub">' + UI.relTime(v.lastUpdated) + "</td>" +
        '<td><button class="btn tiny" data-open="' + E(v.visitId) + '">' + t("openCase") + "</button></td></tr>"
      ).join("");
      body.innerHTML = '<div class="table-wrap"><table class="tbl2"><thead><tr><th>Patient</th><th>ID</th><th>' + t("ovComplaint") +
        "</th><th>" + t("sumStatus") + "</th><th>Time</th><th>Last updated</th><th></th></tr></thead><tbody>" + rows + "</tbody></table></div>";
      body.querySelectorAll("tr[data-visit]").forEach((tr) => tr.addEventListener("click", () => { location.hash = "#/case/" + tr.dataset.visit; }));
      body.querySelectorAll("[data-open]").forEach((el) => el.addEventListener("click", (ev) => { ev.stopPropagation(); location.hash = "#/case/" + el.dataset.open; }));
    }

    let deb = null;
    host.querySelector("#qSearch").addEventListener("input", (e) => {
      clearTimeout(deb);
      deb = setTimeout(() => { queueState.q = e.target.value.trim(); load().catch((err) => UI.state(body, "error", E(err.message))); }, 300);
    });
    host.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => {
      queueState.status = b.dataset.f;
      host.querySelectorAll("[data-f]").forEach((x) => x.classList.toggle("on", x === b));
      load().catch((err) => UI.state(body, "error", E(err.message)));
    }));
    load().catch((err) => UI.state(body, "error", E(err.message)));
  }

  /* ---------------- Emergency desk ---------------- */
  async function vEmergency() {
    setHeader("Red-flag safety net", t("emDesk"));
    const host = main();
    const [emRes, actRes] = await Promise.all([API.get("/emergency/active"), API.get("/doctor/emergencies")]);
    if (!emRes.success) throw new Error(emRes.error.message);
    const active = emRes.data.items || [];
    const history = (actRes.success ? actRes.data.items || [] : []).filter((e) => e.status === "RESOLVED" || e.status === "FALSE_POSITIVE").slice(0, 10);
    const acked = active.filter((e) => e.status === "ACKNOWLEDGED");
    const open = active.filter((e) => e.status === "ACTIVE");
    host.innerHTML =
      '<div class="card"><div class="eyebrow">' + t("qEmergency") + " · " + open.length + "</div>" +
      (open.length ? open.map(emCard).join("") : '<div class="state"><span class="st-ic">✓</span><div>' + t("emNone") + "</div></div>") + "</div>" +
      (acked.length ? '<div class="card" style="margin-top:14px"><div class="eyebrow">' + t("emAckSection") + "</div>" + acked.map(emCard).join("") + "</div>" : "") +
      (history.length ? '<div class="card" style="margin-top:14px"><div class="eyebrow">' + t("emClosed") + "</div><div class=\"feed\">" +
        history.map((e) => '<div><div class="f-ic">' + UI.icon("check", 14) + '</div><div><strong>' + E(e.patientName) + "</strong> <span class=\"mono small\">" + E(e.patientId) +
        "</span> — " + E(e.reason || "—") + '<div class="sub">' + t("emRule") + ": " + E(e.ruleId || t("emManual")) + " · " + UI.relTime(e.createdAt) + "</div></div></div>").join("") +
        "</div></div>" : "");
    bindEmActions(host);
  }

  /* ---------------- Patient records ---------------- */
  async function vPatients() {
    setHeader("Longitudinal records", t("recTitle"));
    const host = main();
    const res = await API.get("/doctor/patients?q=" + encodeURIComponent(docState.q || ""));
    if (!res.success) throw new Error(res.error.message);
    const items = res.data.items || [];
    if (!items.length) { UI.state(host, "empty", t("recNone")); return; }
    const rows = items.map((p) =>
      '<tr class="clickable" data-open="' + E(p.lastVisitId || "") + '" data-pat="' + E(p.id) + '">' +
      '<td class="mono">' + E(p.patientId) + "</td><td><strong>" + E(p.displayName) + "</strong></td>" +
      "<td>" + p.visitCount + "</td><td>" + p.documentCount + "</td>" +
      '<td class="sub">' + E(p.lastComplaint || "—") + "</td>" +
      '<td><button class="btn tiny" data-open="' + E(p.lastVisitId || "") + '" data-pat="' + E(p.id) + '">' + t("openCase") + "</button></td></tr>"
    ).join("");
    host.innerHTML =
      '<div class="card"><div class="table-wrap"><table class="tbl2"><thead><tr><th>ID</th><th>' + t("docsPatient") + "</th><th>Visits</th><th>Docs</th><th>" +
      t("recLast") + "</th><th></th></tr></thead><tbody>" + rows + "</tbody></table></div></div>";
    const go = (el) => {
      if (el.dataset.open) location.hash = "#/case/" + el.dataset.open;
      else if (el.dataset.pat) location.hash = "#/patient/" + el.dataset.pat;
    };
    host.querySelectorAll("tr[data-open], tr[data-pat]").forEach((tr) => tr.addEventListener("click", () => go(tr)));
    host.querySelectorAll("button[data-pat]").forEach((b) => b.addEventListener("click", (ev) => { ev.stopPropagation(); go(b); }));
  }

  /* ---------------- AI summaries ---------------- */
  async function vSummaries(q) {
    if (q.status) sumState.status = q.status;
    if (q.q !== undefined) sumState.q = q.q;
    setHeader("Source-linked context", t("sumTitle"));
    const host = main();
    const opts = {
      ALL: t("qAll"), AI_DRAFT: "AI Draft", PATIENT_CONFIRMED: t("pSumConfirm").replace("I ", ""),
      NEEDS_REVIEW: "Needs Review", DOCTOR_VERIFIED: "Doctor Verified", REJECTED: "Rejected",
    };
    const seg = Object.keys(opts).map((s) =>
      '<button data-f="' + s + '" class="' + (sumState.status === s ? "on" : "") + '">' + opts[s] + "</button>"
    ).join("");
    host.innerHTML = '<div class="card"><div class="btn-row" style="margin-top:0"><div class="seg">' + seg + "</div></div><div id=\"sBody\" style=\"margin-top:12px\"></div></div>";
    const body = host.querySelector("#sBody");
    UI.state(body, "loading", "Loading…");
    async function load() {
      UI.state(body, "loading", "Loading…");
      const params = new URLSearchParams();
      if (sumState.status !== "ALL") params.set("status", sumState.status);
      const res = await API.get("/doctor/summaries?" + params.toString());
      if (!res.success) throw new Error(res.error.message);
      const items = res.data.items || [];
      if (!items.length) { UI.state(body, "empty", "No summaries in this state."); return; }
      const rows = items.map((s) =>
        '<tr class="clickable" data-visit="' + E(s.visitId) + '"><td><strong>' + E(s.patientName) + "</strong></td>" +
        '<td class="mono">' + E(s.patientId) + "</td><td>" + E(s.chiefComplaint || "—") + "</td>" +
        "<td>" + statusChip(s.status) + "</td>" +
        '<td>' + (s.confidence || "—") + " · v" + s.version + "</td>" +
        '<td class="sub">' + UI.relTime(s.createdAt) + "</td>" +
        '<td><button class="btn tiny" data-visit="' + E(s.visitId) + '">Open</button></td></tr>'
      ).join("");
      body.innerHTML = '<div class="table-wrap"><table class="tbl2"><thead><tr><th>Patient</th><th>ID</th><th>' + t("ovComplaint") +
        "</th><th>" + t("sumStatus") + "</th><th>" + t("sumConf") + " / " + t("sumVer") + "</th><th>" + t("sumUpdated") + "<th></th></tr></thead><tbody>" + rows + "</tbody></table></div>";
      body.querySelectorAll("tr[data-visit]").forEach((tr) => tr.addEventListener("click", () => { location.hash = "#/case/" + tr.dataset.visit + "/summary"; }));
      body.querySelectorAll("button[data-visit]").forEach((b) => b.addEventListener("click", (ev) => { ev.stopPropagation(); location.hash = "#/case/" + b.dataset.visit + "/summary"; }));
    }
    host.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => {
      sumState.status = b.dataset.f;
      host.querySelectorAll("[data-f]").forEach((x) => x.classList.toggle("on", x === b));
      load().catch((err) => UI.state(body, "error", E(err.message)));
    }));
    load().catch((err) => UI.state(body, "error", E(err.message)));
  }

  /* ---------------- Documents ---------------- */
  async function vDocuments(q) {
    if (q && q.q !== undefined) docState.q = q.q;
    setHeader("Uploads, OCR & extraction", t("navDocs"));
    const host = main();
    const res = await API.get("/doctor/documents?q=" + encodeURIComponent(docState.q || ""));
    if (!res.success) throw new Error(res.error.message);
    const items = res.data.items || [];
    if (!items.length) { UI.state(host, "empty", "No documents uploaded yet."); return; }
    const cards = items.map((d) =>
      '<div class="doc-card2"><div class="d-top"><strong class="d-name">' + E(d.originalFilename) + "</strong>" +
      "<span>" + UI.chip(d.documentType || "FILE") + "</span><span>" + statusChip(d.processingStatus) + "</span></div>" +
      '<div class="d-meta"><span>' + E(d.patientName) + ' · <span class="mono">' + E(d.patientId) + "</span></span>" +
      "<span>" + UI.fmtTime(d.uploadedAt) + "</span>" +
      "<span>Entities: " + (d.entityCount == null ? "—" : d.entityCount) + (d.needsReview ? " · review required" : "") + "</span></div>" +
      '<div class="btn-row"><button class="btn tiny" data-view="' + E(d.id) + '">' + t("docsView") + "</button>" +
      '<button class="btn ghost tiny" data-full="' + E(d.id) + '">' + t("docsFull") + "</button>" +
      '<button class="btn ghost tiny" data-ext="' + E(d.id) + '">' + t("docsExt") + "</button></div></div>"
    ).join("");
    host.innerHTML = '<div class="card">' + cards + "</div>";
    const docsById = {}; items.forEach((d) => { docsById[d.id] = d; });
    host.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => PreclinicDocViewer.open(docsById[b.dataset.view])));
    host.querySelectorAll("[data-ext]").forEach((b) => b.addEventListener("click", () => PreclinicDocViewer.open(docsById[b.dataset.ext], { extract: true })));
    host.querySelectorAll("[data-full]").forEach((b) => b.addEventListener("click", () => {
      window.open("/api/v1/documents/" + b.dataset.full + "/view?access_token=" + encodeURIComponent(PreclinicAPI.token()), "_blank", "noopener");
    }));
  }

  /* ---------------- Pending reviews ---------------- */
  async function vPending() {
    setHeader("Your action needed", t("pendingTitle"));
    const host = main();
    const [qRes, sRes] = await Promise.all([
      API.get("/doctor/queue?status=AWAITING_DOCTOR"),
      API.get("/doctor/summaries?status=NEEDS_REVIEW"),
    ]);
    if (!qRes.success) throw new Error(qRes.error.message);
    const visits = qRes.data.items || [];
    const reviews = (sRes.success ? sRes.data.items || [] : []).filter((s) => !visits.some((v) => v.visitId === s.visitId));
    if (!visits.length && !reviews.length) { UI.state(host, "empty", t("pendingNone")); return; }
    const cards = visits.map((v) =>
      '<div class="visit-card"><div class="v-top"><span class="v-name">' + E(v.patientName) + "</span>" +
      '<span class="mono small">' + E(v.patientId) + "</span>" + statusChip(v.status) + "</div>" +
      '<div class="v-sub">' + E(v.chiefComplaint || "—") + " · updated " + UI.relTime(v.lastUpdated) + "</div>" +
      '<div class="v-actions"><button class="btn tiny" data-open="' + E(v.visitId) + '">' + t("openCase") + "</button>" +
      '<a class="btn ghost tiny" href="#/case/' + E(v.visitId) + '/summary">' + t("tabSummary") + "</a></div></div>"
    ).join("");
    const cards2 = reviews.map((s) =>
      '<div class="visit-card"><div class="v-top"><span class="v-name">' + E(s.patientName) + "</span>" +
      '<span class="mono small">' + E(s.patientId) + "</span>" + statusChip(s.status) +
      ' <span class="small muted">v' + s.version + " · " + (s.confidence || "") + "</span></div>" +
      '<div class="v-sub">' + E(s.chiefComplaint || "—") + " · " + UI.relTime(s.createdAt) + "</div>" +
      '<div class="v-actions"><button class="btn tiny" data-open="' + E(s.visitId) + '/summary">' + t("openCase") + "</button></div></div>"
    ).join("");
    host.innerHTML = '<div class="card"><div class="eyebrow">' + t("pendingSub") + "</div>" + cards + cards2 + "</div>";
    host.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => {
      const [vid, tab] = String(b.dataset.open).split("/");
      location.hash = "#/case/" + vid + (tab ? "/" + tab : "");
    }));
  }

  /* ---------------- Verified ---------------- */
  async function vVerified() {
    setHeader("Completed verifications", t("verifiedTitle"));
    const host = main();
    const res = await API.get("/doctor/summaries?status=DOCTOR_VERIFIED");
    if (!res.success) throw new Error(res.error.message);
    const items = res.data.items || [];
    if (!items.length) { UI.state(host, "empty", t("verifiedNone")); return; }
    const cards = items.map((s) =>
      '<div class="visit-card"><div class="v-top"><span class="v-name">' + E(s.patientName) + "</span>" +
      '<span class="mono small">' + E(s.patientId) + "</span>" + statusChip(s.status) +
      ' <span class="small muted">v' + s.version + " · " + (s.confidence || "") + "</span></div>" +
      '<div class="v-sub">' + E(s.chiefComplaint || "—") + " · verified " + UI.relTime(s.createdAt) + "</div>" +
      '<div class="v-actions"><button class="btn ghost tiny" data-open="' + E(s.visitId) + '">' + t("openCase") + "</button></div></div>"
    ).join("");
    host.innerHTML = '<div class="card"><div class="eyebrow">' + t("verifiedSub") + "</div>" + cards + "</div>";
    host.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => { location.hash = "#/case/" + b.dataset.open; }));
  }

  /* ---------------- Activity & notifications ---------------- */
  function feedHtml(items) {
    return items.map((it) => {
      const cls = it.type === "EMERGENCY" ? "em" : it.type === "SUMMARY" ? "ai" : it.type === "TIMELINE" && /verified/i.test(it.label) ? "ok" : "";
      const ic = it.type === "EMERGENCY" ? "siren" : it.type === "SUMMARY" ? "summary" : it.type === "TIMELINE" ? "activity" : "bell";
      return '<div><div class="f-ic ' + cls + '">' + UI.icon(ic, 14) + "</div><div>" +
        "<strong>" + E(it.label) + "</strong>" + (it.patientName ? " — " + E(it.patientName) + (it.patientId ? ' <span class="mono small">' + E(it.patientId) + "</span>" : "") : "") +
        (it.detail ? '<div class="sub">' + E(it.detail) + "</div>" : "") +
        '<div class="sub">' + UI.relTime(it.time) + "</div></div></div>";
    }).join("");
  }

  async function vActivity() {
    setHeader("Audit-backed feed", t("actTitle"));
    const host = main();
    const res = await API.get("/doctor/activity?limit=40");
    if (!res.success) throw new Error(res.error.message);
    const items = res.data.items || [];
    UI.state(host, "empty", t("actNone"));
    if (!items.length) return;
    host.innerHTML = '<div class="card"><div class="eyebrow">' + t("actSub") + '</div><div class="feed">' + feedHtml(items) + "</div></div>";
  }

  async function vNotifications() {
    setHeader("Live", t("notifTitle"));
    const host = main();
    const res = await API.get("/doctor/activity?limit=35");
    if (!res.success) throw new Error(res.error.message);
    const items = res.data.items || [];
    UI.state(host, "empty", t("pNotifNone"));
    if (!items.length) return;
    host.innerHTML = '<div class="card"><div class="eyebrow"><span class="chip warn" style="margin-right:8px">' + t("live") + "</span>" + t("notifSub") + '</div><div class="feed">' + feedHtml(items) + "</div></div>";
  }

  /* ---------------- Profile & settings ---------------- */
  /* ---------------- Tutorial ---------------- */
  async function vTutorial() {
    setHeader("Learn the clinician desk", t("tutTitle"));
    const host = main();
    const done = window.PreclinicTutorial.isDone("DOCTOR");
    host.innerHTML =
      '<div class="card" style="max-width:560px"><div class="eyebrow">' + t("tutEyebrow") + "</div>" +
      "<h3>" + t("tutTitle") + "</h3>" +
      '<p class="muted" style="font-size:14px">' + t("tutDescD") + "</p>" +
      (done ? '<p class="small" style="margin:10px 0"><span class="chip ok">' + t("tutDone") + "</span></p>" : "") +
      '<div class="btn-row">' +
      '<button class="btn" id="tutStart">' + UI.icon("guide", 15) + " " + t(done ? "tutReplay" : "tutStart") + "</button>" +
      '<button class="btn ghost" data-tut-back>' + t("back") + " ←</button>" +
      "</div></div>";
    host.querySelector("#tutStart").addEventListener("click", startDoctorTour);
    host.querySelector("[data-tut-back]").addEventListener("click", () => { location.hash = "#/"; });
  }

  function startDoctorTour() {
    const tt = t;
    window.PreclinicTutorial.start("DOCTOR", [
      { id: "dash", title: tt("tutD1t"), body: tt("tutD1b"), center: true },
      { id: "queue", title: tt("tutD2t"), body: tt("tutD2b"), goFirst: "queue", target: "#qBody .tbl2" },
      { id: "open", title: tt("tutD3t"), body: tt("tutD3b"), target: "#qBody [data-open]" },
      { id: "review", title: tt("tutD4t"), body: tt("tutD4b"), center: true },
      { id: "docs", title: tt("tutD5t"), body: tt("tutD5b"), goFirst: "documents", target: ".doc-card2" },
      { id: "verify", title: tt("tutD6t"), body: tt("tutD6b"), center: true },
    ]);
  }

  async function vProfile() {
    setHeader("Identity", t("profTitle"));
    const host = main();
    const res = await API.get("/doctor/profile");
    if (!res.success) throw new Error(res.error.message);
    const p = res.data;

    function viewHtml(d) {
      const kv = (k, v, mono) => "<div><b>" + k + "</b><span class=\"small" + (mono ? " mono" : "") + "\">" + E(v || "—") + "</span></div>";
      return '<div class="kv">' +
        kv("Name", d.displayName) +
        kv("Doctor ID", d.doctorId, true) +
        kv("Registration No", d.registrationNo, true) +
        kv("Department", d.department) +
        kv("Qualification", d.qualification) +
        kv("Email", d.email) +
        kv("Phone", d.phone) +
        "</div>" +
        '<p class="small muted" style="margin-top:10px">' + t("profReadOnlyNote") + "</p>" +
        '<div class="btn-row"><button class="btn" id="profEdit">' + UI.icon("settings", 14) + " " + t("profEdit") + "</button></div>";
    }
    function editHtml(d) {
      const field = (id, label, val, type) =>
        '<div class="field"><label>' + label + "</label><input id=\"" + id + "\" type=\"" + (type || "text") + "\" value=\"" + E(val || "") + "\"/></div>";
      const roField = (label, val) =>
        '<div class="field"><label>' + label + ' <span class="muted">(read-only)</span></label><input id="ro_' + label.replace(/\W+/g, "") + '" value="' + E(val || "—") + '" disabled style="opacity:.6"/></div>';
      return '<div class="profile-form">' +
        field("pfName", t("fullName"), d.displayName) +
        roField("Doctor ID", d.doctorId) +
        roField("Registration No", d.registrationNo) +
        '<div class="grid-2">' +
        field("pfDept", "Department", d.department) +
        field("pfQual", "Qualification", d.qualification) +
        field("pfEmail", "Email", d.email, "email") +
        field("pfPhone", "Phone", d.phone) +
        "</div>" +
        '<div class="btn-row"><button class="btn" id="profSave">' + t("profSave") + "</button>" +
        '<button class="btn ghost" id="profCancel">' + t("profCancel") + "</button></div></div>";
    }

    function bindView(d) {
      host.querySelector("#profEdit").addEventListener("click", () => {
        host.querySelector(".profile-card").innerHTML = "<div class=\"eyebrow\">" + t("profTitle") + "</div>" + editHtml(d);
        bindEdit(d);
      });
    }
    function bindEdit(d) {
      host.querySelector("#profCancel").addEventListener("click", async () => { await reload(); });
      host.querySelector("#profSave").addEventListener("click", async () => {
        const g = (id) => (host.querySelector(id) ? host.querySelector(id).value.trim() : null);
        const btn = host.querySelector("#profSave");
        btn.disabled = true;
        const r = await API.patch("/doctor/profile", {
          displayName: g("#pfName") || null,
          department: g("#pfDept") || null,
          qualification: g("#pfQual") || null,
          email: g("#pfEmail") || null,
          phone: g("#pfPhone") || null,
        });
        btn.disabled = false;
        if (!r.success) { UI.toast(r.error.message); return; }
        UI.toast(t("profSaved"));
        await reload();
      });
    }
    async function reload() {
      const r2 = await API.get("/doctor/profile");
      if (!r2.success) return;
      const d = r2.data;
      host.querySelector(".profile-card").innerHTML = "<div class=\"eyebrow\">" + t("profTitle") + "</div>" + viewHtml(d);
      bindView(d);
    }
    host.innerHTML = '<div class="card profile-card"><div class="eyebrow">' + t("profTitle") + "</div>" + viewHtml(p) + "</div>";
    bindView(p);
  }
  async function vSettings() {
    setHeader("Account", t("navSettings"));
    const host = main();
    const res = await API.get("/doctor/profile");
    if (!res.success) throw new Error(res.error.message);
    const p = res.data;
    host.innerHTML =
      '<div class="card settings-form"><div class="eyebrow">' + t("setSub") + "</div>" +
      '<div class="field"><label>Display name</label><input id="setName" value="' + E(p.displayName || "") + '"/></div>' +
      '<div class="field"><label>Email</label><input id="setEmail" value="' + E(p.email || "") + '" type="email"/></div>' +
      '<div class="field"><label>Phone</label><input id="setPhone" value="' + E(p.phone || "") + '"/></div>' +
      '<button class="btn" id="saveProfile">Save profile</button></div>';
    host.querySelector("#saveProfile").addEventListener("click", async () => {
      const body = {
        displayName: host.querySelector("#setName").value.trim() || null,
        email: host.querySelector("#setEmail").value.trim() || null,
        phone: host.querySelector("#setPhone").value.trim() || null,
      };
      const r = await API.patch("/doctor/profile", body);
      UI.toast(r.success ? "Profile updated" : (r.error && r.error.message));
      if (r.success) vSettings();
    });
  }

  /* ---------------- Boot ---------------- */
  function boot() {
    user = PreclinicAuth.requireRole("DOCTOR");
    if (!user) { window.location.replace("/login"); return; }
    I18n.apply(document);
    // delegated: language buttons render dynamically (settings view)
    document.addEventListener("click", (e) => {
      const b = e.target && e.target.closest ? e.target.closest("[data-lang]") : null;
      if (b && b.hasAttribute("data-lang")) I18n.setLang(b.getAttribute("data-lang"));
    });
    document.addEventListener("preclinic:lang", () => route()); // re-render in the new language
    const NAV_ICONS = { dashboard: "dashboard", queue: "queue", emergency: "siren", patients: "records", summaries: "summary", documents: "documents", pending: "clock", verified: "verified", activity: "activity", profile: "profile", notifications: "bell", tutorial: "guide", settings: "settings" };
    UI.$$("#docNav a").forEach((a) => {
      const slot = a.querySelector(".ic-slot");
      if (slot) slot.innerHTML = UI.icon(NAV_ICONS[a.dataset.route] || "dashboard");
    });
    UI.bindLogout("#logoutBtn");
    const who = document.getElementById("whoBox");
    if (who) who.innerHTML = "<strong>" + E(user.displayName) + '</strong><span class="small muted">' + E(user.doctorId || user.role) + "</span>";

    PreclinicEmergency.connect(() => {
      UI.toast("New emergency alert — check the Emergency Desk.", 6000);
      if (parseHash().parts[0] === "emergency") route();
    });

    window.addEventListener("hashchange", route);
    if (!location.hash) location.hash = "#/";
    route();
  }

  global.PreclinicDoctor = {
    boot,
    route,
    // shared helpers used by doctorCase.js
    _internal: { E, t, statusChip, setHeader, main, user: () => user, emCard, bindEmActions },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
