(function (global) {
  const API_BASE = "/api/v1";
  const ACCESS = "preclinic.accessToken";
  const REFRESH = "preclinic.refreshToken";
  const USER = "preclinic.user";

  function read(key) {
    try { return localStorage.getItem(key) || sessionStorage.getItem(key); } catch (_e) {
      try { return sessionStorage.getItem(key); } catch (_e2) { return null; }
    }
  }
  function write(key, val) {
    try { localStorage.setItem(key, val); } catch (_e) { /* ignore */ }
    try { sessionStorage.setItem(key, val); } catch (_e2) { /* ignore */ }
  }
  function dropAuth() {
    [ACCESS, REFRESH, USER].forEach((k) => {
      try { localStorage.removeItem(k); } catch (_e) { /* ignore */ }
      try { sessionStorage.removeItem(k); } catch (_e2) { /* ignore */ }
    });
  }
  function token() { return read(ACCESS); }

  async function request(path, options) {
    const opts = options || {};
    const headers = Object.assign({}, opts.headers || {});
    if (opts.body && !opts.isForm) headers["Content-Type"] = headers["Content-Type"] || "application/json";
    const t = token();
    const isLogin = path.indexOf("/auth/login") === 0;
    if (t && !isLogin) {
      headers.Authorization = "Bearer " + t;
      headers["X-Access-Token"] = t;
    }
    let url = API_BASE + path;
    if (t && !isLogin && path.indexOf("access_token=") === -1) {
      url += (path.indexOf("?") >= 0 ? "&" : "?") + "access_token=" + encodeURIComponent(t);
    }
    const res = await fetch(url, Object.assign({ credentials: "same-origin" }, opts, { headers }));
    let body = null;
    try { body = await res.json(); } catch (_e) { body = null; }
    if (!body) {
      return { success: false, data: null, error: { code: "INTERNAL_ERROR", message: "Empty response" }, meta: {} };
    }
    return body;
  }

  global.PreclinicAPI = {
    base: API_BASE,
    keys: { ACCESS, REFRESH, USER },
    token,
    read,
    write,
    dropAuth,
    get: (p, extra) => request(p, Object.assign({ method: "GET" }, extra || {})),
    post: (p, data, extra) => request(p, Object.assign({ method: "POST", body: JSON.stringify(data || {}) }, extra || {})),
    patch: (p, data) => request(p, { method: "PATCH", body: JSON.stringify(data || {}) }),
    upload: async (p, formData) => request(p, { method: "POST", body: formData, isForm: true }),
    request,
  };
})(window);
