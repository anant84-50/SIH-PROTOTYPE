(function () {
  const ui = PreclinicUI;
  const I = PreclinicI18n;
  const user = PreclinicAuth.requireRole("PATIENT");
  if (!user) {
    document.body.innerHTML = '<div class="auth-wrap"><div class="card auth-card"><h2>Please sign in</h2><p class="muted">Your session is not on this page yet.</p><a class="btn" href="/login">Sign in</a></div></div>';
    return;
  }
  ui.fillWho(user);
  ui.bindLogout("#logoutBtn");
  ui.navActive();
  I.bindSwitch();
  I.apply();

  const state = {
    patientId: user.patientId,
    language: I.lang(),
    consent: false,
    pathway: "FEVER",
    visit: null,
    sessionId: null,
    question: null,
    step: 1,
  };

  const views = ["dashView", "flowView", "chartView"];
  function show(id) {
    views.forEach((v) => document.getElementById(v).classList.toggle("hidden", v !== id));
  }

  function refreshCopy() {
    I.apply();
    document.getElementById("stepLabel").textContent = I.t("stepOf", { n: state.step });
    if (!document.getElementById("step3").classList.contains("hidden")) {
      PreclinicIntake.renderPathways(document.getElementById("pathways"), state.pathway, pickPath);
    }
  }

  document.addEventListener("preclinic:lang", () => {
    state.language = I.lang();
    refreshCopy();
    loadDash();
  });

  async function loadDash() {
    const [me, visits, timeline] = await Promise.all([
      PreclinicAPI.get("/patients/" + state.patientId),
      PreclinicAPI.get("/patients/" + state.patientId + "/visits"),
      PreclinicAPI.get("/patients/" + state.patientId + "/timeline"),
    ]);
    if (!me.success) { ui.toast(ui.errMsg(me)); return; }
    document.getElementById("helloName").textContent = me.data.fullName;
    document.getElementById("helloId").textContent = me.data.patientId;
    const returning = (visits.data.items || []).length > 0;
    document.getElementById("dashMeta").textContent =
      (returning ? I.t("returning") : I.t("newPt")) +
      " · " + (me.data.language || "en") +
      (me.data.bloodGroup ? " · " + me.data.bloodGroup : "");
    const items = visits.data.items || [];
    document.getElementById("visitList").innerHTML = items.length
      ? items.map((v) => "<div class='source-row'><strong>" + (v.chiefComplaint || v.complaintPathway) + "</strong><br><span class='small muted'>" + ui.fmtTime(v.startedAt) + " · " + ui.chip(v.status) + "</span></div>").join("")
      : "<p class='muted'>" + I.t("noVisits") + "</p>";
    const ev = (timeline.success ? timeline.data.events : []) || [];
    document.getElementById("miniTimeline").innerHTML = ev.slice(0, 6).map((e) =>
      "<div class='tl-item'><strong>" + e.title + "</strong><div class='small muted'>" + e.occurredOn + " · " + e.sourceType + "</div></div>"
    ).join("") || "<p class='muted'>" + I.t("tlGrow") + "</p>";
  }

  document.getElementById("startVisit").addEventListener("click", () => {
    show("flowView");
    goStep(1);
  });
  document.getElementById("openChart").addEventListener("click", async () => {
    show("chartView");
    await drawChart();
  });
  document.getElementById("backDash").addEventListener("click", () => show("dashView"));
  document.getElementById("backDash2").addEventListener("click", () => show("dashView"));

  const stepEls = [1, 2, 3, 4, 5, 6, 7].map((n) => document.getElementById("step" + n));
  function goStep(n) {
    state.step = n;
    stepEls.forEach((el, i) => el.classList.toggle("hidden", i !== n - 1));
    document.getElementById("flowProgress").style.width = Math.round((n / 7) * 100) + "%";
    document.getElementById("stepLabel").textContent = I.t("stepOf", { n: n });
  }

  document.getElementById("toConsent").addEventListener("click", () => {
    state.language = I.lang();
    goStep(2);
  });
  document.getElementById("toComplaint").addEventListener("click", () => {
    state.consent = document.getElementById("consentChk").checked;
    if (!state.consent) { ui.toast(I.t("consentNeed")); return; }
    goStep(3);
    PreclinicIntake.renderPathways(document.getElementById("pathways"), state.pathway, pickPath);
  });

  function pickPath(id) {
    state.pathway = id;
    PreclinicIntake.renderPathways(document.getElementById("pathways"), state.pathway, pickPath);
  }

  document.getElementById("toInterview").addEventListener("click", async () => {
    const extra = document.getElementById("chiefExtra").value.trim();
    const res = await PreclinicAPI.post("/visits", {
      patientId: state.patientId,
      complaintPathway: state.pathway,
      chiefComplaint: extra || state.pathway.replace(/_/g, " "),
      language: I.lang(),
      consent: true,
    });
    if (!res.success) { ui.toast(ui.errMsg(res)); return; }
    state.visit = res.data;
    PreclinicAPI.patch("/patients/" + state.patientId, { language: I.lang() });
    const sess = await PreclinicAPI.post("/ai/session", { visitId: state.visit.visitId });
    if (!sess.success) { ui.toast(ui.errMsg(sess)); return; }
    state.sessionId = sess.data.sessionId;
    document.getElementById("chat").innerHTML = "";
    addBubble(sess.data.opening || "", false);
    paintQuestion(sess.data);
    goStep(4);
  });

  function addBubble(text, me) {
    if (!text) return;
    const div = document.createElement("div");
    div.className = "bubble" + (me ? " me" : "");
    div.textContent = text;
    document.getElementById("chat").appendChild(div);
    document.getElementById("chat").scrollTop = 99999;
  }

  function paintQuestion(payload) {
    const box = document.getElementById("qBox");
    const opts = document.getElementById("qOptions");
    state.question = payload.question || null;
    if (payload.complete || !payload.question) {
      box.textContent = I.t("intDone");
      opts.innerHTML = "";
      document.getElementById("interviewDone").classList.remove("hidden");
      return;
    }
    document.getElementById("interviewDone").classList.add("hidden");
    box.textContent = payload.question.text;
    PreclinicIntake.speak(payload.question.text);
    opts.innerHTML = "";
    (payload.question.options || []).forEach((o) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = o;
      b.addEventListener("click", () => sendAnswer(o, "TOUCH"));
      opts.appendChild(b);
    });
    document.getElementById("qProgress").style.width = Math.round((payload.progress || 0) * 100) + "%";
  }

  async function sendAnswer(text, mode, action) {
    if (!state.sessionId) return;
    if (text) addBubble(text, true);
    const res = await PreclinicAPI.post("/ai/message", {
      sessionId: state.sessionId,
      text: text || "",
      inputMode: mode || "TEXT",
      action: action || "answer",
      questionId: state.question ? state.question.id : null,
    });
    if (!res.success) { ui.toast(ui.errMsg(res)); return; }
    if (res.data.emergencies && res.data.emergencies.length) ui.toast(I.t("emAlert"));
    if (res.data.question) addBubble(res.data.question.text, false);
    else if (res.data.complete) addBubble(I.t("thanks"), false);
    paintQuestion(res.data);
  }

  document.getElementById("sendAns").addEventListener("click", () => {
    const t = document.getElementById("ansText").value.trim();
    if (!t) return;
    document.getElementById("ansText").value = "";
    sendAnswer(t, "TEXT");
  });
  document.getElementById("ansText").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      document.getElementById("sendAns").click();
    }
  });
  document.getElementById("skipAns").addEventListener("click", () => sendAnswer("", "TOUCH", "i_dont_know"));
  document.getElementById("preferNot").addEventListener("click", () => sendAnswer("", "TOUCH", "prefer_not_to_answer"));
  document.getElementById("repeatQ").addEventListener("click", () => sendAnswer("", "TOUCH", "repeat"));
  document.getElementById("voiceBtn").addEventListener("click", () => {
    document.getElementById("recDot").classList.remove("hidden");
    PreclinicIntake.listen((t) => {
      document.getElementById("recDot").classList.add("hidden");
      sendAnswer(t, "VOICE");
    });
    setTimeout(() => document.getElementById("recDot").classList.add("hidden"), 8000);
  });

  document.getElementById("toManual").addEventListener("click", () => goStep(5));
  document.getElementById("saveManual").addEventListener("click", async () => {
    if (!state.visit) return;
    await PreclinicAPI.patch("/visits/" + state.visit.visitId, {
      history: {
        pastMedicalHistory: document.getElementById("pmh").value,
        pastSurgicalHistory: document.getElementById("psh").value,
        familyHistory: document.getElementById("fh").value,
        patientConcerns: document.getElementById("concerns").value,
      },
      ayush: {
        prakriti: document.getElementById("prakriti").value,
        vikriti: document.getElementById("vikriti").value,
        ahara: document.getElementById("ahara").value,
        vihara: document.getElementById("vihara").value,
        nidana: document.getElementById("nidana").value,
      },
    });
    goStep(6);
    PreclinicDocs.bindUploader({
      inputId: "docFile",
      typeId: "docType",
      buttonId: "docUpload",
      outId: "docOut",
      patientId: () => state.patientId,
      visitId: () => state.visit && state.visit.visitId,
    });
  });

  document.getElementById("toSummary").addEventListener("click", async () => {
    await PreclinicAPI.post("/ai/structure-history", { visitId: state.visit.visitId, sessionId: state.sessionId });
    const sum = await PreclinicAPI.post("/ai/generate-summary", { visitId: state.visit.visitId });
    if (!sum.success) { ui.toast(ui.errMsg(sum)); return; }
    renderSummary(sum.data);
    goStep(7);
  });

  function renderSummary(s) {
    document.getElementById("sumStatus").innerHTML = ui.chip(s.verificationStatus) + " " + ui.chip(s.confidence);
    document.getElementById("sumBody").textContent = s.narrative || "";
    const miss = ((s.body || {}).missingInformation) || [];
    document.getElementById("sumMissing").innerHTML = miss.length
      ? "<p class='small'>" + I.t("stillMiss") + miss.join(", ") + "</p>" : "";
  }

  document.getElementById("confirmSum").addEventListener("click", async () => {
    const res = await PreclinicAPI.post("/ai/verify-summary", { visitId: state.visit.visitId, action: "PATIENT_CONFIRMED" });
    if (!res.success) { ui.toast(ui.errMsg(res)); return; }
    ui.toast(I.t("confirmed"));
    await loadDash();
    show("dashView");
  });
  document.getElementById("rejectSum").addEventListener("click", async () => {
    await PreclinicAPI.post("/ai/verify-summary", { visitId: state.visit.visitId, action: "REJECTED" });
    ui.toast(I.t("rejected"));
    goStep(4);
  });

  async function drawChart() {
    const [p, t, d, v] = await Promise.all([
      PreclinicAPI.get("/patients/" + state.patientId),
      PreclinicAPI.get("/patients/" + state.patientId + "/timeline"),
      PreclinicAPI.get("/patients/" + state.patientId + "/documents"),
      PreclinicAPI.get("/patients/" + state.patientId + "/visits"),
    ]);
    document.getElementById("chartId").textContent = state.patientId;
    document.getElementById("chartConflicts").innerHTML = ((p.data.openConflicts) || []).map((c) =>
      "<div class='source-row'><strong>" + c.field + "</strong><br>" + c.leftValue + " vs " + c.rightValue + " " + ui.chip(c.status) + "</div>"
    ).join("") || "<p class='muted'>" + I.t("noCf") + "</p>";
    document.getElementById("chartTl").innerHTML = ((t.data.events) || []).map((e) =>
      "<div class='tl-item'><strong>" + e.occurredOn.slice(0, 4) + " · " + e.title + "</strong><div class='small muted'>" + e.detail + " · " + e.sourceType + "</div></div>"
    ).join("");
    document.getElementById("chartDocs").innerHTML = ((d.data.items) || []).map((x) =>
      "<div class='source-row'><a href='#' data-open='" + x.id + "'>" + x.originalFilename + "</a> · " + x.documentType + " " + ui.chip(x.processingStatus) + "</div>"
    ).join("") || "<p class='muted'>" + I.t("noDocs") + "</p>";
    document.getElementById("chartDocs").querySelectorAll("[data-open]").forEach((a) => {
      a.addEventListener("click", (ev) => { ev.preventDefault(); PreclinicDocs.openFile(a.getAttribute("data-open")); });
    });
    document.getElementById("chartVisits").innerHTML = ((v.data.items) || []).map((x) =>
      "<div class='source-row'>" + x.complaintPathway + " · " + ui.chip(x.status) + "</div>"
    ).join("");
  }

  PreclinicDocs.bindUploader({
    inputId: "docFile",
    typeId: "docType",
    buttonId: "docUpload",
    outId: "docOut",
    patientId: () => state.patientId,
    visitId: () => state.visit && state.visit.visitId,
  });
  PreclinicDocs.bindUploader({
    inputId: "histFile",
    typeId: "histType",
    buttonId: "histUpload",
    outId: "histOut",
    patientId: () => state.patientId,
    visitId: () => state.visit && state.visit.visitId,
    onDone: () => drawChart(),
  });

  const sosFab = document.getElementById("sosFab");
  const sosModal = document.getElementById("sosModal");
  if (sosFab && sosModal) {
    sosFab.addEventListener("click", () => sosModal.classList.remove("hidden"));
    document.getElementById("sosClose").addEventListener("click", () => sosModal.classList.add("hidden"));
    document.getElementById("sosSend").addEventListener("click", async () => {
      const text = document.getElementById("sosText").value.trim();
      if (!text) { ui.toast("Describe what is happening"); return; }
      const res = await PreclinicEmergency.trigger(state.patientId, state.visit && state.visit.visitId, text);
      if (!res.success) { ui.toast(ui.errMsg(res)); return; }
      ui.toast(I.t("emAlert"));
      document.getElementById("sosText").value = "";
      sosModal.classList.add("hidden");
    });
  }

  loadDash();
})();
