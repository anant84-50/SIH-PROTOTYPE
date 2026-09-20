(function (global) {
  /*
   * PreclinicTutorial — lightweight guided overlay tour.
   *
   * Steps: { id, title, body, target? ("selector"), goFirst? ("hash to navigate
   * to before showing this step"), goNext? ("hash to navigate to when Next is
   * pressed"), center? (bool — always show the card centered) }
   *
   * - Highlights the real target element with a spotlight (no fake elements).
   * - Next/Previous/Skip/Finish/Close are all real; navigation is the app's
   *   own hash routing — the tour never invents screens.
   * - Completion is persisted per role in localStorage; replay is allowed.
   */
  let state = null;

  function storeKey(role) { return "preclinic.tour." + role; }
  function isDone(role) {
    try { return localStorage.getItem(storeKey(role)) === "done"; } catch (_e) { return false; }
  }
  function markDone(role) {
    try { localStorage.setItem(storeKey(role), "done"); } catch (_e) { /* ignore */ }
  }

  function rectOf(sel) {
    const els = document.querySelectorAll(sel);
    for (let i = 0; i < els.length; i += 1) {
      const r = els[i].getBoundingClientRect();
      if (r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < window.innerHeight) return { rect: r, el: els[i] };
    }
    return null;
  }

  function layout() {
    if (!state) return;
    const { spot, card } = state;
    const step = state.steps[state.i];
    const found = !step.center && step.target ? rectOf(step.target) : null;
    if (found) {
      spot.style.display = "block";
      const r = found.rect;
      spot.style.left = (r.left - 6) + "px";
      spot.style.top = (r.top - 6) + "px";
      spot.style.width = (r.width + 12) + "px";
      spot.style.height = (r.height + 12) + "px";
      // place the card: prefer below, else above, else centered
      const cw = 340, ch = card.offsetHeight || 220;
      let left = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), window.innerWidth - cw - 12);
      let top = r.bottom + 14;
      if (top + ch > window.innerHeight - 12) top = r.top - ch - 14;
      if (top < 12) top = Math.min(Math.max(12, window.innerHeight / 2 - ch / 2), window.innerHeight - ch - 12);
      card.style.left = left + "px";
      card.style.top = top + "px";
      card.style.position = "fixed";
    } else {
      spot.style.display = "none";
      const cw = Math.min(400, window.innerWidth - 24);
      card.style.left = ((window.innerWidth - cw) / 2) + "px";
      card.style.top = Math.max(12, (window.innerHeight - (card.offsetHeight || 220)) / 2 - 40) + "px";
      card.style.position = "fixed";
    }
  }

  function paint() {
    if (!state) return;
    const { card, steps } = state;
    const step = steps[state.i];
    const total = steps.length;
    card.querySelector(".tour-title").textContent = step.title || "";
    card.querySelector(".tour-body").textContent = step.body || "";
    card.querySelector(".tour-count").textContent = (state.i + 1) + " / " + total;
    card.querySelector("[data-tour=prev]").disabled = state.i === 0;
    const nextBtn = card.querySelector("[data-tour=next]");
    nextBtn.textContent = state.i === total - 1 ? (state.nextLabel || "Finish") : (state.nextLabel || "Next");
    layout();
  }

  function cleanup() {
    if (!state) return;
    const { spot, card } = state;
    spot.remove();
    card.remove();
    window.removeEventListener("scroll", layout, true);
    window.removeEventListener("resize", layout);
    window.removeEventListener("hashchange", onHash);
    state = null;
  }

  function onHash() {
    // App re-rendered after a hash navigation — paint the new step's text and
    // reposition once the new screen has a chance to paint, then retry a few
    // times for async views whose targets appear later.
    let tries = 0;
    const tick = () => {
      if (!state) return;
      paint();
      if (!state.targetFound && ++tries < 10 && state.steps[state.i] && state.steps[state.i].target) {
        if (rectOf(state.steps[state.i].target)) { state.targetFound = true; } else { setTimeout(tick, 250); }
      }
    };
    setTimeout(tick, 60);
  }

  function finish(completed) {
    const role = state && state.role;
    cleanup();
    if (completed && role) markDone(role);
    if (global.document) document.dispatchEvent(new CustomEvent("preclinic:tour:end", { detail: { role: role, completed: !!completed } }));
  }

  function start(role, steps, opts) {
    if (state) cleanup();
    opts = opts || {};
    const d = document;
    const spot = d.createElement("div");
    spot.className = "tour-spot";
    const card = d.createElement("div");
    card.className = "tour-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.innerHTML =
      '<button class="tour-x" data-tour="close" aria-label="Close tour">✕</button>' +
      '<div class="tour-count"></div>' +
      '<h4 class="tour-title"></h4>' +
      '<p class="tour-body"></p>' +
      '<div class="tour-actions">' +
      '<button class="btn ghost tiny" data-tour="prev">Previous</button>' +
      '<span class="tour-skip"><button class="link" data-tour="skip">Skip tour</button></span>' +
      '<button class="btn tiny" data-tour="next">Next</button>' +
      "</div>";
    d.body.appendChild(spot);
    d.body.appendChild(card);
    state = { role: role, steps: steps, i: 0, spot: spot, card: card, targetFound: false, nextLabel: opts.finishLabel };
    card.querySelector("[data-tour=prev]").addEventListener("click", () => {
      if (state.i > 0) { state.i -= 1; state.targetFound = false; paint(); }
    });
    card.querySelector("[data-tour=next]").addEventListener("click", () => {
      const step = state.steps[state.i];
      const last = state.i === state.steps.length - 1;
      if (last) { finish(true); return; }
      state.i += 1;
      state.targetFound = false;
      const nxt = state.steps[state.i];
      if (nxt.goFirst) {
        if (location.hash !== "#" + nxt.goFirst) location.hash = "#" + nxt.goFirst;
        else paint();
        return; // onHash() will paint after render
      }
      paint();
    });
    card.querySelector("[data-tour=skip]").addEventListener("click", () => finish(false));
    card.querySelector("[data-tour=close]").addEventListener("click", () => finish(false));
    window.addEventListener("scroll", layout, true);
    window.addEventListener("resize", layout);
    window.addEventListener("hashchange", onHash);
    // first step: navigate if needed
    const first = state.steps[0];
    if (first.goFirst && location.hash !== "#" + first.goFirst) { location.hash = "#" + first.goFirst; return; }
    paint();
  }

  global.PreclinicTutorial = { isDone, markDone, start };
})(window);
