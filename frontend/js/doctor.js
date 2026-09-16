(function () {
  const ui = PreclinicUI;
  const I = PreclinicI18n;
  const user = PreclinicAuth.requireRole("DOCTOR");
  if (!user) {
    document.body.innerHTML = '<div class="auth-wrap"><div class="card auth-card"><h2>Please sign in</h2><a class="btn" href="/login">Sign in</a></div></div>';
    return;
  }
  ui.fillWho(user);
  ui.bindLogout("#logoutBtn");
  ui.navActive();
  I.bindSwitch();
  I.apply();
  document.addEventListener("preclinic:lang", () => { I.apply(); loadQueue(); loadEmergencies(); });
  PreclinicEmergency.connect();

  const state = { visit: null, patientId: null };

  async function loadQueue() {
    const res = await PreclinicAPI.get("/doctor/queue");
    const tb = document.querySelector("#queueTable tbody");
    tb.innerHTML = (res.data.items || []).map((v) =>
      "<tr class='queue-row' data-id='" + v.visitId + "' data-pid='" + v.patientId + "'>" +
      "<td class='mono'>" + v.patientId + "</td><td>" + (v.patientName || "") + "</td>" +
      "<td>" + v.complaintPathway.replace(/_/g, " ") + "</td><td>" + ui.chip(v.status) + "</td>" +
      "<td class='small'>" + ui.fmtTime(v.startedAt) + "</td></tr>"
    ).join("") || "<tr><td colspan='5' class='muted'>" + I.t("queueClear") + "</td></tr>";
    tb.querySelectorAll("tr.queue-row").forEach((tr) => {
      tr.addEventListener("click", () => openVisit(tr.getAttribute("data-id"), tr.getAttribute("data-pid")));
    });
  }

  async function loadEmergencies() {
    const res = await PreclinicAPI.get("/doctor/emergencies");
    const host = document.getElementById("emList");
    host.innerHTML = (res.data.items || []).map((e) =>
      "<div class='source-row'><strong>" + (e.patientName || e.patientId || "") + "</strong> · " +
      ui.chip(e.priority) + " " + ui.chip(e.status) + "<div class='small'>" + e.reason + "</div>" +
      (e.status === "ACTIVE" ? "<button class='btn tiny' data-ack='" + e.id + "'>Acknowledge</button> " : "") +
      (e.status !== "RESOLVED" && e.status !== "FALSE_POSITIVE" ? "<button class='btn tiny ghost' data-res='" + e.id + "'>Resolve</button>" : "") +
      "</div>"
    ).join("") || "<p class='muted'>" + I.t("noEm") + "</p>";
    host.querySelectorAll("[data-ack]").forEach((b) => b.addEventListener("click", async () => {
      await PreclinicAPI.post("/emergency/" + b.getAttribute("data-ack") + "/acknowledge", {});
      loadEmergencies(); PreclinicEmergency.poll();
    }));
    host.querySelectorAll("[data-res]").forEach((b) => b.addEventListener("click", async () => {
      await PreclinicAPI.post("/emergency/" + b.getAttribute("data-res") + "/resolve", { resolution: "RESOLVED" });
      loadEmergencies(); PreclinicEmergency.poll();
    }));
  }

  async function openVisit(visitId, patientId) {
    state.visit = visitId;
    state.patientId = patientId;
    document.getElementById("chartEmpty").classList.add("hidden");
    document.getElementById("chart").classList.remove("hidden");
    const [visit, patient, timeline, docs, summary] = await Promise.all([
      PreclinicAPI.get("/visits/" + visitId),
      PreclinicAPI.get("/patients/" + patientId),
      PreclinicAPI.get("/patients/" + patientId + "/timeline"),
      PreclinicAPI.get("/patients/" + patientId + "/documents"),
      PreclinicAPI.get("/visits/" + visitId + "/summary"),
    ]);
    document.getElementById("pName").textContent = patient.data.fullName;
    document.getElementById("pMeta").textContent = patient.data.patientId + " · " + (patient.data.sex || "") + " · " + (patient.data.bloodGroup || "");
    const h = visit.data.history;
    document.getElementById("histBox").innerHTML = h ? [
      ["Chief complaint", h.chiefComplaint],
      ["HPI", h.hpi],
      ["Past medical", h.pastMedicalHistory],
      ["Medications", (h.medications || []).join(", ")],
      ["Allergies", (h.allergies || []).join(", ")],
      ["Concerns", h.patientConcerns],
    ].map((r) => "<div class='source-row'><b>" + r[0] + "</b><div>" + (r[1] || "—") + "</div></div>").join("") : "<p class='muted'>" + I.t("noHist") + "</p>";
    const a = visit.data.ayush;
    document.getElementById("ayushBox").innerHTML = a
      ? "<div class='ayush-grid'>" + [
        ["Prakriti", a.prakriti], ["Vikriti", a.vikriti], ["Sara", a.sara], ["Samhanana", a.samhanana],
        ["Satmya", a.satmya], ["Sattva", a.sattva], ["Ahara shakti", a.aharaShakti], ["Vyayama shakti", a.vyayamaShakti],
        ["Vaya", a.vaya], ["Ahara", a.ahara], ["Vihara", a.vihara], ["Nidana", a.nidana], ["Samprapti", a.samprapti],
      ].map((r) => "<div><b>" + r[0] + "</b>" + (r[1] || "—") + "</div>").join("") + "</div>"
      : "<p class='muted'>" + I.t("noAyush") + "</p>";
    document.getElementById("tlBox").innerHTML = ((timeline.data.events) || []).map((e) =>
      "<div class='tl-item'><strong>" + e.occurredOn + " · " + e.title + "</strong><div class='small muted'>" + e.detail + " · " + e.sourceType + (e.sourceId ? " · " + e.sourceId : "") + "</div></div>"
    ).join("");
    document.getElementById("docBox").innerHTML = ((docs.data.items) || []).map((d) =>
      "<div class='source-row'><a href='#' data-doc='" + d.id + "'>" + d.originalFilename + "</a> · " + d.documentType + " " + ui.chip(d.processingStatus) + "</div>"
    ).join("") || "<p class='muted'>" + I.t("noDocs") + "</p>";
    document.getElementById("docBox").querySelectorAll("[data-doc]").forEach((a) => a.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await PreclinicDocs.openFile(a.getAttribute("data-doc"));
    }));
    document.getElementById("conflictBox").innerHTML = ((patient.data.openConflicts) || []).map((c) =>
      "<div class='source-row'><strong>" + c.field + "</strong><div class='small'>" + c.leftValue + " <em>vs</em> " + c.rightValue + "</div>" +
      "<button class='btn tiny' data-cf='" + c.id + "' data-st='DOCTOR_CONFIRMED'>Confirm record</button> " +
      "<button class='btn tiny ghost' data-cf='" + c.id + "' data-st='DISMISSED'>Dismiss</button></div>"
    ).join("") || "<p class='muted'>No open conflicts.</p>";
    document.getElementById("conflictBox").querySelectorAll("[data-cf]").forEach((b) => b.addEventListener("click", async () => {
      await PreclinicAPI.patch("/visits/" + visitId, { conflictId: b.getAttribute("data-cf"), conflictStatus: b.getAttribute("data-st") });
      openVisit(visitId, patientId);
    }));
    const s = summary.data && summary.data.visitId ? summary.data : visit.data.summary;
    document.getElementById("sumMeta").innerHTML = s ? ui.chip(s.verificationStatus) + " " + ui.chip(s.confidence) + " · v" + s.version : I.t("noSum");
    document.getElementById("sumEdit").value = s ? (s.narrative || "") : "";
    const src = (s && s.sources) || [];
    document.getElementById("srcBox").innerHTML = src.map((x) =>
      "<div class='source-row'>" + x.field + ": " + x.value + " · " + x.sourceType + " · " + x.confidence + " " + ui.chip(x.verificationStatus) + "</div>"
    ).join("");
  }

  document.getElementById("saveSum").addEventListener("click", async () => {
    if (!state.visit) return;
    const res = await PreclinicAPI.patch("/doctor/summary/" + state.visit, { narrative: document.getElementById("sumEdit").value });
    if (!res.success) ui.toast(ui.errMsg(res)); else ui.toast("New summary version saved as NEEDS_REVIEW");
  });
  document.getElementById("verifySum").addEventListener("click", async () => {
    if (!state.visit) return;
    const res = await PreclinicAPI.post("/doctor/verify/" + state.visit, { visitId: state.visit, action: "DOCTOR_VERIFIED" });
    if (!res.success) ui.toast(ui.errMsg(res)); else { ui.toast("Doctor verified. AI cannot alter this version."); loadQueue(); openVisit(state.visit, state.patientId); }
  });
  document.getElementById("rejectSum").addEventListener("click", async () => {
    if (!state.visit) return;
    await PreclinicAPI.post("/doctor/verify/" + state.visit, { visitId: state.visit, action: "REJECTED" });
    ui.toast("Summary rejected — returned to intake.");
    loadQueue();
  });

  loadQueue();
  loadEmergencies();
})();
