(function (global) {
  async function upload(patientId, visitId, documentType, file) {
    const fd = new FormData();
    fd.append("patientId", patientId);
    if (visitId) fd.append("visitId", visitId);
    fd.append("documentType", documentType || "OTHER");
    fd.append("file", file);
    return PreclinicAPI.upload("/documents/upload", fd);
  }

  async function entities(id) {
    return PreclinicAPI.get("/documents/" + id + "/entities");
  }

  async function openFile(id) {
    const token = PreclinicAPI.token();
    const res = await fetch("/api/v1/documents/" + id + "/file", {
      headers: token ? { Authorization: "Bearer " + token } : {},
    });
    if (!res.ok) {
      PreclinicUI.toast("Could not open the file");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
  }

  function bindUploader(opts) {
    const input = document.getElementById(opts.inputId);
    const typeSel = document.getElementById(opts.typeId);
    const btn = document.getElementById(opts.buttonId);
    const out = document.getElementById(opts.outId);
    if (!btn || !input || btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      if (!input.files || !input.files[0]) {
        PreclinicUI.toast(PreclinicI18n.t("chooseFile"));
        return;
      }
      btn.disabled = true;
      const res = await upload(opts.patientId(), opts.visitId ? opts.visitId() : null, typeSel ? typeSel.value : "OTHER", input.files[0]);
      btn.disabled = false;
      if (!res.success) { PreclinicUI.toast(PreclinicUI.errMsg(res)); return; }
      PreclinicUI.toast(PreclinicI18n.t("docStored") + " " + (res.data.processingStatus || ""));
      input.value = "";
      const ents = await entities(res.data.id);
      if (out && ents.success) {
        out.innerHTML = (ents.data.entities || []).map((e) =>
          "<div class='source-row'><strong>" + e.entityType + "</strong> · " + e.value +
          (e.unit ? " " + e.unit : "") + " · " + e.confidence + " · " + PreclinicUI.chip(e.verificationStatus) + "</div>"
        ).join("") || "<p class='muted'>—</p>";
      }
      if (opts.onDone) opts.onDone(res.data, ents.data);
    });
  }

  global.PreclinicDocs = { upload, entities, openFile, bindUploader };
})(window);
