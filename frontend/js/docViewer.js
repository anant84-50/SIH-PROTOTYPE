/* Preclinic IQ AI — shared document viewer (patient + doctor) — v4 fixed.
 * Fixes Chrome blocked iframe by using Blob/ObjectURL fetched via API with Authorization.
 * PDF: fetch authorized → Blob → ObjectURL → iframe/embed. JPG/PNG: fetch bytes → img.
 * Toolbar [Zoom Out][Zoom Level][Zoom In][Fit][Fullscreen][Close] never overlaps.
 * Fullscreen via Fullscreen API with fallback large modal. Responsive, no path leak.
 */
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
  let objectUrl = null;
  let objectUrl2 = null;

  function viewUrl(doc) {
    return "/api/v1/documents/" + doc.id + "/view?access_token=" + encodeURIComponent(API.token());
  }
  function fileUrl(doc) {
    return "/api/v1/documents/" + doc.id + "/file?access_token=" + encodeURIComponent(API.token());
  }

  async function fetchBlob(url) {
    // Use Authorization header (real auth) + query token fallback for compatibility.
    // Retry once on 429.
    const headers = {};
    const tok = API.token();
    if (tok) headers["Authorization"] = "Bearer " + tok;
    let res;
    try {
      res = await fetch(url, { headers, credentials: "include" });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1200));
        res = await fetch(url, { headers, credentials: "include" });
      }
    } catch (_e) {
      return { ok: false, code: "error", status: 0 };
    }
    if (res.status === 404) return { ok: false, code: "missing", status: 404 };
    if (res.status === 403) return { ok: false, code: "forbidden", status: 403 };
    if (res.status === 401) return { ok: false, code: "forbidden", status: 401 };
    if (!res.ok) return { ok: false, code: "error", status: res.status };
    const ct = res.headers.get("content-type") || "";
    const blob = await res.blob();
    return { ok: true, blob, contentType: ct };
  }

  function mediaKind(type, doc) {
    const mt = (type || doc.mimeType || "").toLowerCase();
    if (/pdf/.test(mt)) return "pdf";
    if (/^image\//.test(mt) || /\.(jpe?g|png|webp)$/i.test(doc.originalFilename || "")) return "image";
    if (/text\/plain/.test(mt) || /\.(txt|md|csv|json)$/i.test(doc.originalFilename || "")) return "text";
    return "other";
  }

  function errorHtml(code, extra) {
    const msg = code === "missing" ? t("viewerMissing") : code === "forbidden" ? t("viewerForbidden") :
      code === "invalid" ? t("viewerUnsupported") : t("viewerError");
    return '<div class="state"><span class="st-ic st-bad">!</span><div>' + E(msg) + "</div>" +
      (extra ? '<div class="sub">' + E(extra) + "</div>" : "") + "</div>";
  }

  function revokeUrls() {
    if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch (_e) {} objectUrl = null; }
    if (objectUrl2) { try { URL.revokeObjectURL(objectUrl2); } catch (_e) {} objectUrl2 = null; }
  }

  async function open(doc, opts) {
    currentDoc = doc;
    zoom = 1;
    entityCache = null;
    close();
    revokeUrls();

    overlay = document.createElement("div");
    overlay.className = "viewer-ov";
    overlay.innerHTML =
      '<div class="viewer" role="dialog" aria-modal="true" id="viewerRoot">' +
      '<div class="viewer-head"><div class="vh-left"><strong class="v-name">' + UI.icon("doc", 15) + " " + E(doc.originalFilename) + "</strong>" +
      "<span>" + UI.chip(doc.documentType || "FILE") + "</span><span>" + UI.chip(doc.processingStatus) + "</span></div>" +
      '<button class="ic-btn" id="vClose" title="Close" aria-label="Close">' + UI.icon("x", 15) + "</button></div>" +
      '<div class="viewer-tools" id="vTools">' +
      '<div class="vt-group"><button id="vModeDoc" class="on">' + t("docsView") + "</button>" +
      '<button id="vModeExt">' + t("docsExt") + "</button><button id=\"vModeBoth\">Both</button></div>" +
      '<div class="vt-group zoom-group"><button id="vZoomOut" title="Zoom out">' + UI.icon("zoomOut", 14) + "</button>" +
      '<span class="zoom-lbl" id="vZoomLbl">100%</span>' +
      '<button id="vZoomIn" title="Zoom in">' + UI.icon("zoomIn", 14) + "</button>" +
      '<button id="vFit" title="Fit">Fit</button></div>' +
      '<div class="vt-group"><button id="vFull">' + UI.icon("expand", 14) + " " + t("docsFull") + "</button>" +
      '<a class="btn ghost tiny" id="vDl" href="' + E(fileUrl(doc)) + '">' + UI.icon("download", 14) + " Download</a></div>" +
      "</div>" +
      '<div class="viewer-body" id="vBody"><div class="viewer-media" id="vMedia"><div class="state"><span class="st-ic st-spin"></span><div>Loading…</div></div></div>' +
      '<div class="viewer-ext" id="vExt"></div></div></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector("#vClose").addEventListener("click", close);
    document.addEventListener("keydown", escClose);

    const media = overlay.querySelector("#vMedia");
    const ext = overlay.querySelector("#vExt");
    ext.style.display = "none";

    setMode(opts && opts.extract ? "ext" : "doc");
    await loadMedia();

    async function loadMedia() {
      media.innerHTML = '<div class="state"><span class="st-ic st-spin"></span><div>Loading…</div></div>';
      // Use token-authenticated fetch → Blob → ObjectURL (fixes Chrome blocked iframe)
      const apiUrl = "/api/v1/documents/" + doc.id + "/view";
      const res = await fetchBlob(apiUrl);
      if (!res.ok) { media.innerHTML = errorHtml(res.code, "Status " + (res.status || "")); return; }
      const kind = mediaKind(res.contentType, doc);
      if (kind === "pdf") {
        // Create Object URL for PDF blob
        if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch (_e) {} }
        objectUrl = URL.createObjectURL(res.blob);
        // Use iframe with blob URL (Chrome compatible) — fallback embed if needed
        media.innerHTML = '<div class="pdf-wrap"><iframe src="' + E(objectUrl) + '" title="' + E(doc.originalFilename) + '" class="pdf-iframe" loading="lazy"></iframe></div>';
      } else if (kind === "image") {
        if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch (_e) {} }
        objectUrl = URL.createObjectURL(res.blob);
        const wrap = document.createElement("div");
        wrap.className = "img-wrap";
        const img = document.createElement("img");
        img.alt = doc.originalFilename;
        img.src = objectUrl;
        img.className = "zoomable";
        img.style.transform = "scale(" + zoom + ")";
        img.onerror = () => { media.innerHTML = errorHtml("error"); };
        wrap.appendChild(img);
        media.innerHTML = "";
        media.appendChild(wrap);
        applyZoom();
      } else if (kind === "text") {
        try {
          const text = await res.blob.text();
          const pre = document.createElement("pre");
          pre.textContent = text;
          pre.className = "text-preview";
          media.innerHTML = "";
          media.appendChild(pre);
        } catch (_e) {
          media.innerHTML = errorHtml("error");
        }
      } else {
        media.innerHTML = errorHtml("invalid", (doc.originalFilename || "") + " · " + (res.contentType || doc.mimeType || ""));
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
      const img = overlay.querySelector("#vMedia img.zoomable");
      const lbl = overlay.querySelector("#vZoomLbl");
      if (img) {
        img.style.transform = "scale(" + zoom + ")";
        img.style.transformOrigin = "center top";
      }
      if (lbl) lbl.textContent = Math.round(zoom * 100) + "%";
      const iframe = overlay.querySelector("#vMedia iframe.pdf-iframe");
      if (iframe) {
        // For PDF, zoom affects container scale via CSS transform on wrap
        const wrap = iframe.closest(".pdf-wrap");
        if (wrap) wrap.style.transform = "scale(" + zoom + ")";
        if (wrap) wrap.style.transformOrigin = "top left";
      }
    }

    function doFullscreen() {
      const root = document.getElementById("viewerRoot");
      if (!root) return;
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
        return;
      }
      if (root.requestFullscreen) {
        root.requestFullscreen().catch(() => {
          // fallback: large modal
          root.classList.toggle("fullscreen-fallback");
        });
      } else {
        root.classList.toggle("fullscreen-fallback");
      }
    }

    overlay.querySelector("#vModeDoc").addEventListener("click", () => setMode("doc"));
    overlay.querySelector("#vModeExt").addEventListener("click", () => setMode("ext"));
    overlay.querySelector("#vModeBoth").addEventListener("click", () => setMode("both"));
    overlay.querySelector("#vZoomIn").addEventListener("click", () => { zoom = Math.min(3, zoom + 0.2); applyZoom(); });
    overlay.querySelector("#vZoomOut").addEventListener("click", () => { zoom = Math.max(0.4, zoom - 0.2); applyZoom(); });
    overlay.querySelector("#vFit").addEventListener("click", () => { zoom = 1; applyZoom(); });
    overlay.querySelector("#vFull").addEventListener("click", doFullscreen);
    // Keyboard zoom
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "+" || e.key === "=") { zoom = Math.min(3, zoom + 0.2); applyZoom(); }
      if (e.key === "-") { zoom = Math.max(0.4, zoom - 0.2); applyZoom(); }
      if (e.key === "0") { zoom = 1; applyZoom(); }
    });
  }

  function escClose(e) { if (e.key === "Escape") close(); }

  function close() {
    if (overlay) {
      overlay.remove();
      overlay = null;
      document.removeEventListener("keydown", escClose);
      revokeUrls();
    }
  }

  global.PreclinicDocViewer = { open, close, viewUrl, fileUrl };
})(window);
