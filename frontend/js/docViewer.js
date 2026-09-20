/* Preclinic IQ AI — shared document viewer (patient + doctor).
 * Serves the REAL file from the backend via GET /documents/{id}/view
 * (inline, token-authenticated). No fake modal: missing/corrupted/
 * unauthorized files show real error states. No filesystem paths leak. */
(function (global) {
  "use strict";
  const UI = global.PreclinicUI;
  const API = global.PreclinicAPI;
  const I18n = global.PreclinicI18n;
  const E = UI.esc;
  const t = (k) => I18n.t(k);

  let overlay = null;
  let zoom = 1;
  let currentDoc = null;
  let entityCache = null;

  function viewUrl(doc) {
    return "/api/v1/documents/" + doc.id + "/view?access_token=" + encodeURIComponent(PreclinicAPI.token());
  }
  function fileUrl(doc) {
    return "/api/v1/documents/" + doc.id + "/file?access_token=" + encodeURIComponent(PreclinicAPI.token());
  }

  async function checkView(doc) {
    // Header-only probe: fetch resolves on response headers; abort right after
    // reading status/content-type so the file body is never downloaded twice.
    // A single retry covers transient 429 rate-limit responses.
    const ctl = new AbortController();
    let res;
    try {
      res = await fetch(viewUrl(doc), { credentials: "include", signal: ctl.signal });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1200));
        res = await fetch(viewUrl(doc), { credentials: "include", signal: ctl.signal });
      }
    } catch (_e) {
      return { ok: false, code: "error" };
    }
    const status = res.status;
    const type = res.headers.get("content-type") || doc.mimeType || "";
    try { ctl.abort(); } catch (_e) { /* ignore */ }
    if (status === 404) return { ok: false, code: "missing" };
    if (status === 403) return { ok: false, code: "forbidden" };
    if (status === 400 || status === 413) return { ok: false, code: "invalid" };
    if (!res.ok) return { ok: false, code: "error" };
    return { ok: true, type };
  }

  function mediaKind(type, doc) {
    if (/pdf/.test(type)) return "pdf";
    if (/^image\//.test(type)) return "image";
    if (/text\/plain/.test(type) || /\.(txt|md|csv|json)$/i.test(doc.originalFilename || "")) return "text";
    return "other";
  }

  function errorHtml(code, extra) {
    const msg = code === "missing" ? t("viewerMissing") : code === "forbidden" ? t("viewerForbidden") :
      code === "invalid" ? t("viewerUnsupported") : t("viewerError");
    return '<div class="state"><span class="st-ic st-bad">!</span><div>' + E(msg) + "</div>" +
      (extra ? '<div class="sub">' + E(extra) + "</div>" : "") + "</div>";
  }

  async function open(doc, opts) {
    currentDoc = doc;
    zoom = 1;
    entityCache = null;
    close();
    overlay = document.createElement("div");
    overlay.className = "viewer-ov";
    overlay.innerHTML =
      '<div class="viewer" role="dialog" aria-modal="true">' +
      '<div class="viewer-head"><strong class="v-name">' + UI.icon("doc", 15) + " " + E(doc.originalFilename) + "</strong>" +
      "<span>" + UI.chip(doc.documentType || "FILE") + "</span><span>" + UI.chip(doc.processingStatus) + "</span>" +
      '<button class="ic-btn" id="vClose" title="Close">' + UI.icon("x", 15) + "</button></div>" +
      '<div class="viewer-tools">' +
      '<button id="vModeDoc" class="on">' + t("docsView") + "</button>" +
      '<button id="vModeExt">' + t("docsExt") + "</button>" +
      '<button id="vModeBoth">Both</button>' +
      '<span style="flex:1"></span>' +
      '<button id="vZoomOut" title="Zoom out">' + UI.icon("zoomOut", 14) + "</button>" +
      '<button id="vZoomIn" title="Zoom in">' + UI.icon("zoomIn", 14) + "</button>" +
      '<button id="vFull">' + UI.icon("expand", 14) + " " + t("docsFull") + "</button>" +
      '<a class="btn ghost tiny" id="vDl" href="' + E(fileUrl(doc)) + '">' + UI.icon("download", 14) + " Download</a>" +
      "</div>" +
      '<div class="viewer-body" id="vBody"><div class="viewer-media" id="vMedia"><div class="state"><span class="st-ic st-spin"></span><div>Loading…</div></div></div>' +
      '<div class="viewer-ext" id="vExt"></div></div></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector("#vClose").addEventListener("click", close);
    document.addEventListener("keydown", escClose);

    const media = overlay.querySelector("#vMedia");
    const ext = overlay.querySelector("#vExt");
    ext.style.display = "none"; // shown when "extracted" or "both"

    setMode(opts && opts.extract ? "ext" : "doc");
    loadMedia();

    async function loadMedia() {
      media.innerHTML = '<div class="state"><span class="st-ic st-spin"></span><div>Loading…</div></div>';
      let chk;
      try { chk = await checkView(doc); } catch (_e) { chk = { ok: false, code: "error" }; }
      if (!chk.ok) { media.innerHTML = errorHtml(chk.code); return; }
      const kind = mediaKind(chk.type, doc);
      if (kind === "pdf") {
        media.innerHTML = '<iframe src="' + E(viewUrl(doc)) + '" title="' + E(doc.originalFilename) + '"></iframe>';
      } else if (kind === "image") {
        const img = document.createElement("img");
        img.alt = doc.originalFilename;
        img.src = viewUrl(doc);
        img.onerror = () => { media.innerHTML = errorHtml("error"); };
        media.innerHTML = "";
        media.appendChild(img);
        zoom = 1;
      } else if (kind === "text") {
        try {
          const r = await fetch(viewUrl(doc));
          if (!r.ok) throw new Error(String(r.status));
          const text = await r.text();
          const pre = document.createElement("pre");
          pre.textContent = text;
          media.innerHTML = "";
          media.appendChild(pre);
        } catch (_e) {
          media.innerHTML = errorHtml("error");
        }
      } else {
        media.innerHTML = errorHtml("invalid", (doc.originalFilename || "") + " · " + (chk.type || doc.mimeType || ""));
      }
    }

    async function loadExt() {
      const extEl = overlay.querySelector("#vExt");
      extEl.style.display = "";
      extEl.innerHTML = '<div class="state"><span class="st-ic st-spin"></span><div>Loading…</div></div>';
      if (entityCache) { drawExt(entityCache); return; }
      const res = await API.get("/documents/" + doc.id + "/entities");
      if (!res.success) {
        extEl.innerHTML = '<div class="state"><span class="st-ic st-bad">?</span><div>' + E(t("viewerExtNone")) + "</div></div>";
        return;
      }
      entityCache = res.data.items || [];
      drawExt(entityCache);
    }

    function drawExt(items) {
      const extEl = overlay.querySelector("#vExt");
      if (!items.length) {
        extEl.innerHTML = '<h4>Extracted information</h4><div class="state"><span class="st-ic">⌀</span><div>' + E(t("viewerExtNone")) + "</div></div>";
        return;
      }
      const reviewCount = items.filter((e) => e.verificationStatus === "NEEDS_REVIEW").length;
      extEl.innerHTML =
        '<h4>Extracted information · ' + items.length + "</h4>" +
        (reviewCount ? '<div class="banner-ai" style="margin-bottom:8px">' + UI.icon("alert", 14) + "<div>" + t("docReview") + " (" + reviewCount + "). " + t("extNote") + "</div></div>" : "") +
        items.map((e) =>
          '<div class="ext-row' + (e.verificationStatus === "NEEDS_REVIEW" ? " review" : "") + '">' +
          '<div class="e-h"><span class="e-type">' + E(e.entityType) + "</span>" +
          '<span>' + UI.chip(e.verificationStatus === "NEEDS_REVIEW" ? "REVIEW" : "EXTRACTED") + "</span></div>" +
          '<div class="e-val">' + E(e.value) + (e.unit ? " " + E(e.unit) : "") + "</div>" +
          '<div class="e-meta">' +
          (e.referenceRange ? "<span>Ref: " + E(e.referenceRange) + "</span>" : "") +
          (e.confidence != null ? "<span>" + Math.round((Number(e.confidence) || 0) * 100) + "% confidence</span>" : "") +
          "</div></div>"
        ).join("");
    }

    function setMode(m) {
      const bodyEl = overlay.querySelector(".viewer-body");
      const extEl = overlay.querySelector("#vExt");
      const mediaEl = overlay.querySelector("#vMedia");
      overlay.querySelector("#vModeDoc").classList.toggle("on", m === "doc");
      overlay.querySelector("#vModeExt").classList.toggle("on", m === "ext");
      overlay.querySelector("#vModeBoth").classList.toggle("on", m === "both");
      bodyEl.classList.toggle("viewer-both", m === "both");
      extEl.style.display = m === "doc" ? "none" : "";
      mediaEl.style.display = m === "ext" ? "none" : "";
      if (m !== "doc" && !entityCache) loadExt();
      applyZoom();
    }

    function applyZoom() {
      const img = overlay.querySelector("#vMedia img");
      if (img) img.style.transform = "scale(" + zoom + ")";
    }

    overlay.querySelector("#vModeDoc").addEventListener("click", () => setMode("doc"));
    overlay.querySelector("#vModeExt").addEventListener("click", () => setMode("ext"));
    overlay.querySelector("#vModeBoth").addEventListener("click", () => setMode("both"));
    overlay.querySelector("#vZoomIn").addEventListener("click", () => { zoom = Math.min(3, zoom + 0.2); applyZoom(); });
    overlay.querySelector("#vZoomOut").addEventListener("click", () => { zoom = Math.max(0.4, zoom - 0.2); applyZoom(); });
    overlay.querySelector("#vFull").addEventListener("click", () => {
      window.open(viewUrl(doc), "_blank", "noopener");
    });

  }

  function escClose(e) { if (e.key === "Escape") close(); }

  function close() {
    if (overlay) {
      overlay.remove();
      overlay = null;
      document.removeEventListener("keydown", escClose);
    }
  }

  // re-declare loadExt properly (hoisted above is a placeholder)
  global.PreclinicDocViewer = { open, close, viewUrl };
})(window);
