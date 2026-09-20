(function (global) {
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function toast(message, timeout) {
    let el = $(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast hidden";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.remove("hidden");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add("hidden"), timeout || 3200);
  }

  function errMsg(res) {
    if (!res) return "Unknown error";
    if (res.error && res.error.message) return res.error.message + (res.error.code ? " (" + res.error.code + ")" : "");
    return "Request failed";
  }

  function fmtTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    return String(iso).slice(0, 10);
  }

  function chip(status) {
    const s = status || "";
    let cls = "chip";
    if (/VERIFIED|RESOLVED|ok|SUCCEEDED/i.test(s)) cls += " ok";
    else if (/ACTIVE|URGENT|REJECTED|FAILED|OPEN/i.test(s)) cls += " warn";
    else if (/DRAFT|REVIEW|QUEUED/i.test(s)) cls += " gold";
    else cls += " leaf";
    return '<span class="' + cls + '">' + s.replace(/_/g, " ") + "</span>";
  }

  function bindLogout(sel) {
    const el = $(sel);
    if (el) el.addEventListener("click", (e) => { e.preventDefault(); PreclinicAuth.logout(); });
  }

  function fillWho(user) {
    const name = $("#whoName");
    const meta = $("#whoMeta");
    if (name) name.textContent = user.displayName || user.loginId;
    if (meta) meta.textContent = (user.role || "") + (user.patientId ? " · " + user.patientId : "") + (user.doctorId ? " · " + user.doctorId : "");
  }

  function navActive() {
    $$(".nav a").forEach((a) => {
      if (a.getAttribute("href") === location.pathname) a.classList.add("active");
    });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function relTime(isoStr) {
    if (!isoStr) return "—";
    const t = new Date(isoStr.endsWith("Z") ? isoStr : isoStr + "Z").getTime();
    if (Number.isNaN(t)) return isoStr;
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    if (s < 7 * 86400) return Math.floor(s / 86400) + " d ago";
    return fmtDate(isoStr);
  }

  // Loading / empty / error / unauthorized states — no blank screens.
  function state(el, kind, msg, extra) {
    if (!el) return;
    const icons = {
      loading: '<span class="st-ic st-spin"></span>',
      empty: '<span class="st-ic">⌀</span>',
      error: '<span class="st-ic st-bad">!</span>',
      unauthorized: '<span class="st-ic st-bad">⚿</span>',
      review: '<span class="st-ic st-warn">?</span>',
    };
    el.innerHTML = '<div class="state state-' + kind + '">' + (icons[kind] || icons.empty) +
      (msg ? "<div>" + msg + "</div>" : "") +
      (extra ? "<div>" + extra + "</div>" : "") + "</div>";
  }

  const ICONS = {
    dashboard: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
    queue: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
    siren: "M12 3v2M5.6 5.6l1.4 1.4M2 13h3c0-3.3 2.7-6 6-6s6 2.7 6 6h3M5 21h14M7 21v-4c0-2 1.5-3.5 3.5-3.5h3c2 0 3.5 1.5 3.5 3.5v4M12 8v3l2 2",
    records: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 11h18",
    summary: "M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 13h6M9 17h6",
    documents: "M6 2h9l5 5v15H6zM15 2v5h5",
    clock: "M12 3a9 9 0 1 0 .01 0zM12 7v5l3 2",
    check: "M4 12.5 9.5 18 20 6",
    verified: "M12 3l2.4 2.4 3.4-.5.5 3.4L21 12l-2.7 3.7-.5 3.4-3.4-.5L12 21l-2.4-2.4-3.4.5-.5-3.4L3 12l2.7-3.7.5-3.4 3.4.5z",
    activity: "M3 12h4l3-8 4 16 3-8h4",
    bell: "M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 19a2 2 0 0 0 4 0",
    profile: "M12 12a4 4 0 1 0-.01-8A4 4 0 0 0 12 12zM4 21c0-4 3.6-6 8-6s8 2 8 6",
    settings: "M12 15a3 3 0 1 0-.01-6A3 3 0 0 0 12 15zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2z",
    logout: "M15 12H4M8 8l-4 4 4 4M12 4h6a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-6",
    search: "M11 5a6 6 0 1 0 .01 0zM16 16l5 5",
    plus: "M12 5v14M5 12h14",
    x: "M6 6l12 12M18 6L6 18",
    chevR: "M9 5l7 7-7 7",
    eye: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6zM12 12a2.5 2.5 0 1 0 .01 0z",
    expand: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
    download: "M12 3v12M7 10l5 5 5-5M4 21h16",
    zoomIn: "M11 5a6 6 0 1 0 .01 0zM16 16l5 5M11 8v6M8 11h6",
    zoomOut: "M11 5a6 6 0 1 0 .01 0zM16 16l5 5M8 11h6",
    calendar: "M4 6h16v15H4zM4 10h16M8 3v5M16 3v5",
    mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zM6 11a6 6 0 0 0 12 0M12 17v4",
    alert: "M12 3 2 20h20zM12 10v4M12 17h.01",
    history: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l4 2",
    compare: "M9 3H4v18h5zM15 3h5v18h-5zM12 3v18",
    external: "M14 4h6v6M20 4l-9 9M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5",
    steth: "M5 3v6a5 5 0 0 0 10 0V3M5 3H4M5 3h1M15 3h1M15 3h-1M10 14v2a5 5 0 0 0 10 0v-2M20 16a2 2 0 1 0 .01 0",
    back: "M15 5l-7 7 7 7",
    doc: "M6 2h9l5 5v15H6zM15 2v5h5M9 13h6M9 17h4",
    guide: "M22 9 12 4 2 9l10 5 10-5zM6 11.5V16c0 1.6 2.7 3 6 3s6-1.4 6-3v-4.5M22 9v5",
  };

  function icon(name, size) {
    const d = ICONS[name] || ICONS.dashboard;
    return '<svg class="ic" width="' + (size || 17) + '" height="' + (size || 17) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
  }

  function greeting() {
    const h = new Date().getHours();
    const I = (window.PreclinicI18n ? PreclinicI18n.t : (k) => k);
    return h < 12 ? I("gMorning") : h < 17 ? I("gAfternoon") : I("gEvening");
  }

  // Fallback for browsers without :has() — mark shell pages for overflow handling
  try {
    if (document.querySelector('.shell')) {
      document.documentElement.classList.add('has-shell');
      document.body.classList.add('has-shell');
    }
  } catch (_e) { /* ignore */ }

  global.PreclinicUI = { $, $$, toast, errMsg, fmtTime, fmtDate, chip, bindLogout, fillWho, navActive, esc, relTime, state, icon, greeting };
})(window);
