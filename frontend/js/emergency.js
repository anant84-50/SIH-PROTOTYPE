(function (global) {
  let timer = null;
  let socket = null;

  function renderBanner(items) {
    const host = document.getElementById("emergencyBanner");
    if (!host) return;
    const active = (items || []).filter((e) => e.status === "ACTIVE" || e.status === "ACKNOWLEDGED");
    if (!active.length) { host.classList.add("hidden"); host.innerHTML = ""; return; }
    const first = active[0];
    host.classList.remove("hidden");
    host.innerHTML = "<div><strong>Emergency desk</strong> · " + active.length + " open · " +
      (first.reason || first.priority) + " · " + (first.patientId || "") + "</div>";
  }

  async function poll() {
    const res = await PreclinicAPI.get("/emergency/active");
    if (res.success) renderBanner(res.data.items || []);
  }

  function connect(onEvent) {
    const token = PreclinicAPI.token();
    if (!token) return;
    try {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(proto + "://" + location.host + "/api/v1/ws/emergencies?token=" + encodeURIComponent(token));
      socket.onmessage = (ev) => {
        let data = {};
        try { data = JSON.parse(ev.data); } catch (_e) { return; }
        if (data.type === "emergency.created" && onEvent) onEvent(data);
        poll();
      };
      socket.onclose = () => { socket = null; };
      socket.onerror = () => { try { socket.close(); } catch (_e) { /* ignore */ } };
    } catch (_e) { socket = null; }
    if (!timer) timer = setInterval(poll, 8000);
    poll();
  }

  async function trigger(patientId, visitId, text) {
    return PreclinicAPI.post("/emergency/trigger", { patientId, visitId, text, priority: "HIGH" });
  }

  global.PreclinicEmergency = { connect, poll, trigger, renderBanner };
})(window);
