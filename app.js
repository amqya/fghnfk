/* ===== UniMatch — client logic ===== */
(() => {
  "use strict";

  const LS = { saved: "unimatch.saved", passed: "unimatch.passed", filters: "unimatch.filters", photo: "unimatch.photo.", profile: "unimatch.profile" };

  let ALL = [], BYID = {}, matches = [], idx = 0, lastAction = null;
  const state = { saved: loadSet(LS.saved), passed: loadSet(LS.passed) };
  let profile = loadProfile();
  const compare = { a: null, b: null };

  // ---------- theme ----------
  function applyTheme(t) {
    if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
    const btn = document.getElementById("themeToggle");
    if (btn) btn.textContent = currentDark() ? "☀️" : "🌙";
  }
  function currentDark() {
    const t = localStorage.getItem("unimatch.theme");
    if (t === "dark") return true;
    if (t === "light") return false;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  (function initTheme() { applyTheme(localStorage.getItem("unimatch.theme")); })();

  // ---------- academic profile & chancing ----------
  const ACT_TO_SAT = { 36:1590,35:1540,34:1500,33:1460,32:1430,31:1400,30:1370,29:1340,28:1310,27:1280,26:1240,25:1210,24:1180,23:1140,22:1110,21:1080,20:1040,19:1010,18:970,17:930,16:890,15:850,14:800,13:760,12:710,11:670,10:630,9:590 };
  function loadProfile() { try { return { sat: null, act: null, gpa: null, aLevels: [], ...(JSON.parse(localStorage.getItem(LS.profile)) || {}) }; } catch { return { sat: null, act: null, gpa: null, aLevels: [] }; } }
  function saveProfile() { try { localStorage.setItem(LS.profile, JSON.stringify(profile)); } catch {} }

  // A-levels -> approximate SAT-equivalent (rough concordance; US admissions weigh far more)
  const AL_POINTS = { "A*": 5, "A": 4, "B": 3, "C": 2, "D": 1, "E": 0 };
  const AL_SUM_TO_SAT = { 15: 1550, 14: 1520, 13: 1490, 12: 1450, 11: 1400, 10: 1350, 9: 1290, 8: 1230, 7: 1170, 6: 1110, 5: 1050, 4: 1000, 3: 960, 2: 920, 1: 880, 0: 850 };
  function aLevelSAT() {
    const g = (profile.aLevels || []).filter(x => x in AL_POINTS);
    if (g.length < 3) return null;
    const top3 = g.map(x => AL_POINTS[x]).sort((a, b) => b - a).slice(0, 3);
    return AL_SUM_TO_SAT[top3.reduce((a, b) => a + b, 0)] ?? null;
  }
  function testSAT() {
    const t = [];
    if (profile.sat) t.push(profile.sat);
    if (profile.act && ACT_TO_SAT[Math.round(profile.act)]) t.push(ACT_TO_SAT[Math.round(profile.act)]);
    return t.length ? Math.max(...t) : null;   // best of SAT / ACT
  }
  // Combine a test score with predicted A-levels into one academic level,
  // leaning toward the stronger of the two (so a mid score isn't the whole story).
  function profileEquiv() {
    const parts = [];
    const t = testSAT();
    if (t != null) parts.push({ label: profile.sat ? "SAT" : "ACT", v: t });
    const al = aLevelSAT();
    if (al != null) parts.push({ label: "A-levels", v: al });
    if (!parts.length) return { value: null, parts };
    if (parts.length === 1) return { value: parts[0].v, parts };
    const mean = (parts[0].v + parts[1].v) / 2, max = Math.max(parts[0].v, parts[1].v);
    return { value: Math.round((mean + max) / 2), parts };   // blend, weighted to strongest
  }
  const userSAT = () => profileEquiv().value;
  const hasProfile = () => userSAT() != null;

  // Returns 'safety' | 'target' | 'reach' | 'open' | null
  function classify(c) {
    const u = userSAT();
    if (u == null) return null;
    const adm = c.admitRate;
    // Effective admitted-SAT range: use the real 25th/75th percentiles, or
    // derive a spread from the average SAT so a strong score always counts.
    let s25 = c.sat25, s75 = c.sat75;
    if ((!s25 || !s75) && c.satAvg) { s25 = c.satAvg - 90; s75 = c.satAvg + 90; }

    // Truly hyper-selective (<8% admit): holistic and hard for everyone, even
    // top scorers — only a target if you're at/above the 75th percentile.
    if (adm != null && adm < 8) return (s75 && u >= s75) ? "target" : "reach";

    if (s25 && s75) {
      let band = u < s25 - 20 ? "reach" : u > s75 + 10 ? "safety" : "target";
      if (adm != null) {
        if (adm < 20) {                                   // selective: temper upward
          if (band === "safety") band = "target";
          else if (band === "target" && u < s75) band = "reach";
        } else if (adm >= 65 && band === "target" && u >= s25) {
          band = "safety";                                // easy admit + in range
        }
      }
      return band;
    }

    // No SAT signal at all — fall back to acceptance rate only.
    if (adm != null) return adm >= 55 ? "safety" : adm >= 25 ? "target" : "reach";
    return "open"; // open-admission / no selective process
  }
  const CH_LABEL = { safety: "Safety", target: "Target", reach: "Reach", open: "Open admission" };
  function chanceChip(c) {
    const k = classify(c);
    if (!k) return "";
    return `<span class="chance-chip ${k}">${k === "open" ? "🎓" : k === "safety" ? "🟢" : k === "target" ? "🎯" : "🌙"} ${CH_LABEL[k]}</span>`;
  }

  const REGIONS = ["Northeast", "Midwest", "South", "West", "Territories"];
  const DEGREES = [["4-year", "🎓 4-year"], ["2-year", "🏫 2-year / community"], ["Graduate", "📚 Grad-focused"]];
  const CONTROLS = [["Public", "🏛️ Public"], ["Private nonprofit", "🌿 Private nonprofit"], ["For-profit", "💼 For-profit"]];
  const SIZES = ["Very small (<1k)", "Small (1k–3k)", "Medium (3k–10k)", "Large (10k–20k)", "Very large (20k+)"];
  const SETTINGS = [["City", "🏙️ City"], ["Suburb", "🏡 Suburb"], ["Town", "🏘️ Town"], ["Rural", "🌾 Rural"]];
  const SELECTIVITY = ["Most selective", "Highly selective", "Selective", "Less selective", "Test-optional / Open"];
  const VIBES = [
    ["residential", "🏘️ Residential campus"],
    ["highRetention", "😊 High satisfaction (90%+ return)"],
    ["diverse", "🌍 Very diverse"],
    ["outcomes", "📈 Strong grad outcomes"],
    ["bigsports", "🏟️ Big-school energy (15k+)"],
    ["intimate", "🤝 Small & close-knit (<3k)"],
  ];
  const MISSIONS = [
    ["hbcu", "HBCU"], ["hsi", "Hispanic-serving"], ["tribal", "Tribal college"],
    ["womenOnly", "Women's college"], ["menOnly", "Men's college"], ["religious", "Religiously affiliated"],
  ];

  const DEFAULTS = {
    region: [], state: [], degree: ["4-year"], control: ["Public", "Private nonprofit"],
    sizeCategory: [], setting: [], selectivity: [], field: [], vibe: [], mission: [],
    maxCost: 60000, name: "", sort: "score",
  };
  let filters = loadFilters();

  fetch("data/colleges.json").then(r => r.json()).then(data => {
    ALL = data; data.forEach(c => BYID[c.id] = c);
    buildFilterUI(); buildProfileUI(); buildCompareUI(); wire(); updateMatchCount(); updateSavedPill(); show("filters");
  }).catch(() => {
    document.getElementById("view-filters").innerHTML =
      '<div class="panel" style="padding:24px;text-align:center">Could not load college data. Serve the folder over HTTP (e.g. <code>python3 -m http.server</code>) rather than opening the file directly.</div>';
  });

  // ---------- persistence ----------
  function loadSet(k) { try { return new Set(JSON.parse(localStorage.getItem(k) || "[]")); } catch { return new Set(); } }
  function saveSet(k, s) { try { localStorage.setItem(k, JSON.stringify([...s])); } catch {} }
  function loadFilters() { try { const f = JSON.parse(localStorage.getItem(LS.filters)); return f ? { ...DEFAULTS, ...f } : { ...DEFAULTS }; } catch { return { ...DEFAULTS }; } }
  function saveFilters() { try { localStorage.setItem(LS.filters, JSON.stringify(filters)); } catch {} }

  // ---------- filter UI ----------
  function chip(name, value, label) {
    const on = (filters[name] || []).includes(value);
    const el = document.createElement("label");
    el.className = "chip" + (on ? " on" : "");
    el.innerHTML = `<input type="checkbox" ${on ? "checked" : ""}><span>${label}</span>`;
    el.querySelector("input").addEventListener("change", e => {
      const set = new Set(filters[name] || []);
      e.target.checked ? set.add(value) : set.delete(value);
      filters[name] = [...set];
      el.classList.toggle("on", e.target.checked);
      saveFilters(); updateMatchCount();
    });
    return el;
  }
  function fillChips(name, items) {
    const box = document.querySelector(`.chips[data-name="${name}"]`);
    box.innerHTML = ""; items.forEach(([v, l]) => box.appendChild(chip(name, v, l)));
  }

  function buildFilterUI() {
    fillChips("region", REGIONS.map(r => [r, r]));
    fillChips("degree", DEGREES);
    fillChips("control", CONTROLS);
    fillChips("sizeCategory", SIZES.map(s => [s, s]));
    fillChips("setting", SETTINGS);
    fillChips("selectivity", SELECTIVITY.map(s => [s, s]));
    fillChips("vibe", VIBES);
    fillChips("mission", MISSIONS);
    fillChips("state", [...new Set(ALL.map(c => c.stateName))].sort().map(s => [s, s]));
    fillChips("field", [...new Set(ALL.flatMap(c => c.fields))].sort().map(m => [m, m]));

    document.querySelectorAll(".mini-search").forEach(inp => {
      const box = document.querySelector(`.chips[data-name="${inp.dataset.for}"]`);
      inp.addEventListener("input", () => {
        const q = inp.value.trim().toLowerCase();
        [...box.children].forEach(ch => ch.style.display = ch.textContent.toLowerCase().includes(q) ? "" : "none");
      });
    });

    const range = document.getElementById("costRange");
    range.value = filters.maxCost; updateCostLabel();
    range.addEventListener("input", () => { filters.maxCost = +range.value; updateCostLabel(); saveFilters(); updateMatchCount(); });

    const nameS = document.getElementById("nameSearch");
    nameS.value = filters.name || "";
    nameS.addEventListener("input", () => { filters.name = nameS.value; saveFilters(); updateMatchCount(); });

    const sortS = document.getElementById("sortBy");
    sortS.value = filters.sort || "score";
    sortS.addEventListener("change", () => { filters.sort = sortS.value; saveFilters(); });
  }
  function buildProfileUI() {
    const sat = document.getElementById("pSat"), act = document.getElementById("pAct"), gpa = document.getElementById("pGpa");
    const als = [document.getElementById("pA1"), document.getElementById("pA2"), document.getElementById("pA3")];
    sat.value = profile.sat || ""; act.value = profile.act || ""; gpa.value = profile.gpa || "";
    const opts = ['<option value="">—</option>'].concat(["A*", "A", "B", "C", "D", "E"].map(g => `<option value="${g}">${g}</option>`)).join("");
    als.forEach((sel, i) => { sel.innerHTML = opts; sel.value = (profile.aLevels || [])[i] || ""; });
    const onChange = () => {
      profile.sat = sat.value ? Math.max(400, Math.min(1600, +sat.value)) : null;
      profile.act = act.value ? Math.max(1, Math.min(36, +act.value)) : null;
      profile.gpa = gpa.value ? Math.max(0, Math.min(4, +gpa.value)) : null;
      profile.aLevels = als.map(s => s.value).filter(Boolean);
      saveProfile(); updateProfileNote();
    };
    [sat, act, gpa, ...als].forEach(el => el.addEventListener("input", onChange));
    document.getElementById("clearProfile").addEventListener("click", () => {
      profile = { sat: null, act: null, gpa: null, aLevels: [] }; saveProfile();
      sat.value = act.value = gpa.value = ""; als.forEach(s => s.value = ""); updateProfileNote();
    });
    updateProfileNote();
  }
  function updateProfileNote() {
    const { value, parts } = profileEquiv(), note = document.getElementById("profileNote");
    if (value == null) { note.textContent = "Add an SAT, ACT, or predicted A-levels to see which schools are a Safety, Target, or Reach for you."; return; }
    if (parts.length === 1) {
      const approx = parts[0].label === "SAT" ? "" : " (approx)";
      note.textContent = `Using an SAT-equivalent of ${value}${approx} from your ${parts[0].label}. Safety / Target / Reach labels now show on every school.`;
    } else {
      note.textContent = `Blending your ${parts[0].label} (${parts[0].v}) and ${parts[1].label} (≈${parts[1].v}) into an academic level of ${value}, leaning toward your strongest — so a mid score isn't the whole story. Labels now show on every school.`;
    }
  }

  function updateCostLabel() {
    const v = +document.getElementById("costRange").value;
    document.getElementById("costLabel").textContent = v >= 60000 ? "no limit" : "up to $" + v.toLocaleString() + "/yr";
  }

  // ---------- vibe helpers ----------
  const residentialScore = c => {
    if (c.partTimePct == null && c.adultPct == null) return null;
    const pt = c.partTimePct ?? 0, ad = c.adultPct ?? 0;
    return Math.max(0, Math.round(100 - pt * 0.7 - ad * 0.8));
  };
  const academicScore = c => c.satAvg != null ? Math.max(0, Math.min(100, Math.round((c.satAvg - 800) / 6))) : null;
  const scaleScore = c => c.size != null ? Math.min(100, Math.round(Math.log10(c.size + 1) / Math.log10(60000) * 100)) : null;
  const socialScore = c => {
    const s = scaleScore(c), r = residentialScore(c);
    if (s == null && r == null) return null;
    if (s == null) return r; if (r == null) return s;
    return Math.round(s * 0.55 + r * 0.45);
  };
  const clamp = n => Math.max(0, Math.min(100, Math.round(n)));
  // Estimated Greek-life presence. Not in federal data; built from the signal that
  // actually tracks it — residential/traditional campus, 4-year, secular, larger.
  const greekEst = c => {
    const r = residentialScore(c);
    if (r == null) return null;
    let s = r * 0.7;
    s += c.degree === "4-year" ? 12 : -22;
    s += c.flags.religious ? -16 : 8;          // many religious schools restrict Greek life
    if (c.size != null) s += c.size >= 8000 ? 12 : c.size >= 2000 ? 6 : c.size < 800 ? -8 : 0;
    if (c.control === "For-profit") s -= 25;
    return clamp(s);
  };
  // Estimated party scene. Same caveat — a rough proxy, not a student poll.
  const partyEst = c => {
    const r = residentialScore(c);
    if (r == null) return null;
    let s = r * 0.75;
    s += c.degree === "4-year" ? 8 : -24;
    s += c.flags.religious ? -16 : 6;
    if (c.size != null) s += c.size >= 10000 ? 10 : c.size < 1000 ? -6 : 0;
    const a = academicScore(c);
    if (a != null && a >= 92) s -= 6;          // heavy grind culture tempers the party rep a bit
    if (c.control === "For-profit") s -= 25;
    return clamp(s);
  };

  // ---------- matching ----------
  function passes(c) {
    const f = filters;
    if (f.name && !c.name.toLowerCase().includes(f.name.trim().toLowerCase())) return false;
    if (f.region.length && !f.region.includes(c.region)) return false;
    if (f.state.length && !f.state.includes(c.stateName)) return false;
    if (f.degree.length && !f.degree.includes(c.degree)) return false;
    if (f.control.length && !f.control.includes(c.control)) return false;
    if (f.sizeCategory.length && !f.sizeCategory.includes(c.sizeCategory)) return false;
    if (f.setting.length && !f.setting.includes(c.setting)) return false;
    if (f.selectivity.length && !f.selectivity.includes(c.selectivity)) return false;
    if (f.field.length && !c.fields.some(m => f.field.includes(m))) return false;
    if (f.mission.length && !f.mission.some(m => c.flags[m])) return false;
    if (f.maxCost < 60000 && c.netPrice != null && c.netPrice > f.maxCost) return false;
    for (const v of f.vibe) {
      if (v === "residential" && !((residentialScore(c) ?? 0) >= 70)) return false;
      if (v === "highRetention" && !(c.retention != null && c.retention >= 90)) return false;
      if (v === "diverse" && !(c.diversity != null && c.diversity >= 80)) return false;
      if (v === "outcomes" && !(c.gradRate != null && c.gradRate >= 65)) return false;
      if (v === "bigsports" && !(c.size != null && c.size >= 15000)) return false;
      if (v === "intimate" && !(c.size != null && c.size < 3000)) return false;
    }
    return true;
  }

  function sortMatches(list) {
    const s = filters.sort;
    const by = {
      name: (a, b) => a.name.localeCompare(b.name),
      selective: (a, b) => (b.satAvg || 0) - (a.satAvg || 0),
      retention: (a, b) => (b.retention || 0) - (a.retention || 0),
      grad: (a, b) => (b.gradRate || 0) - (a.gradRate || 0),
      size_desc: (a, b) => (b.size || 0) - (a.size || 0),
      size_asc: (a, b) => (a.size || 1e9) - (b.size || 1e9),
      cost_asc: (a, b) => (a.netPrice ?? 1e9) - (b.netPrice ?? 1e9),
      score: (a, b) => b._score - a._score,
    }[s] || ((a, b) => b._score - a._score);
    return list.sort(by);
  }

  function updateMatchCount() {
    const n = ALL.filter(passes).length;
    document.getElementById("matchCount").textContent = n.toLocaleString();
    const hint = document.getElementById("matchHint");
    if (n === 0) { hint.hidden = false; hint.textContent = "No schools match. Your filters combine with AND — try removing a few, especially Campus-vibe or Selectivity ones (those also drop schools that don't report that stat)."; }
    else if (n < 25) { hint.hidden = false; hint.textContent = `Only ${n} match. Filters stack (a school must pass every one), and Campus-vibe/Selectivity filters exclude schools with unreported data. Loosen a filter to see more.`; }
    else hint.hidden = true;
  }

  // ---------- photos (Wikipedia, client-side, cached) ----------
  function setPhoto(c, imgEl, fallbackEl) {
    const cached = localStorage.getItem(LS.photo + c.id);
    if (cached === "none") return; // keep fallback
    if (cached) { showImg(imgEl, fallbackEl, cached); return; }
    const q = encodeURIComponent(c.name + " " + c.stateName);
    const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=900&generator=search&gsrsearch=${q}&gsrlimit=1`;
    fetch(url).then(r => r.json()).then(d => {
      const pages = d && d.query && d.query.pages;
      let src = null;
      if (pages) for (const k in pages) if (pages[k].thumbnail) src = pages[k].thumbnail.source;
      try { localStorage.setItem(LS.photo + c.id, src || "none"); } catch {}
      if (src) showImg(imgEl, fallbackEl, src);
    }).catch(() => {});
  }
  function showImg(imgEl, fallbackEl, src) {
    imgEl.onload = () => { imgEl.style.display = "block"; if (fallbackEl) fallbackEl.style.display = "none"; };
    imgEl.src = src;
  }
  function hueFor(name) { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360; return h; }

  // ---------- summary & card ----------
  const fmt = n => n == null ? null : n.toLocaleString();
  const joinL = a => a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];

  function summarize(c) {
    const sizeW = c.size == null ? "" : c.size >= 20000 ? "large " : c.size < 3000 ? "small " : "mid-sized ";
    const type = c.control === "Public" ? "public" : c.control === "For-profit" ? "for-profit" : "private";
    const deg = c.degree === "2-year" ? "2-year college" : "university";
    let s = `${c.name} is a ${sizeW}${type} ${deg} in ${c.city}, ${c.stateName}.`;
    const bits = [];
    if (c.size != null) bits.push(`about ${fmt(c.size)} undergraduates`);
    if (c.netPrice != null) bits.push(`an average net cost near $${fmt(c.netPrice)}/yr`);
    if (c.retention != null) bits.push(`${c.retention}% of freshmen return for year two`);
    if (bits.length) s += " It has " + joinL(bits) + ".";
    if (c.majors.length) s += " Students most often study " + joinL(c.majors.slice(0, 3)) + ".";
    return s;
  }
  function missionBadges(c) {
    const m = [];
    if (c.flags.hbcu) m.push("HBCU"); if (c.flags.hsi) m.push("Hispanic-serving");
    if (c.flags.tribal) m.push("Tribal college"); if (c.flags.womenOnly) m.push("Women's college");
    if (c.flags.menOnly) m.push("Men's college"); if (c.flags.religious) m.push("Religiously affiliated");
    return m;
  }
  function metricRow(label, val, cap, cls) {
    if (val == null) {
      return `<div class="metric"><div class="lab"><span>${label}</span><span class="val muted-val">Not reported</span></div>
        <div class="bar empty"><span style="width:0%"></span></div></div>`;
    }
    return `<div class="metric"><div class="lab"><span>${label}</span><span class="val">${val}%</span></div>
      <div class="bar ${cls || ""}"><span style="width:${Math.max(3, Math.min(100, val))}%"></span></div>
      ${cap ? `<div class="cap">${cap}</div>` : ""}</div>`;
  }

  function cardEl(c, isTop) {
    const el = document.createElement("article");
    el.className = "card" + (isTop ? " top" : "");
    let qs = [];
    if (c.size != null) qs.push(["Undergrads", fmt(c.size)]);
    if (c.admitRate != null) qs.push(["Acceptance", c.admitRate + "%"]);
    if (c.netPrice != null) qs.push(["Avg net price", "$" + fmt(c.netPrice) + "/yr"]);
    if (c.gradRate != null) qs.push(["Grad rate", c.gradRate + "%"]);
    if (qs.length < 4) qs.push(["Selectivity", c.selectivity.replace(" / ", "/")]);
    qs = qs.slice(0, 4);

    const chChip = chanceChip(c);
    const badges = [
      chChip,
      `<span class="badge">${c.control}</span>`, `<span class="badge">${c.degree}</span>`,
      c.setting ? `<span class="badge">${c.setting}</span>` : "",
      c.sizeCategory ? `<span class="badge">${c.sizeCategory}</span>` : "",
      ...missionBadges(c).map(m => `<span class="badge mission">${m}</span>`),
    ].join("");

    // feel metrics (main view) — estimated from official stats
    const feel = [
      metricRow("Social scene", socialScore(c), "Bigger + more residential = livelier", ""),
      metricRow("Greek life", greekEst(c), "Rough estimate — federal data has none; see reviews below", "warm"),
      metricRow("Party scene", partyEst(c), "Rough estimate from how residential the campus is", "warm"),
      metricRow("Student happiness", c.retention, "Freshman return rate — a proxy for how much students like it", "good"),
      metricRow("Academic pressure", academicScore(c), c.satAvg ? `Avg SAT ~${fmt(c.satAvg)}` : "", "warm"),
      metricRow("Campus scale", scaleScore(c), c.size ? `${fmt(c.size)} undergrads` : "", ""),
      metricRow("Diversity", c.diversity, "Racial/ethnic mix of the student body", ""),
    ].join("");

    const initials = c.name.replace(/^(The|University|College)\s+/i, "").split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
    const hue = hueFor(c.name);

    // details
    const divRows = (c.diversityBreakdown || []).map(b =>
      `<div class="diversity-row"><span class="g">${b.g}</span><span class="bar"><span style="width:${b.p}%"></span></span><span class="p">${b.p}%</span></div>`).join("");
    const kv = [];
    if (c.earnings != null) kv.push(["Median pay (10 yrs after entry)", "$" + fmt(c.earnings)]);
    if (c.retention != null) kv.push(["Freshman retention", c.retention + "%"]);
    if (c.gradRate != null) kv.push(["Graduation rate", c.gradRate + "%"]);
    if (c.pell != null) kv.push(["On Pell Grant (lower-income)", c.pell + "%"]);
    if (c.adultPct != null) kv.push(["Students over 25", c.adultPct + "%"]);
    if (c.partTimePct != null) kv.push(["Part-time students", c.partTimePct + "%"]);
    const resScore = residentialScore(c);

    // admissions & chances
    const cat = classify(c), u = userSAT();
    const admKv = [];
    admKv.push(["Overall acceptance rate", c.admitRate != null ? c.admitRate + "%" : "Open / not reported"]);
    if (c.sat25 && c.sat75) admKv.push(["Admitted SAT (middle 50%)", c.sat25 + "–" + c.sat75]);
    if (c.satAvg) admKv.push(["Average SAT", fmt(c.satAvg)]);
    let chanceLine;
    if (u == null) {
      chanceLine = `<p class="note">Add your SAT or ACT under <b>Filters → Your stats</b> to see whether this is a Safety, Target, or Reach for you.</p>`;
    } else {
      const why = {
        safety: "Your scores are at or above this school's admitted range and it admits most applicants.",
        target: "Your scores land within this school's admitted range — a realistic match.",
        reach: "This school is more selective than your current scores suggest, so it's a stretch.",
        open: "This school has open admission — essentially everyone who applies is admitted.",
      }[cat] || "";
      chanceLine = `<p class="note">For your SAT-equivalent of <b>${u}</b>: ${chanceChip(c)} — ${why}</p>`;
    }
    const admHtml = `<h3>Admissions &amp; your chances</h3>
      <div class="kv">${admKv.map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join("")}</div>
      ${chanceLine}
      <p class="note">Per-major acceptance rates aren't published in the federal data, so this is the
        <b>overall</b> rate. Some schools admit separately into competitive majors (e.g. engineering,
        nursing, business) — check the school's site for those. ${c.majors.length ? `Your subject areas here include ${esc(c.majors.slice(0, 3).join(", "))}.` : ""}</p>`;

    const nicheSlug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const links = [
      c.url ? `<a href="${encodeURI(c.url)}" target="_blank" rel="noopener">Official site ↗</a>` : "",
      `<a href="https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(c.name)}" target="_blank" rel="noopener">Wikipedia ↗</a>`,
      `<a href="https://www.niche.com/colleges/search/best-colleges/?q=${encodeURIComponent(c.name)}" target="_blank" rel="noopener">Student reviews — Greek life, parties &amp; happiness ↗</a>`,
      `<a href="https://www.google.com/maps/search/${encodeURIComponent(c.name + " " + c.city + " " + c.state)}" target="_blank" rel="noopener">Map ↗</a>`,
    ].join("");

    el.innerHTML = `
      <div class="stamp like">Save</div><div class="stamp nope">Pass</div>
      <div class="drag-handle" style="background:linear-gradient(135deg,hsl(${hue} 55% 52%),hsl(${(hue + 45) % 360} 60% 42%))">
        <div class="grip"></div>
        <div class="photo-fallback">${initials || "🎓"}</div>
        <img class="photo" alt="" style="display:none" />
        <div class="photo-grad"></div>
        <div class="photo-title"><h2>${esc(c.name)}</h2><div class="loc">📍 ${esc(c.city)}, ${c.state} · ${c.region}</div></div>
      </div>
      <div class="body">
        <div class="badges">${badges}</div>
        <div class="quickstats">${qs.map(([k, v]) => `<div class="qs"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("")}</div>
        <p class="summary">${esc(summarize(c))}</p>
        <div class="metrics-head">Campus vibe <span class="est-tag" title="Estimated from official statistics (size, retention, selectivity, diversity, how residential the campus is) — not student opinion polls.">estimated</span></div>
        <div class="metrics">${feel}</div>
        <button type="button" class="readmore-btn">Read more ▾</button>
        <div class="details hidden">
          ${admHtml}
          <h3>Campus feel</h3>
          <div class="metrics">
            ${metricRow("Residential vibe", resScore, resScore != null ? "Higher = more full-time, live-on-campus students" : "", "raw2")}
            ${metricRow("Affordability", c.netPrice != null ? Math.max(0, Math.round(100 - c.netPrice / 500)) : null, c.netPrice != null ? `$${fmt(c.netPrice)}/yr average net price` : "", "good")}
          </div>
          <p class="note">All “campus vibe” bars are <b>estimates</b> from official stats (size, how
            residential the campus is, retention, selectivity, diversity) — not student surveys. Greek
            life and party scene especially are rough proxies. For ratings students actually give, use the
            <b>Student reviews</b> link below.</p>
          ${kv.length ? `<h3>By the numbers</h3><div class="kv">${kv.map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join("")}</div>` : ""}
          ${divRows ? `<h3>Student body</h3>${divRows}` : ""}
          <h3>Fields offered here</h3>
          <div class="chiplist">${c.fields.map(m => `<span>${esc(m)}</span>`).join("") || "<span>Not reported</span>"}</div>
          <h3>Explore &amp; verify</h3>
          <div class="links">${links}</div>
          <button type="button" class="cmp-add" data-id="${c.id}" style="margin-top:10px">⇄ Add to compare</button>
        </div>
      </div>`;

    const rm = el.querySelector(".readmore-btn"), det = el.querySelector(".details");
    rm.addEventListener("click", e => {
      e.stopPropagation();
      const hidden = det.classList.toggle("hidden");
      rm.textContent = hidden ? "Read more ▾" : "Show less ▴";
      if (!hidden) det.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    const cmpBtn = el.querySelector(".cmp-add");
    if (cmpBtn) cmpBtn.addEventListener("click", e => { e.stopPropagation(); addToCompare(c.id); });

    if (isTop) enableDrag(el);
    setPhoto(c, el.querySelector(".photo"), el.querySelector(".photo-fallback"));
    return el;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }

  // ---------- deck ----------
  function startDeck() {
    matches = sortMatches(ALL.filter(c => passes(c) && !state.saved.has(c.id) && !state.passed.has(c.id)));
    idx = 0; lastAction = null;
    document.getElementById("undoBtn").disabled = true;
    render();
  }
  function render() {
    const deck = document.getElementById("deck"), empty = document.getElementById("deckEmpty"), ctrl = document.getElementById("deckControls");
    deck.innerHTML = "";
    document.getElementById("deckTotal").textContent = matches.length;
    document.getElementById("deckPos").textContent = Math.min(idx + 1, matches.length);
    if (idx >= matches.length) {
      deck.hidden = true; ctrl.style.visibility = "hidden"; empty.hidden = false;
      document.getElementById("reviewPassed").hidden = state.passed.size === 0;
      document.getElementById("emptyMsg").textContent = matches.length === 0
        ? "No schools matched your filters. Try widening them."
        : `You reviewed ${matches.length} matching ${matches.length === 1 ? "school" : "schools"}. ${state.saved.size} saved to your shortlist.`;
      return;
    }
    deck.hidden = false; ctrl.style.visibility = "visible"; empty.hidden = true;
    const upto = Math.min(idx + 3, matches.length);
    for (let i = upto - 1; i >= idx; i--) {
      const depth = i - idx, el = cardEl(matches[i], depth === 0);
      el.style.transform = `translateY(${depth * 9}px) scale(${1 - depth * 0.035})`;
      el.style.zIndex = String(100 - depth); el.dataset.depth = depth;
      deck.appendChild(el);
    }
  }
  const topCard = () => document.querySelector('.card[data-depth="0"]');

  function decide(verdict) {
    if (idx >= matches.length) return;
    const c = matches[idx];
    if (verdict === "save") { state.saved.add(c.id); state.passed.delete(c.id); }
    else { state.passed.add(c.id); state.saved.delete(c.id); }
    saveSet(LS.saved, state.saved); saveSet(LS.passed, state.passed);
    lastAction = { id: c.id }; document.getElementById("undoBtn").disabled = false;
    updateSavedPill(); idx++; render();
  }
  function flyOut(dir) {
    const card = topCard();
    if (!card) return decide(dir > 0 ? "save" : "pass");
    card.style.transition = "transform .32s ease, opacity .32s ease";
    card.style.transform = `translate(${dir * 620}px, -30px) rotate(${dir * 20}deg)`;
    card.style.opacity = "0";
    const st = card.querySelector(dir > 0 ? ".stamp.like" : ".stamp.nope"); if (st) st.style.opacity = "1";
    setTimeout(() => decide(dir > 0 ? "save" : "pass"), 200);
  }
  function undo() {
    if (!lastAction) return;
    state.saved.delete(lastAction.id); state.passed.delete(lastAction.id);
    saveSet(LS.saved, state.saved); saveSet(LS.passed, state.passed);
    idx = Math.max(0, idx - 1); lastAction = null;
    document.getElementById("undoBtn").disabled = true; updateSavedPill(); render(); toast("Undone");
  }

  // ---------- drag with horizontal-intent lock (so scrolling text doesn't move the card) ----------
  function enableDrag(card) {
    let sx = 0, sy = 0, dx = 0, axis = null, dragging = false;
    const like = card.querySelector(".stamp.like"), nope = card.querySelector(".stamp.nope");
    const handle = card.querySelector(".drag-handle");

    const start = e => {
      dragging = true; axis = null; dx = 0;
      const p = pt(e); sx = p.x; sy = p.y; card.style.transition = "none";
    };
    const move = e => {
      if (!dragging) return;
      const p = pt(e), mx = p.x - sx, my = p.y - sy;
      if (!axis) {
        if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) axis = "x";
        else if (Math.abs(my) > 8) { axis = "y"; dragging = false; return; } // let it scroll
        else return;
      }
      if (axis !== "x") return;
      if (e.cancelable) e.preventDefault();
      dx = mx;
      card.style.transform = `translate(${dx}px, ${my * 0.25}px) rotate(${dx / 20}deg)`;
      const r = Math.min(Math.abs(dx) / 120, 1);
      if (dx > 0) { like.style.opacity = r; nope.style.opacity = 0; } else { nope.style.opacity = r; like.style.opacity = 0; }
    };
    const end = () => {
      if (!dragging && axis !== "x") { reset(); return; }
      dragging = false;
      card.style.transition = "transform .3s ease";
      if (axis === "x" && dx > 110) return flyOut(1);
      if (axis === "x" && dx < -110) return flyOut(-1);
      reset();
    };
    const reset = () => { card.style.transform = "translateY(0) scale(1)"; like.style.opacity = 0; nope.style.opacity = 0; dx = 0; axis = null; };

    // Drag can start on the photo handle (nice big grab area) OR anywhere,
    // but the intent lock means vertical gestures scroll the body instead.
    card.addEventListener("pointerdown", start);
    card.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    card.addEventListener("pointercancel", end);
    handle.addEventListener("dragstart", e => e.preventDefault());
  }
  const pt = e => e.touches && e.touches[0] ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY };

  // ---------- shortlist ----------
  function savedCardEl(c) {
    const el = document.createElement("div");
    el.className = "saved-card";
    el.innerHTML = `
      <div class="thumb" style="background:linear-gradient(135deg,hsl(${hueFor(c.name)} 55% 52%),hsl(${(hueFor(c.name) + 45) % 360} 60% 42%))"><img alt="" style="display:none"></div>
      <div class="sc-body">
        <h3>${esc(c.name)}</h3>
        <div class="loc">📍 ${esc(c.city)}, ${c.state} · ${c.control} · ${c.degree}</div>
        <div class="row">
          ${chanceChip(c)}
          ${c.admitRate != null ? `<span class="badge">${c.admitRate}% admit</span>` : ""}
          ${c.netPrice != null ? `<span class="badge">$${fmt(c.netPrice)}/yr</span>` : ""}
          ${c.gradRate != null ? `<span class="badge">${c.gradRate}% grad</span>` : ""}
        </div>
        <div class="foot">
          <button class="cmp-add" data-id="${c.id}">⇄ Compare</button>
          <button class="remove" data-id="${c.id}">Remove</button>
        </div>
      </div>`;
    el.querySelector(".remove").addEventListener("click", () => {
      state.saved.delete(c.id); saveSet(LS.saved, state.saved); updateSavedPill(); renderList();
    });
    el.querySelector(".cmp-add").addEventListener("click", () => addToCompare(c.id));
    setPhoto(c, el.querySelector("img"), null);
    return el;
  }

  function renderList() {
    const wrap = document.getElementById("savedList"), empty = document.getElementById("savedEmpty");
    const saved = ALL.filter(c => state.saved.has(c.id));
    document.getElementById("listSummary").textContent = `${saved.length} saved · ${state.passed.size} passed`;
    empty.style.display = saved.length ? "none" : "";
    wrap.innerHTML = "";

    if (hasProfile() && saved.length) {
      const groups = [
        ["safety", "🟢 Safety schools"], ["target", "🎯 Target schools"],
        ["reach", "🌙 Reach schools"], ["open", "🎓 Open admission"], [null, "❔ Not assessed"],
      ];
      groups.forEach(([key, title]) => {
        const inGroup = saved.filter(c => (classify(c) || null) === key);
        if (!inGroup.length) return;
        const h = document.createElement("div");
        h.className = "group-h";
        h.innerHTML = `<h2>${title}</h2><span class="count">${inGroup.length}</span>`;
        h.style.gridColumn = "1 / -1";
        wrap.appendChild(h);
        inGroup.forEach(c => wrap.appendChild(savedCardEl(c)));
      });
    } else {
      saved.forEach(c => wrap.appendChild(savedCardEl(c)));
    }
  }

  // ---------- compare ----------
  function addToCompare(id) {
    if (compare.a === id || compare.b === id) { toast("Already in compare"); show("compare"); return; }
    if (!compare.a) compare.a = id;
    else compare.b = id;
    show("compare");
    toast(compare.a && compare.b ? "Comparing two schools" : "Pick one more to compare");
  }
  function cmpRow(label, av, bv, better) {
    // better: 'hi' | 'lo' | null — which raw value wins (for subtle highlight)
    let ac = "", bc = "";
    if (better && av.raw != null && bv.raw != null && av.raw !== bv.raw) {
      const aWins = better === "hi" ? av.raw > bv.raw : av.raw < bv.raw;
      if (aWins) ac = "better"; else bc = "better";
    }
    return `<tr><th>${label}</th><td class="${ac}">${av.txt}</td><td class="${bc}">${bv.txt}</td></tr>`;
  }
  const V = (raw, txt) => ({ raw, txt: txt != null ? txt : (raw != null ? raw : "—") });

  function renderCompare() {
    const box = document.getElementById("compareTable"), empty = document.getElementById("compareEmpty");
    document.querySelectorAll(".cmp-search").forEach(inp => { const c = BYID[compare[inp.dataset.slot]]; if (c && document.activeElement !== inp) inp.value = c.name; });
    const a = BYID[compare.a], b = BYID[compare.b];
    if (!a || !b) { box.innerHTML = ""; empty.style.display = ""; return; }
    empty.style.display = "none";
    const th = c => `<div class="thumb" style="background:linear-gradient(135deg,hsl(${hueFor(c.name)} 55% 52%),hsl(${(hueFor(c.name)+45)%360} 60% 42%));${photoBg(c)}"></div>${esc(c.name)}<div class="cmp-x-wrap"><button class="cmp-x" data-clear="a-or-b">✕ remove</button></div>`;
    const money = n => n == null ? null : "$" + fmt(n);
    const rows = [
      cmpRow("Location", V(0, `${esc(a.city)}, ${a.state}`), V(0, `${esc(b.city)}, ${b.state}`), null),
      cmpRow("Your chances", V(0, chanceChip(a) || "—"), V(0, chanceChip(b) || "—"), null),
      cmpRow("Acceptance rate", V(a.admitRate, a.admitRate != null ? a.admitRate + "%" : "Open/NA"), V(b.admitRate, b.admitRate != null ? b.admitRate + "%" : "Open/NA"), null),
      cmpRow("Admitted SAT (mid 50%)", V(a.sat75, a.sat25 && a.sat75 ? a.sat25 + "–" + a.sat75 : "—"), V(b.sat75, b.sat25 && b.sat75 ? b.sat25 + "–" + b.sat75 : "—"), null),
      cmpRow("Type", V(0, `${a.control} · ${a.degree}`), V(0, `${b.control} · ${b.degree}`), null),
      cmpRow("Undergrads", V(a.size, fmt(a.size)), V(b.size, fmt(b.size)), null),
      cmpRow("Avg net price", V(a.netPrice, money(a.netPrice) ? money(a.netPrice) + "/yr" : "—"), V(b.netPrice, money(b.netPrice) ? money(b.netPrice) + "/yr" : "—"), "lo"),
      cmpRow("Graduation rate", V(a.gradRate, a.gradRate != null ? a.gradRate + "%" : "—"), V(b.gradRate, b.gradRate != null ? b.gradRate + "%" : "—"), "hi"),
      cmpRow("Freshman retention", V(a.retention, a.retention != null ? a.retention + "%" : "—"), V(b.retention, b.retention != null ? b.retention + "%" : "—"), "hi"),
      cmpRow("Median pay (10 yr)", V(a.earnings, money(a.earnings)), V(b.earnings, money(b.earnings)), "hi"),
      cmpRow("Diversity", V(a.diversity, a.diversity != null ? a.diversity + "/100" : "—"), V(b.diversity, b.diversity != null ? b.diversity + "/100" : "—"), "hi"),
      cmpRow("Setting", V(0, a.setting || "—"), V(0, b.setting || "—"), null),
      cmpRow("Top fields", V(0, a.majors.slice(0, 3).join(", ") || "—"), V(0, b.majors.slice(0, 3).join(", ") || "—"), null),
    ].join("");
    box.innerHTML = `<div style="overflow-x:auto"><table class="cmp-table">
      <thead><tr><th></th><th>${th(a)}</th><th>${th(b)}</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
    box.querySelectorAll("thead th").forEach((el, i) => {
      const x = el.querySelector(".cmp-x"); if (!x) return;
      x.addEventListener("click", () => { if (i === 1) compare.a = null; else compare.b = null; syncCmpInputs(); renderCompare(); });
    });
  }
  function photoBg(c) {
    const cached = localStorage.getItem(LS.photo + c.id);
    return cached && cached !== "none" ? `background-image:url('${cached}');background-size:cover;background-position:center;` : "";
  }
  function syncCmpInputs() {
    document.querySelectorAll(".cmp-search").forEach(inp => { const c = BYID[compare[inp.dataset.slot]]; inp.value = c ? c.name : ""; });
  }
  function buildCompareUI() {
    document.querySelectorAll(".cmp-search").forEach(inp => {
      const slot = inp.dataset.slot, results = document.querySelector(`.cmp-results[data-slot="${slot}"]`);
      const close = () => setTimeout(() => results.hidden = true, 150);
      inp.addEventListener("focus", () => { if (inp.value.trim()) inp.dispatchEvent(new Event("input")); });
      inp.addEventListener("blur", close);
      inp.addEventListener("input", () => {
        const q = inp.value.trim().toLowerCase();
        if (q.length < 2) { results.hidden = true; return; }
        const hits = ALL.filter(c => c.name.toLowerCase().includes(q)).slice(0, 12);
        results.innerHTML = hits.map(c => `<button type="button" data-id="${c.id}">${esc(c.name)} <small>${esc(c.city)}, ${c.state}</small></button>`).join("") || `<button disabled>No matches</button>`;
        results.hidden = false;
        results.querySelectorAll("button[data-id]").forEach(btn => btn.addEventListener("mousedown", e => {
          e.preventDefault(); compare[slot] = btn.dataset.id; inp.value = BYID[btn.dataset.id].name; results.hidden = true; renderCompare();
        }));
      });
    });
  }
  function copyList() {
    const saved = ALL.filter(c => state.saved.has(c.id));
    if (!saved.length) return toast("Nothing to copy yet");
    const text = "My college shortlist:\n" + saved.map((c, i) => `${i + 1}. ${c.name} — ${c.city}, ${c.state}${c.url ? " (" + c.url + ")" : ""}`).join("\n");
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast("Shortlist copied")).catch(() => toast("Copy not supported here"));
  }

  // ---------- nav ----------
  function show(view) {
    ["filters", "deck", "compare", "list"].forEach(v => document.getElementById("view-" + v).hidden = v !== view);
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.go === view));
    if (view === "deck") startDeck();
    if (view === "list") renderList();
    if (view === "compare") { syncCmpInputs(); renderCompare(); }
    window.scrollTo(0, 0);
  }
  function updateSavedPill() { document.getElementById("savedPill").textContent = state.saved.size; }
  let tT; function toast(m) { const t = document.getElementById("toast"); t.textContent = m; t.hidden = false; clearTimeout(tT); tT = setTimeout(() => t.hidden = true, 1800); }

  function wire() {
    document.getElementById("themeToggle").addEventListener("click", () => {
      const dark = !currentDark();
      localStorage.setItem("unimatch.theme", dark ? "dark" : "light");
      applyTheme(dark ? "dark" : "light");
    });
    document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => show(b.dataset.go)));
    document.getElementById("brandHome").addEventListener("click", () => show("filters"));
    document.getElementById("filterForm").addEventListener("submit", e => { e.preventDefault(); show("deck"); });
    document.getElementById("resetBtn").addEventListener("click", () => {
      filters = { ...DEFAULTS }; saveFilters(); buildFilterUI(); updateMatchCount(); toast("Filters reset");
    });
    document.getElementById("btnSave").addEventListener("click", () => flyOut(1));
    document.getElementById("btnPass").addEventListener("click", () => flyOut(-1));
    document.getElementById("btnInfo").addEventListener("click", () => { const c = topCard(); if (c) c.querySelector(".readmore-btn").click(); });
    document.getElementById("undoBtn").addEventListener("click", undo);
    document.getElementById("reviewPassed").addEventListener("click", () => { state.passed.clear(); saveSet(LS.passed, state.passed); startDeck(); toast("Passed schools are back"); });
    document.getElementById("copyList").addEventListener("click", copyList);
    document.getElementById("clearSaved").addEventListener("click", () => {
      if (state.saved.size && confirm("Clear your entire shortlist?")) { state.saved.clear(); saveSet(LS.saved, state.saved); updateSavedPill(); renderList(); toast("Shortlist cleared"); }
    });
    document.addEventListener("keydown", e => {
      if (document.getElementById("view-deck").hidden) return;
      if (e.target.matches("input, select, textarea")) return;
      if (e.key === "ArrowLeft") flyOut(-1);
      else if (e.key === "ArrowRight") flyOut(1);
      else if (e.key === "ArrowUp" || e.key === "i") document.getElementById("btnInfo").click();
      else if (e.key.toLowerCase() === "z" && (e.ctrlKey || e.metaKey)) undo();
    });
  }
})();
