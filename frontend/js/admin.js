(function () {
  const ui = PreclinicUI;
  const I = PreclinicI18n;
  const user = PreclinicAuth.requireRole("ADMIN");
  if (!user) {
    document.body.innerHTML = '<div class="auth-wrap"><div class="card auth-card"><h2>Please sign in</h2><a class="btn" href="/login">Sign in</a></div></div>';
    return;
  }
  ui.fillWho(user);
  ui.bindLogout("#logoutBtn");
  ui.navActive();
  I.bindSwitch();
  I.apply();
  document.addEventListener("preclinic:lang", () => { I.apply(); dash(); users(); logs(); health(); patients(); emergencies(); });
  PreclinicEmergency.connect();

  async function dash() {
    const res = await PreclinicAPI.get("/admin/dashboard");
    if (!res.success) { ui.toast(ui.errMsg(res)); return; }
    const d = res.data;
    document.getElementById("kPatients").textContent = d.patients;
    document.getElementById("kVisits").textContent = d.visits;
    document.getElementById("kUsers").textContent = d.users;
    document.getElementById("kWait").textContent = d.awaitingDoctor;
    document.getElementById("kEm").textContent = d.activeEmergencies;
  }

  async function users() {
    const res = await PreclinicAPI.get("/admin/users");
    document.querySelector("#userTable tbody").innerHTML = (res.data.items || []).map((u) =>
      "<tr><td class='mono'>" + u.loginId + "</td><td>" + u.displayName + "</td><td>" + ui.chip(u.role) + "</td><td>" + (u.isActive ? "active" : "disabled") + "</td><td class='small'>" + ui.fmtTime(u.createdAt) + "</td></tr>"
    ).join("");
  }

  async function logs() {
    const res = await PreclinicAPI.get("/admin/audit-logs?limit=40");
    document.querySelector("#logTable tbody").innerHTML = (res.data.items || []).map((r) =>
      "<tr><td class='small'>" + ui.fmtTime(r.createdAt) + "</td><td class='log-action'>" + r.action + "</td><td>" + r.resourceType + "</td><td class='mono small'>" + (r.resourceId || "") + "</td><td class='small'>" + (r.ip || "") + "</td></tr>"
    ).join("");
  }

  async function health() {
    const res = await PreclinicAPI.get("/admin/system-health");
    const h = res.data;
    document.getElementById("healthBox").innerHTML =
      "<div>Database: <span class='" + (h.database === "up" ? "health-ok" : "health-bad") + "'>" + h.database + "</span> · " + h.dialect + "</div>" +
      "<div>Queue: " + h.queue + " · AI: " + h.aiProvider + " · OCR: " + h.ocrProvider + "</div>" +
      "<div>Jobs " + h.jobs + " · failed " + h.failedJobs + "</div>" +
      "<div class='small muted'>" + h.timeUtc + " · " + h.env + "</div>";
  }

  document.getElementById("createUser").addEventListener("click", async () => {
    const payload = {
      loginId: document.getElementById("nuId").value.trim(),
      password: document.getElementById("nuPw").value,
      role: document.getElementById("nuRole").value,
      displayName: document.getElementById("nuName").value.trim(),
    };
    const res = await PreclinicAPI.post("/admin/users", payload);
    if (!res.success) ui.toast(ui.errMsg(res));
    else { ui.toast("User created"); users(); dash(); }
  });

  async function patients() {
    const res = await PreclinicAPI.get("/admin/patients");
    if (!res.success) return;
    document.querySelector("#ptTable tbody").innerHTML = (res.data.items || []).map((p) =>
      "<tr class='queue-row' data-pid='" + p.patientId + "'><td class='mono'>" + p.patientId + "</td><td>" + p.fullName +
      "</td><td>" + p.visitCount + "</td><td>" + p.documentCount + "</td><td class='small'>" + (p.lastComplaint || "—") + "</td></tr>"
    ).join("");
    document.querySelectorAll("#ptTable [data-pid]").forEach((tr) => tr.addEventListener("click", () => openPatient(tr.getAttribute("data-pid"))));
  }

  async function openPatient(pid) {
    const host = document.getElementById("ptDetail");
    const [p, t, d, v] = await Promise.all([
      PreclinicAPI.get("/patients/" + pid),
      PreclinicAPI.get("/patients/" + pid + "/timeline"),
      PreclinicAPI.get("/patients/" + pid + "/documents"),
      PreclinicAPI.get("/patients/" + pid + "/visits"),
    ]);
    host.innerHTML =
      "<h4>" + p.data.fullName + " · " + p.data.patientId + "</h4>" +
      "<div class='small muted'>Visits</div>" + ((v.data.items) || []).map((x) => "<div class='source-row'>" + x.chiefComplaint + " " + ui.chip(x.status) + "</div>").join("") +
      "<div class='small muted' style='margin-top:8px'>Files</div>" + ((d.data.items) || []).map((x) =>
        "<div class='source-row'><a href='#' data-open='" + x.id + "'>" + x.originalFilename + "</a> " + ui.chip(x.processingStatus) + "</div>"
      ).join("") +
      "<div class='small muted' style='margin-top:8px'>Timeline</div>" + ((t.data.events) || []).slice(0, 8).map((e) =>
        "<div class='source-row'><strong>" + e.occurredOn + "</strong> " + e.title + "</div>"
      ).join("");
    host.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", (ev) => {
      ev.preventDefault(); PreclinicDocs.openFile(a.getAttribute("data-open"));
    }));
  }

  async function emergencies() {
    const res = await PreclinicAPI.get("/emergency/active");
    const host = document.getElementById("emList");
    if (!host) return;
    host.innerHTML = (res.data.items || []).map((e) =>
      "<div class='source-row'><strong>" + (e.patientId || "") + "</strong> " + ui.chip(e.priority) + " " + ui.chip(e.status) +
      "<div class='small'>" + e.reason + "</div>" +
      (e.status === "ACTIVE" ? "<button class='btn tiny' data-ack='" + e.id + "'>Acknowledge</button> " : "") +
      (e.status !== "RESOLVED" && e.status !== "FALSE_POSITIVE" ? "<button class='btn tiny ghost' data-res='" + e.id + "'>Resolve</button>" : "") +
      "</div>"
    ).join("") || "<p class='muted'>No emergency alerts.</p>";
    host.querySelectorAll("[data-ack]").forEach((b) => b.addEventListener("click", async () => {
      await PreclinicAPI.post("/emergency/" + b.getAttribute("data-ack") + "/acknowledge", {});
      emergencies(); PreclinicEmergency.poll();
    }));
    host.querySelectorAll("[data-res]").forEach((b) => b.addEventListener("click", async () => {
      await PreclinicAPI.post("/emergency/" + b.getAttribute("data-res") + "/resolve", { resolution: "RESOLVED" });
      emergencies(); PreclinicEmergency.poll();
    }));
  }

  dash(); users(); logs(); health(); patients(); emergencies();
})();
