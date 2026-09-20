(function () {
  const ui = PreclinicUI;
  const I = PreclinicI18n;
  const API = PreclinicAPI;
  const user = PreclinicAuth.requireRole("ADMIN");
  if (!user) {
    document.body.innerHTML = '<div class="auth-wrap"><div class="card auth-card"><h2>Please sign in</h2><a class="btn" href="/login?role=admin">Sign in</a></div></div>';
    return;
  }
  ui.fillWho(user);
  ui.bindLogout("#logoutBtn");
  ui.navActive();
  I.bindSwitch();
  I.apply();

  const host = document.getElementById("admMain");
  const NAV_ICONS = { dashboard: "dashboard", patients: "records", doctors: "steth", "visits-docs": "documents", "emergency-audit": "siren" };
  ui.$$("#admNav a").forEach((a) => {
    const slot = a.querySelector(".ic-slot");
    if (slot && a.dataset.adm) slot.innerHTML = ui.icon(NAV_ICONS[a.dataset.adm] || "dashboard");
  });

  function setHeader(title, eyebrow) {
    const e = document.querySelector(".topbar .eyebrow");
    const p = document.querySelector(".topbar h2");
    if (e) e.textContent = eyebrow;
    if (p) p.textContent = title;
  }
  function E(x) { return ui.esc ? ui.esc(x) : String(x == null ? "" : x); }
  const VIEWS = { dashboard: vDashboard, patients: vPatients, doctors: vDoctors, "visits-docs": vVisitsDocs, "emergency-audit": vEmergencyAudit };

  function route() {
    const name = (location.hash || "#dashboard").replace(/^#/, "") || "dashboard";
    ui.$$("#admNav a").forEach((a) => a.classList.toggle("active", a.dataset.adm === name));
    const fn = VIEWS[name] || vDashboard;
    setHeader({ dashboard: "System control room", patients: "Patient management", doctors: "Doctor management", "visits-docs": "Visits & documents", "emergency-audit": "Emergency & audit" }[name] || "System control room", "Administration");
    ui.state(host, "loading", "Loading…");
    fn().catch((err) => {
      console.error(err);
      ui.state(host, "error", E(err.message || "Something went wrong."), '<button class="btn ghost tiny" onclick="location.reload()">Retry</button>');
    });
  }
  window.addEventListener("hashchange", route);

  /* ---------------- 1 · Dashboard ---------------- */
  async function vDashboard() {
    const [d, h, logs] = await Promise.all([
      API.get("/admin/dashboard"),
      API.get("/admin/system-health"),
      API.get("/admin/audit-logs?limit=8"),
    ]);
    if (!d.success) throw new Error(d.error.message);
    const s = d.data;
    const hb = h.success ? h.data : null;
    host.innerHTML =
      '<div class="grid-3 adm-kpis">' +
      kpi("Total patients", s.patients) +
      kpi("Doctors", s.doctors) +
      kpi("Active visits", s.activeVisits) +
      kpi("Pending reviews", s.awaitingDoctor) +
      kpi("Active emergencies", s.activeEmergencies, s.activeEmergencies > 0) +
      (hb ? '<div class="card kpi"><div class="eyebrow">System health</div><div class="small">' +
        "DB " + tag(hb.database === "up") + " · " + E(hb.dialect) + "<br/>Queue " + E(hb.queue) + " · AI " + E(hb.aiProvider) + " · OCR " + E(hb.ocrProvider) + "<br/>Jobs " + E(hb.jobs) + " · failed " + E(hb.failedJobs) +
        '</div></div>' : kpi("System health", "—")) +
      "</div>" +
      '<div class="card" style="margin-top:16px"><div class="eyebrow">Recent activity (audit)</div>' +
      '<div class="table-wrap"><table class="tbl2"><thead><tr><th>When</th><th>Action</th><th>Type</th><th>Resource</th><th>IP</th></tr></thead><tbody>' +
      (logs.success ? (logs.data.items || []).map((r) =>
        "<tr><td class='small'>" + ui.fmtTime(r.createdAt) + "</td><td class='log-action'>" + E(r.action) + "</td><td>" + E(r.resourceType) + "</td><td class='mono small'>" + E(r.resourceId || "") + "</td><td class='small'>" + E(r.ip || "") + "</td></tr>"
      ).join("") : "<tr><td colspan='5' class='muted'>No audit entries.</td></tr>") +
      "</tbody></table></div></div>";

    function kpi(label, n, em) {
      return '<div class="card kpi"><div class="eyebrow">' + label + '</div><div class="n' + (em ? " em" : "") + '">' + n + "</div></div>";
    }
    function tag(v) { return v === "up" ? "<span class='health-ok'>" + v + "</span>" : "<span class='health-bad'>" + E(v) + "</span>"; }
  }

  /* ---------------- 2 · Patient management ---------------- */
  async function vPatients() {
    host.innerHTML =
      '<div class="card"><div class="btn-row" style="margin-top:0"><div class="searchbar">' + ui.icon("search", 15) +
      '<input id="admPatQ" placeholder="Search patient ID, name or phone" /></div>' +
      '<span class="small muted" id="admPatCount"></span></div><div id="admPatBody" style="margin-top:12px"></div>' +
      '<div id="admPatDetail" style="margin-top:14px"></div></div>';
    const body = host.querySelector("#admPatBody");
    const detail = host.querySelector("#admPatDetail");
    let term = "";
    async function load() {
      ui.state(body, "loading", "Loading…");
      const res = await API.get("/admin/patients?q=" + encodeURIComponent(term));
      if (!res.success) throw new Error(res.error.message);
      const items = res.data.items || [];
      host.querySelector("#admPatCount").textContent = items.length + " patient(s)";
      if (!items.length) { ui.state(body, "empty", "No patients match."); detail.innerHTML = ""; return; }
      body.innerHTML =
        '<div class="table-wrap"><table class="tbl2"><thead><tr><th>Patient ID</th><th>Name</th><th>Phone</th><th>Visits</th><th>Files</th><th>Last visit</th></tr></thead><tbody>' +
        items.map((p) =>
          '<tr class="clickable" data-pid="' + p.patientId + '"><td class="mono">' + E(p.patientId) + "</td><td><strong>" + E(p.fullName) + "</strong>" +
          (p.lastComplaint ? " <span class='sub'>" + E(p.lastComplaint) + "</span>" : "") + "</td><td>" + E(p.phone || "—") +
          "</td><td>" + p.visitCount + "</td><td>" + p.documentCount + '</td><td class="small">' + (p.lastVisitAt ? ui.fmtTime(p.lastVisitAt) : "—") + "</td></tr>"
        ).join("") + "</tbody></table></div>";
      body.querySelectorAll("[data-pid]").forEach((tr) => tr.addEventListener("click", () => openPatient(tr.getAttribute("data-pid"))));
    }
    async function openPatient(pid) {
      detail.innerHTML = '<div class="state"><span class="st-spin"></span><div>Loading ' + E(pid) + "…</div></div>";
      const [p, t, d, v] = await Promise.all([
        API.get("/patients/" + pid),
        API.get("/patients/" + pid + "/timeline"),
        API.get("/patients/" + pid + "/documents"),
        API.get("/patients/" + pid + "/visits"),
      ]);
      if (!p.success) { detail.innerHTML = ""; ui.toast(p.error.message); return; }
      detail.innerHTML =
        "<h4>" + E(p.data.fullName) + " · <span class='mono'>" + E(p.data.patientId) + "</span></h4>" +
        '<div class="small muted" style="margin:6px 0 4px">Visits</div>' +
        ((v.data.items) || []).map((x) => '<div class="source-row">' + E(x.chiefComplaint || x.complaintPathway) + " " + ui.chip(x.status) + " <span class='sub'>" + ui.fmtTime(x.startedAt) + "</span></div>").join("") || "<p class='small muted'>No visits yet.</p>" +
        '<div class="small muted" style="margin:10px 0 4px">Files</div>' +
        ((d.data.items) || []).map((x) =>
          '<div class="source-row"><a href="#" data-open="' + x.id + '">' + E(x.originalFilename) + "</a> " + ui.chip(x.processingStatus) + "</div>"
        ).join("") || "<p class='small muted'>No documents.</p>" +
        '<div class="small muted" style="margin:10px 0 4px">Timeline</div>' +
        ((t.data.events) || []).slice(0, 8).map((e) => '<div class="source-row"><strong>' + E(e.occurredOn) + "</strong> " + E(e.title) + "</div>").join("") || "<p class='small muted'>No events.</p>";
      detail.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", (ev) => {
        ev.preventDefault(); PreclinicDocs.openFile(a.getAttribute("data-open"));
      }));
      detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    let deb = null;
    host.querySelector("#admPatQ").addEventListener("input", (e) => {
      clearTimeout(deb);
      deb = setTimeout(() => { term = e.target.value.trim(); load().catch((err) => ui.toast(err.message)); }, 300);
    });
    load().catch((err) => ui.state(body, "error", E(err.message)));
  }

  /* ---------------- 3 · Doctor management ---------------- */
  async function vDoctors() {
    const [res, ures] = await Promise.all([API.get("/admin/doctors"), API.get("/admin/users")]);
    if (!res.success) throw new Error(res.error.message);
    const items = res.data.items || [];
    const users = (ures.success ? ures.data.items : []) || [];
    host.innerHTML =
      '<div class="card"><div class="eyebrow">Doctors on staff</div>' +
      '<div class="table-wrap"><table class="tbl2"><thead><tr><th>Doctor ID</th><th>Name</th><th>Department</th><th>Qualification</th><th>Login</th><th>Email</th><th>Status</th><th>Created</th></tr></thead><tbody>' +
      (items.length ? items.map((x) =>
        "<tr><td class='mono'>" + E(x.doctorId) + "</td><td><strong>" + E(x.fullName) + "</strong></td><td>" + E(x.department) + "</td><td>" + E(x.qualification) +
        "</td><td class='mono'>" + E(x.loginId) + "</td><td>" + E(x.email || "—") + '</td><td>' + (x.isActive ? '<span class="health-ok">active</span>' : '<span class="health-bad">disabled</span>') +
        '</td><td class="small">' + ui.fmtTime(x.createdAt) + "</td></tr>"
      ).join("") : "<tr><td colspan='8' class='muted'>No doctors provisioned.</td></tr>") +
      "</tbody></table></div></div>" +
      '<div class="grid-2" style="margin-top:16px">' +
      '<div class="card"><div class="eyebrow">All accounts</div>' +
      '<div class="table-wrap"><table class="tbl2"><thead><tr><th>Login</th><th>Name</th><th>Role</th><th>Status</th><th>Created</th></tr></thead><tbody>' +
      users.map((u) =>
        "<tr><td class='mono'>" + E(u.loginId) + "</td><td>" + E(u.displayName) + "</td><td>" + ui.chip(u.role) + "</td><td>" + (u.isActive ? "active" : "disabled") + "</td><td class='small'>" + ui.fmtTime(u.createdAt) + "</td></tr>"
      ).join("") + "</tbody></table></div></div>" +
      '<div class="card"><div class="eyebrow">Provision user</div>' +
      '<div class="grid-2">' +
      '<div class="field"><label>Login ID</label><input id="nuId" placeholder="DOC-003" /></div>' +
      '<div class="field"><label>Display name</label><input id="nuName" /></div>' +
      '<div class="field"><label>Role</label><select id="nuRole"><option>DOCTOR</option><option>ADMIN</option><option>PATIENT</option></select></div>' +
      '<div class="field"><label>Password</label><input id="nuPw" type="password" /></div>' +
      "</div>" +
      '<div class="btn-row"><button class="btn" id="createUser">Create</button></div>' +
      "</div></div>";
    host.querySelector("#createUser").addEventListener("click", async () => {
      const payload = {
        loginId: host.querySelector("#nuId").value.trim(),
        password: host.querySelector("#nuPw").value,
        role: host.querySelector("#nuRole").value,
        displayName: host.querySelector("#nuName").value.trim(),
      };
      if (!payload.loginId || !payload.password) { ui.toast("Login ID and password are required."); return; }
      const r = await API.post("/admin/users", payload);
      if (!r.success) ui.toast(r.error.message);
      else { ui.toast("User created"); route(); }
    });
  }

  /* ---------------- 4 · Visits & documents ---------------- */
  async function vVisitsDocs() {
    const res = await API.get("/admin/visits-docs");
    if (!res.success) throw new Error(res.error.message);
    const d = res.data;
    const chips = (obj, empty) => {
      const keys = Object.keys(obj || {});
      if (!keys.length) return '<p class="small muted">' + empty + "</p>";
      return keys.map((k) => '<span class="chip">' + E(k) + " · " + obj[k] + "</span>").join(" ");
    };
    host.innerHTML =
      '<div class="grid-2">' +
      '<div class="card"><div class="eyebrow">Visits by status</div><div class="kicker">' + chips(d.visitsByStatus, "No visits yet.") + "</div>" +
      '<div class="eyebrow" style="margin-top:14px">Documents by processing status</div><div class="kicker">' + chips(d.documentsByStatus, "No documents yet.") + "</div>" +
      '<p class="small muted">Total documents: ' + d.totalDocuments + "</p></div>" +
      '<div class="card"><div class="eyebrow">Failed processing jobs</div>' +
      (d.failedJobs.length ?
        '<div class="table-wrap"><table class="tbl2"><thead><tr><th>When</th><th>Type</th><th>Error</th></tr></thead><tbody>' +
        d.failedJobs.map((j) => "<tr><td class='small'>" + ui.fmtTime(j.createdAt) + "</td><td>" + ui.chip(j.jobType) + '</td><td class="small">' + E(j.error || "—") + "</td></tr>").join("") +
        "</tbody></table></div>"
        : '<p class="small"><span class="chip ok">No failed jobs</span></p>') +
      "</div></div>" +
      '<div class="card" style="margin-top:16px"><div class="eyebrow">Recent visits</div>' +
      '<div class="table-wrap"><table class="tbl2"><thead><tr><th>Patient</th><th>ID</th><th>Pathway</th><th>Complaint</th><th>Status</th><th>Started</th></tr></thead><tbody>' +
      (d.recentVisits.length ? d.recentVisits.map((v) =>
        "<tr><td><strong>" + E(v.patientName) + "</strong></td><td class='mono'>" + E(v.patientId) + "</td><td>" + ui.chip(v.pathway) + "</td><td>" + E(v.chiefComplaint || "—") + "</td><td>" + ui.chip(v.status) + '</td><td class="small">' + ui.fmtTime(v.startedAt) + "</td></tr>"
      ).join("") : "<tr><td colspan='6' class='muted'>No visits yet.</td></tr>") +
      "</tbody></table></div></div>";
  }

  /* ---------------- 5 · Emergency & audit ---------------- */
  async function vEmergencyAudit() {
    const [em, logs] = await Promise.all([API.get("/admin/emergencies"), API.get("/admin/audit-logs?limit=25")]);
    if (!em.success) throw new Error(em.error.message);
    const d = em.data;
    const open = d.items.filter((x) => ["ACTIVE", "ACKNOWLEDGED"].includes(x.status));
    const closed = d.items.filter((x) => !["ACTIVE", "ACKNOWLEDGED"].includes(x.status)).slice(0, 10);
    host.innerHTML =
      '<div class="grid-2">' +
      '<div class="card"><div class="eyebrow">Active emergencies (' + d.activeCount + ")</div>" +
      (open.length ? open.map(emCard).join("") : '<p class="small"><span class="chip ok">No active emergencies</span></p>') +
      '<div class="eyebrow" style="margin-top:14px">Recently resolved (' + d.resolvedCount + ")</div>" +
      (closed.length ? closed.map((x) =>
        '<div class="source-row">' + ui.chip(x.status) + " <strong>" + E(x.patientName) + "</strong> <span class='mono small'>" + E(x.patientId) + "</span>" +
        '<div class="small muted">' + E(x.reason) + "</div><div class='sub'>" + ui.fmtTime(x.createdAt) + "</div></div>"
      ).join("") : "<p class='small muted'>None.</p>") +
      "</div>" +
      '<div class="card"><div class="eyebrow">Audit log (latest 25 of ' + (logs.success ? (logs.meta && logs.meta.total) : "…") + ")</div>" +
      '<div class="table-wrap" style="max-height:520px;overflow:auto"><table class="tbl2"><thead><tr><th>When</th><th>Action</th><th>Type</th><th>Resource</th><th>IP</th></tr></thead><tbody>' +
      (logs.success ? (logs.data.items || []).map((r) =>
        "<tr><td class='small'>" + ui.fmtTime(r.createdAt) + "</td><td class='log-action'>" + E(r.action) + "</td><td>" + E(r.resourceType) + "</td><td class='mono small'>" + E(r.resourceId || "") + "</td><td class='small'>" + E(r.ip || "") + "</td></tr>"
      ).join("") : "<tr><td colspan='5' class='muted'>No entries.</td></tr>") +
      "</tbody></table></div></div></div>";

    function emCard(x) {
      return '<div class="em-card"><div class="e-top">' + ui.chip(x.priority) + " " + ui.chip(x.status) + " <strong>" + E(x.patientName) + "</strong> <span class='mono small'>" + E(x.patientId) + "</span></div>" +
        '<div class="e-reason">' + E(x.reason) + "</div>" +
        '<div class="e-meta"><span>' + ui.fmtTime(x.createdAt) + "</span></div>" +
        '<div class="btn-row">' +
        (x.status === "ACTIVE" ? '<button class="btn tiny" data-ack="' + x.id + '">Acknowledge</button> ' : "") +
        (x.status === "ACTIVE" || x.status === "ACKNOWLEDGED" ? '<button class="btn tiny ghost" data-res="' + x.id + '">Resolve</button>' : "") +
        "</div></div>";
    }
    host.querySelectorAll("[data-ack]").forEach((b) => b.addEventListener("click", async () => {
      const r = await API.post("/emergency/" + b.getAttribute("data-ack") + "/acknowledge", {});
      if (!r.success) ui.toast(r.error.message);
      route();
    }));
    host.querySelectorAll("[data-res]").forEach((b) => b.addEventListener("click", async () => {
      const r = await API.post("/emergency/" + b.getAttribute("data-res") + "/resolve", { resolution: "RESOLVED" });
      if (!r.success) ui.toast(r.error.message);
      route();
    }));
  }

  PreclinicEmergency.connect();
  if (!location.hash) location.hash = "#dashboard";
  route();
})();
