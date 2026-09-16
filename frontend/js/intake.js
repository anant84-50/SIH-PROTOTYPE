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

  function listen(onText) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { PreclinicUI.toast(PreclinicI18n.t("voiceNo")); return null; }
    const rec = new SR();
    rec.lang = PreclinicI18n.speechLocale();
    rec.interimResults = false;
    rec.onresult = (e) => onText(e.results[0][0].transcript);
    rec.onerror = () => PreclinicUI.toast(PreclinicI18n.t("voiceFail"));
    rec.start();
    return rec;
  }

  global.PreclinicIntake = { pathways, renderPathways, speak, listen };
})(window);
