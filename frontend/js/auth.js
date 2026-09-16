(function (global) {
  const K = PreclinicAPI.keys;

  function saveSession(data) {
    if (!data || !data.accessToken || !data.user) return false;
    PreclinicAPI.write(K.ACCESS, data.accessToken);
    if (data.refreshToken) PreclinicAPI.write(K.REFRESH, data.refreshToken);
    PreclinicAPI.write(K.USER, JSON.stringify(data.user));
    return true;
  }

  function currentUser() {
    try { return JSON.parse(PreclinicAPI.read(K.USER) || "null"); } catch (_e) { return null; }
  }

  function requireRole(role) {
    const u = currentUser();
    const tok = PreclinicAPI.token();
    if (!u || !tok) {
      return null;
    }
    if (role && u.role !== role && u.role !== "ADMIN") {
      return null;
    }
    return u;
  }

  function guessRole(identifier, selected) {
    const id = (identifier || "").trim();
    if (/^PCI-/i.test(id)) return "PATIENT";
    if (/^DOC-/i.test(id)) return "DOCTOR";
    if (/^NexusCare$/i.test(id) || /^ADMIN/i.test(id)) return "ADMIN";
    return selected || "PATIENT";
  }

  async function login(identifier, password, role) {
    const tried = [];
    const first = guessRole(identifier, role);
    const order = [first, "PATIENT", "DOCTOR", "ADMIN"].filter((r, i, a) => a.indexOf(r) === i);
    let last = null;
    for (let i = 0; i < order.length; i++) {
      const r = order[i];
      if (tried.indexOf(r) >= 0) continue;
      tried.push(r);
      const res = await PreclinicAPI.post("/auth/login", { identifier, password, role: r });
      last = res;
      if (res.success && saveSession(res.data)) return res;
      if (res.error && res.error.code !== "AUTH_INVALID") return res;
    }
    return last || { success: false, error: { code: "AUTH_INVALID", message: "Could not sign in." }, data: null, meta: {} };
  }

  async function registerPatient(payload) {
    return PreclinicAPI.post("/patients", payload);
  }

  async function logout() {
    const refresh = PreclinicAPI.read(K.REFRESH);
    try { await PreclinicAPI.post("/auth/logout", { refreshToken: refresh || "" }); } catch (_e) { /* ignore */ }
    PreclinicAPI.dropAuth();
    location.replace("/login");
  }

  async function me() {
    return PreclinicAPI.get("/auth/me", { skipAuthRedirect: true });
  }

  global.PreclinicAuth = { saveSession, currentUser, requireRole, login, registerPatient, logout, me, guessRole };
})(window);
