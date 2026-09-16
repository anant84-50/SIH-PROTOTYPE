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

  global.PreclinicUI = { $, $$, toast, errMsg, fmtTime, fmtDate, chip, bindLogout, fillWho, navActive };
})(window);
