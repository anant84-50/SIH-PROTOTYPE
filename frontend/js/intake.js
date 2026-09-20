(function (global) {
  const IDS = ["FEVER", "COUGH_COLD", "HEADACHE", "ABDOMINAL_PAIN", "BODY_JOINT_PAIN", "OTHER"];

  function pathways() {
    const t = PreclinicI18n.t;
    return IDS.map((id) => ({ id, title: t("path" + id), note: t("path" + id + "n") }));
  }

  function renderPathways(host, selected, onPick) {
    host.innerHTML = pathways().map((p) =>
      "<button type='button' class='pathway" + (selected === p.id ? " on" : "") + "' data-id='" + p.id + "'>" +
      "<strong>" + p.title + "</strong><span class='small muted'>" + p.note + "</span></button>"
    ).join("");
    host.querySelectorAll(".pathway").forEach((btn) => {
      btn.addEventListener("click", () => onPick(btn.getAttribute("data-id")));
    });
  }

  function speak(text) {
    try {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.96;
      u.lang = PreclinicI18n.speechLocale();
      window.speechSynthesis.speak(u);
    } catch (_e) { /* ignore */ }
  }

  function SR() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function voiceSupported() {
    return !!SR();
  }

  /**
   * Start speech recognition in the selected UI language (rec.lang matches it,
   * so the transcript comes back in the spoken language — it is never
   * translated by the client).
   *
   * opts.onState(state) — states:
   *   ready          recognition object created, waiting for the mic
   *   listening      microphone is open, user may be speaking
   *   transcript     a final transcript was captured (onText also fires)
   *   ended          engine stopped without a transcript
   *   nospeech       engine stopped, no speech detected
   *   unavailable    microphone error / could not start
   *   denied         user or OS blocked microphone access
   *   unsupported    browser has no Web Speech recognition
   *
   * Returns the recognition instance (call .stop() to cancel) or null.
   */
  function listen(onText, opts) {
    const options = opts || {};
    const say = (state) => { if (options.onState) { try { options.onState(state); } catch (_e) { /* ignore */ } } };
    const SRc = SR();
    if (!SRc) { say("unsupported"); return null; }
    let rec = null;
    try { rec = new SRc(); } catch (_e) { say("unsupported"); return null; }
    let gotText = false;
    // Recognition language follows the selected UI language (en/hi/ta/bn).
    rec.lang = PreclinicI18n.speechLocale();
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    say("ready");
    rec.onstart = () => say("listening");
    rec.onresult = (ev) => {
      let txt = "";
      for (let i = ev.resultIndex; i < ev.results.length; i += 1) txt += ev.results[i][0].transcript;
      txt = (txt || "").replace(/\s+/g, " ").trim();
      gotText = !!txt;
      say("transcript");
      try { onText(txt); } catch (_e) { /* ignore */ }
    };
    rec.onerror = (ev) => {
      const err = (ev && ev.error) || "";
      let state = "unavailable";
      if (err === "not-allowed" || err === "service-not-allowed") state = "denied";
      else if (err === "language-not-supported") state = "unsupported";
      else if (err === "no-speech") state = "nospeech";
      say(state);
      if (options.onError) { try { options.onError(err); } catch (_e) { /* ignore */ } }
    };
    rec.onend = () => {
      if (!gotText) say("ended");
    };
    try {
      rec.start();
    } catch (_e) {
      say("unavailable");
    }
    return rec;
  }

  global.PreclinicIntake = { pathways, renderPathways, speak, listen, voiceSupported };
})(window);
