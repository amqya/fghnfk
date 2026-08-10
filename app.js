/* ===== UniMatch — client-side logic ===== */
(() => {
  "use strict";

  const LS = {
    saved: "unimatch.saved",
    passed: "unimatch.passed",
    filters: "unimatch.filters",
  };

  let ALL = [];               // all colleges
  let matches = [];           // current filtered deck (excluding already-decided)
  let idx = 0;                // pointer into matches
  let lastAction = null;      // for undo: {college, verdict}

  const state = {
    saved: loadSet(LS.saved),
    passed: loadSet(LS.passed),
  };

  // ---------- filter option definitions ----------
  const REGIONS = ["Northeast", "Midwest", "South", "West", "Territories"];
  const DEGREES = [
    ["4-year", "🎓 4-year"],
    ["2-year", "🏫 2-year / community"],
    ["Graduate", "📚 Grad-focused"],
  ];
  const CONTROLS = [
    ["Public", "🏛️ Public"],
    ["Private nonprofit", "🌿 Private nonprofit"],
    ["For-profit", "💼 For-profit"],
  ];
  const SIZES = [
    "Very small (<1k)", "Small (1k–3k)", "Medium (3k–10k)",
    "Large (10k–20k)", "Very large (20k+)",
  ];
  const SETTINGS = [
    ["City", "🏙️ City"], ["Suburb", "🏡 Suburb"],
    ["Town", "🏘️ Town"], ["Rural", "🌾 Rural"],
  ];
  const SELECTIVITY = [
    "Most selective", "Highly selective", "Selective",
    "Less selective", "Test-optional / Open",
  ];
  const MISSIONS = [
    ["hbcu", "HBCU"], ["hsi", "Hispanic-serving"], ["tribal", "Tribal college"],
    ["womenOnly", "Women's college"], ["menOnly", "Men's college"],
    ["religious", "Religiously affiliated"],
  ];

  // Default filter selections
  const DEFAULTS = {
    region: [], state: [], degree: ["4-year"],
    control: ["Public", "Private nonprofit"],
    sizeCategory: [], setting: [], selectivity: [], major: [], mission: [],
    maxCost: 60000,
  };
  let filters = loadFilters();

  // ---------- boot ----------
  fetch("data/colleges.json")
    .then((r) => r.json())
    .then((data) => {
      ALL = data;
      buildFilterUI();
      wire();
      updateMatchCount();
      updateSavedPill();
      show("filters");
    })
    .catch(() => {
      document.getElementById("view-filters").innerHTML =
        '<p style="color:#fff;text-align:center">Could not load college data. ' +
        'Make sure you are serving this folder (e.g. <code>python3 -m http.server</code>).</p>';
    });

  // ---------- persistence helpers ----------
  function loadSet(key) {
    try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); }
    catch { return new Set(); }
  }
  function saveSet(key, set) {
    try { localStorage.setItem(key, JSON.stringify([...set])); } catch {}
  }
  function loadFilters() {
    try {
      const f = JSON.parse(localStorage.getItem(LS.filters));
      return f ? Object.assign({}, DEFAULTS, f) : Object.assign({}, DEFAULTS);
    } catch { return Object.assign({}, DEFAULTS); }
  }
  function saveFilters() {
    try { localStorage.setItem(LS.filters, JSON.stringify(filters)); } catch {}
  }

  // ---------- build filter UI ----------
  function chip(name, value, label) {
    const on = (filters[name] || []).includes(value);
    const el = document.createElement("label");
    el.className = "chip" + (on ? " on" : "");
    el.innerHTML =
      `<input type="checkbox" ${on ? "checked" : ""}><span>${label}</span>`;
    el.querySelector("input").addEventListener("change", (e) => {
      const arr = new Set(filters[name] || []);
      if (e.target.checked) arr.add(value); else arr.delete(value);
      filters[name] = [...arr];
      el.classList.toggle("on", e.target.checked);
      afterFilterChange();
    });
    return el;
  }

  function fillChips(name, items) {
    const box = document.querySelector(`.chips[data-name="${name}"]`);
    box.innerHTML = "";
    items.forEach(([v, l]) => box.appendChild(chip(name, v, l)));
  }

  function buildFilterUI() {
    fillChips("region", REGIONS.map((r) => [r, r]));
    fillChips("degree", DEGREES);
    fillChips("control", CONTROLS);
    fillChips("sizeCategory", SIZES.map((s) => [s, s]));
    fillChips("setting", SETTINGS);
    fillChips("selectivity", SELECTIVITY.map((s) => [s, s]));
    fillChips("mission", MISSIONS);

    // States (from data), searchable
    const states = [...new Set(ALL.map((c) => c.stateName))].sort();
    fillChips("state", states.map((s) => [s, s]));
    filterChipList("stateSearch", "state");

    // Majors (from data), searchable
    const majors = [...new Set(ALL.flatMap((c) => c.majors))].sort();
    fillChips("major", majors.map((m) => [m, m]));
    filterChipList("majorSearch", "major");

    // cost slider
    const range = document.getElementById("costRange");
    range.value = filters.maxCost;
    updateCostLabel();
    range.addEventListener("input", () => {
      filters.maxCost = +range.value;
      updateCostLabel();
      afterFilterChange();
    });
  }

  function updateCostLabel() {
    const v = +document.getElementById("costRange").value;
    document.getElementById("costLabel").textContent =
      v >= 60000 ? "no limit" : "up to $" + v.toLocaleString() + "/yr";
  }

  function filterChipList(inputId, name) {
    const input = document.getElementById(inputId);
    const box = document.querySelector(`.chips[data-name="${name}"]`);
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      [...box.children].forEach((ch) => {
        const t = ch.textContent.toLowerCase();
        ch.style.display = t.includes(q) ? "" : "none";
      });
    });
  }

  function afterFilterChange() {
    saveFilters();
    updateMatchCount();
  }

  // ---------- matching ----------
  function passesFilters(c) {
    const f = filters;
    if (f.region.length && !f.region.includes(c.region)) return false;
    if (f.state.length && !f.state.includes(c.stateName)) return false;
    if (f.degree.length && !f.degree.includes(c.degree)) return false;
    if (f.control.length && !f.control.includes(c.control)) return false;
    if (f.sizeCategory.length && !f.sizeCategory.includes(c.sizeCategory)) return false;
    if (f.setting.length && !f.setting.includes(c.setting)) return false;
    if (f.selectivity.length && !f.selectivity.includes(c.selectivity)) return false;
    if (f.major.length && !c.majors.some((m) => f.major.includes(m))) return false;
    if (f.mission.length && !f.mission.some((m) => c.flags[m])) return false;
    // cost: only exclude when a known price exceeds the cap (unknown still shows)
    if (f.maxCost < 60000 && c.netPrice != null && c.netPrice > f.maxCost) return false;
    return true;
  }

  function computeMatches(includeDecided) {
    return ALL.filter((c) => {
      if (!passesFilters(c)) return false;
      if (!includeDecided && (state.saved.has(c.id) || state.passed.has(c.id))) return false;
      return true;
    });
  }

  function updateMatchCount() {
    const n = ALL.filter(passesFilters).length;
    document.getElementById("matchCount").textContent = n.toLocaleString();
  }

  // ---------- rendering: summary + card ----------
  const fmt = (n) => n == null ? null : n.toLocaleString();

  function bannerGradient(c) {
    // deterministic hue from name so each school has a stable color
    let h = 0;
    for (let i = 0; i < c.name.length; i++) h = (h * 31 + c.name.charCodeAt(i)) % 360;
    return `linear-gradient(135deg, hsl(${h} 70% 45%), hsl(${(h + 40) % 360} 75% 38%))`;
  }

  function summarize(c) {
    const sizeWord = c.size == null ? "" :
      c.size >= 20000 ? "large " : c.size < 3000 ? "small " : "mid-sized ";
    const type = c.control === "Public" ? "public" :
      c.control === "For-profit" ? "for-profit" : "private";
    const deg = c.degree === "2-year" ? "2-year college" :
      c.degree === "Graduate" ? "university" : "university";
    let s = `${c.name} is a ${sizeWord}${type} ${deg} in ${c.city}, ${c.stateName}.`;
    const bits = [];
    if (c.size != null) bits.push(`about ${fmt(c.size)} undergraduates`);
    if (c.netPrice != null) bits.push(`average net cost around $${fmt(c.netPrice)}/yr`);
    if (c.gradRate != null) bits.push(`${c.gradRate}% graduate on time`);
    if (bits.length) s += " It has " + joinList(bits) + ".";
    if (c.majors.length) s += " Students most often study " + joinList(c.majors.slice(0, 3)) + ".";
    return s;
  }

  function joinList(a) {
    if (a.length <= 1) return a.join("");
    return a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
  }

  function missionBadges(c) {
    const out = [];
    if (c.flags.hbcu) out.push("HBCU");
    if (c.flags.hsi) out.push("Hispanic-serving");
    if (c.flags.tribal) out.push("Tribal college");
    if (c.flags.womenOnly) out.push("Women's college");
    if (c.flags.menOnly) out.push("Men's college");
    if (c.flags.religious) out.push("Religiously affiliated");
    return out;
  }

  function cardEl(c) {
    const el = document.createElement("article");
    el.className = "card";

    const stats = [];
    if (c.size != null) stats.push(["Undergrads", fmt(c.size)]);
    if (c.netPrice != null) stats.push(["Avg net price", "$" + fmt(c.netPrice) + "/yr"]);
    if (c.gradRate != null) stats.push(["Grad rate", c.gradRate + "%"]);
    if (c.satAvg != null) stats.push(["Avg SAT", fmt(c.satAvg)]);
    if (c.earnings != null) stats.push(["Median pay (10yr)", "$" + fmt(c.earnings)]);
    stats.push(["Selectivity", c.selectivity.replace(" / ", "/")]);

    const badges = [
      `<span class="badge">${c.control}</span>`,
      `<span class="badge">${c.degree}</span>`,
      c.setting ? `<span class="badge">${c.setting}</span>` : "",
      c.sizeCategory ? `<span class="badge accent">${c.sizeCategory}</span>` : "",
      ...missionBadges(c).map((m) => `<span class="badge mission">${m}</span>`),
    ].join("");

    el.innerHTML = `
      <div class="stamp like">Save</div>
      <div class="stamp nope">Pass</div>
      <div class="banner" style="background:${bannerGradient(c)}">
        <h2>${escapeHtml(c.name)}</h2>
        <div class="loc">📍 ${escapeHtml(c.city)}, ${c.state} · ${c.region}</div>
      </div>
      <div class="body">
        <div class="badges">${badges}</div>
        <p class="summary">${escapeHtml(summarize(c))}</p>
        <div class="stats">
          ${stats.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("")}
        </div>
        <div class="readmore"><button type="button">Read more ▾</button></div>
        <div class="details hidden">
          <h3>Popular fields of study</h3>
          <div class="majorlist">${c.majors.map((m) => `<span>${escapeHtml(m)}</span>`).join("") || "<span>Not reported</span>"}</div>
          <h3>At a glance</h3>
          <div class="majorlist">
            <span>${c.stateName}</span>
            <span>${c.control}</span>
            <span>${c.degree}</span>
            ${c.setting ? `<span>${c.setting} setting</span>` : ""}
          </div>
          ${c.url ? `<a class="weblink" href="${encodeURI(c.url)}" target="_blank" rel="noopener">Visit official site ↗</a>` : ""}
        </div>
      </div>`;

    const rm = el.querySelector(".readmore button");
    const details = el.querySelector(".details");
    rm.addEventListener("click", (e) => {
      e.stopPropagation();
      const hidden = details.classList.toggle("hidden");
      rm.textContent = hidden ? "Read more ▾" : "Show less ▴";
    });

    enableDrag(el, c);
    return el;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  // ---------- deck flow ----------
  function startDeck() {
    matches = computeMatches(false);
    idx = 0;
    lastAction = null;
    document.getElementById("undoBtn").disabled = true;
    renderDeck();
  }

  function renderDeck() {
    const deck = document.getElementById("deck");
    const empty = document.getElementById("deckEmpty");
    const controls = document.getElementById("deckControls");
    deck.innerHTML = "";

    document.getElementById("deckTotal").textContent = matches.length;
    document.getElementById("deckPos").textContent = Math.min(idx + 1, matches.length);

    const remaining = matches.length - idx;
    if (remaining <= 0) {
      deck.hidden = true; controls.style.visibility = "hidden";
      empty.hidden = false;
      const anyPassed = state.passed.size > 0;
      document.getElementById("reviewPassed").hidden = !anyPassed;
      document.getElementById("emptyMsg").textContent =
        matches.length === 0
          ? "No schools matched your filters. Try widening them."
          : `You reviewed ${matches.length} matching ${matches.length === 1 ? "school" : "schools"}. ` +
            `${state.saved.size} saved.`;
      return;
    }
    deck.hidden = false; controls.style.visibility = "visible"; empty.hidden = true;

    // render up to 3 stacked cards (top is interactive)
    const upto = Math.min(idx + 3, matches.length);
    for (let i = upto - 1; i >= idx; i--) {
      const el = cardEl(matches[i]);
      const depth = i - idx;
      el.style.transform = `translateY(${depth * 10}px) scale(${1 - depth * 0.04})`;
      el.style.zIndex = String(100 - depth);
      el.dataset.depth = depth;
      deck.appendChild(el);
    }
  }

  function topCard() {
    return document.querySelector('.card[data-depth="0"]');
  }

  function decide(verdict) {
    if (idx >= matches.length) return;
    const c = matches[idx];
    if (verdict === "save") { state.saved.add(c.id); state.passed.delete(c.id); }
    else { state.passed.add(c.id); state.saved.delete(c.id); }
    saveSet(LS.saved, state.saved); saveSet(LS.passed, state.passed);
    lastAction = { id: c.id, verdict };
    document.getElementById("undoBtn").disabled = false;
    updateSavedPill();
    idx++;
    renderDeck();
  }

  function flyOut(dir) {
    const card = topCard();
    if (!card) { decide(dir > 0 ? "save" : "pass"); return; }
    card.style.transition = "transform .35s ease, opacity .35s ease";
    card.style.transform = `translate(${dir * 600}px, -40px) rotate(${dir * 22}deg)`;
    card.style.opacity = "0";
    const stamp = card.querySelector(dir > 0 ? ".stamp.like" : ".stamp.nope");
    if (stamp) stamp.style.opacity = "1";
    setTimeout(() => decide(dir > 0 ? "save" : "pass"), 220);
  }

  function undo() {
    if (!lastAction) return;
    state.saved.delete(lastAction.id);
    state.passed.delete(lastAction.id);
    saveSet(LS.saved, state.saved); saveSet(LS.passed, state.passed);
    idx = Math.max(0, idx - 1);
    lastAction = null;
    document.getElementById("undoBtn").disabled = true;
    updateSavedPill();
    renderDeck();
    toast("Undone");
  }

  // ---------- drag / swipe ----------
  function enableDrag(card, c) {
    let sx = 0, sy = 0, dx = 0, dy = 0, dragging = false;
    const like = card.querySelector(".stamp.like");
    const nope = card.querySelector(".stamp.nope");

    const down = (e) => {
      if (card.dataset.depth !== "0") return;
      if (e.target.closest(".readmore, .weblink, .body")) {
        // allow scrolling / link taps inside the body without starting a drag,
        // unless the drag begins on the banner
        if (!e.target.closest(".banner")) { /* still allow drag from body */ }
      }
      dragging = true;
      const p = point(e);
      sx = p.x; sy = p.y;
      card.style.transition = "none";
      if (e.pointerId != null) card.setPointerCapture?.(e.pointerId);
    };
    const move = (e) => {
      if (!dragging) return;
      const p = point(e);
      dx = p.x - sx; dy = p.y - sy;
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
      const r = Math.min(Math.abs(dx) / 120, 1);
      if (dx > 0) { like.style.opacity = r; nope.style.opacity = 0; }
      else { nope.style.opacity = r; like.style.opacity = 0; }
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      card.style.transition = "transform .3s ease";
      if (dx > 110) return flyOut(1);
      if (dx < -110) return flyOut(-1);
      card.style.transform = "translateY(0) scale(1)";
      like.style.opacity = 0; nope.style.opacity = 0;
      dx = dy = 0;
    };

    card.addEventListener("pointerdown", down);
    card.addEventListener("pointermove", move);
    card.addEventListener("pointerup", up);
    card.addEventListener("pointercancel", up);
  }
  function point(e) {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  // ---------- my list ----------
  function renderList() {
    const wrap = document.getElementById("savedList");
    const empty = document.getElementById("savedEmpty");
    const saved = ALL.filter((c) => state.saved.has(c.id));
    document.getElementById("listSummary").textContent =
      `${saved.length} saved · ${state.passed.size} passed`;
    empty.style.display = saved.length ? "none" : "";
    wrap.innerHTML = "";
    saved.forEach((c) => {
      const el = document.createElement("div");
      el.className = "saved-card";
      el.innerHTML = `
        <h3>${escapeHtml(c.name)}</h3>
        <div class="loc">📍 ${escapeHtml(c.city)}, ${c.state} · ${c.control} · ${c.degree}</div>
        <div class="row">
          ${c.netPrice != null ? `<span class="badge accent">$${fmt(c.netPrice)}/yr</span>` : ""}
          ${c.gradRate != null ? `<span class="badge">${c.gradRate}% grad</span>` : ""}
          ${c.size != null ? `<span class="badge">${fmt(c.size)} students</span>` : ""}
        </div>
        <div class="foot">
          ${c.url ? `<a class="weblink" href="${encodeURI(c.url)}" target="_blank" rel="noopener">Official site ↗</a>` : "<span></span>"}
          <button class="remove" data-id="${c.id}">Remove</button>
        </div>`;
      el.querySelector(".remove").addEventListener("click", () => {
        state.saved.delete(c.id); saveSet(LS.saved, state.saved);
        updateSavedPill(); renderList();
      });
      wrap.appendChild(el);
    });
  }

  function copyList() {
    const saved = ALL.filter((c) => state.saved.has(c.id));
    if (!saved.length) return toast("Nothing to copy yet");
    const text = saved.map((c, i) =>
      `${i + 1}. ${c.name} — ${c.city}, ${c.state}${c.url ? " (" + c.url + ")" : ""}`
    ).join("\n");
    navigator.clipboard?.writeText("My college shortlist:\n" + text)
      .then(() => toast("Shortlist copied to clipboard"))
      .catch(() => toast("Copy failed"));
  }

  // ---------- nav & wiring ----------
  function show(view) {
    ["filters", "deck", "list"].forEach((v) => {
      document.getElementById("view-" + v).hidden = v !== view;
    });
    document.querySelectorAll(".nav-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.go === view));
    if (view === "deck") startDeck();
    if (view === "list") renderList();
    window.scrollTo(0, 0);
  }

  function updateSavedPill() {
    document.getElementById("savedPill").textContent = state.saved.size;
  }

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 1800);
  }

  function wire() {
    document.querySelectorAll("[data-go]").forEach((b) =>
      b.addEventListener("click", () => show(b.dataset.go)));
    document.getElementById("brandHome").addEventListener("click", () => show("filters"));

    document.getElementById("filterForm").addEventListener("submit", (e) => {
      e.preventDefault();
      show("deck");
    });
    document.getElementById("resetBtn").addEventListener("click", () => {
      filters = Object.assign({}, DEFAULTS, { degree: ["4-year"], control: ["Public", "Private nonprofit"] });
      saveFilters();
      buildFilterUI();
      updateMatchCount();
      toast("Filters reset");
    });

    document.getElementById("btnSave").addEventListener("click", () => flyOut(1));
    document.getElementById("btnPass").addEventListener("click", () => flyOut(-1));
    document.getElementById("btnInfo").addEventListener("click", () => {
      const card = topCard();
      if (card) card.querySelector(".readmore button").click();
    });
    document.getElementById("undoBtn").addEventListener("click", undo);
    document.getElementById("reviewPassed").addEventListener("click", () => {
      state.passed.clear(); saveSet(LS.passed, state.passed);
      startDeck(); toast("Passed schools are back in the deck");
    });

    document.getElementById("copyList").addEventListener("click", copyList);
    document.getElementById("clearSaved").addEventListener("click", () => {
      if (!state.saved.size) return;
      if (confirm("Clear your entire saved list?")) {
        state.saved.clear(); saveSet(LS.saved, state.saved);
        updateSavedPill(); renderList(); toast("List cleared");
      }
    });

    // keyboard shortcuts on deck
    document.addEventListener("keydown", (e) => {
      if (document.getElementById("view-deck").hidden) return;
      if (e.key === "ArrowLeft") flyOut(-1);
      else if (e.key === "ArrowRight") flyOut(1);
      else if (e.key === "ArrowUp" || e.key === "i") document.getElementById("btnInfo").click();
      else if (e.key === "z" && (e.ctrlKey || e.metaKey)) undo();
    });
  }
})();
