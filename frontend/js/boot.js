(function () {
  function w(k, v) {
    try { localStorage.setItem(k, v); } catch (_e) { /* ignore */ }
    try { sessionStorage.setItem(k, v); } catch (_e2) { /* ignore */ }
  }
  try {
    var q = new URLSearchParams(location.search);
    var t = q.get("access_token");
    if (!t) return;
    w("preclinic.accessToken", t);
    var parts = t.split(".");
    if (parts.length > 1) {
      var b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      var payload = JSON.parse(atob(b64));
      if (payload && payload.role) {
        w("preclinic.user", JSON.stringify({
          id: payload.sub,
          role: payload.role,
          loginId: payload.loginId || payload.sub,
          displayName: payload.displayName || "",
          patientId: payload.patientId || null,
          doctorId: payload.doctorId || null
        }));
      }
    }
    q.delete("access_token");
    var rest = q.toString();
    history.replaceState({}, "", location.pathname + (rest ? "?" + rest : "") + location.hash);
  } catch (_e) { /* ignore */ }
})();
