// Logika dashboardu. Górna część jest czysta (bez DOM-u) i testowana w
// test/dashboard.test.ts; warstwa DOM-owa startuje na końcu pliku.

export const PROF = {
  1: "Wojownik",
  2: "Mag",
  3: "Paladyn",
  4: "Tropiciel",
  5: "Tancerz ostrzy",
  6: "Łowca",
};

// Paleta serii margometera (walidowana pod kontrast/CVD na ciemnym tle).
export const PROF_COLORS = {
  1: "#3987e5", // Wojownik — niebieski
  2: "#d55181", // Mag — magenta
  3: "#199e70", // Paladyn — akwamaryna
  4: "#c98500", // Tropiciel — żółty
  5: "#9085e9", // Tancerz ostrzy — fioletowy
  6: "#e66767", // Łowca — czerwony
};

export const ACTIVITY_LABELS = ["< 24h", "≤ 7 dni", "≤ 30 dni", "> 30 dni", "nigdy"];

/** Ranking pokazuje ~20655 dni dla kont, które nigdy nie były online. */
const NEVER_ONLINE_DAYS = 10_000;

// ── Dane snapshotu ──────────────────────────────────────────────────────────
//
// `<ts>.f.json` trzyma kolumnowo to, czego potrzebuje filtrowanie:
// level[] / profession[] / honor[] / days[]. Wiersz i ↔ ranga i+1.
// Nicki siedzą w osobnym `<ts>.n.json` — do filtrów są zbędne, a to 2/3 objętości.

export function activityBucket(days) {
  if (days === null || days === undefined) return 4;
  if (days === 0) return 0;
  if (days <= 7) return 1;
  if (days <= 30) return 2;
  return 3;
}

// ── Filtry ──────────────────────────────────────────────────────────────────

export function emptyFilters() {
  return {
    minLevel: -Infinity,
    maxLevel: Infinity,
    minHonor: -Infinity,
    maxHonor: Infinity,
    maxDays: Infinity,
    professions: new Set([1, 2, 3, 4, 5, 6]),
  };
}

function matches(data, i, f) {
  const level = data.level[i];
  if (!level || level < f.minLevel || level > f.maxLevel) return false;
  if (!f.professions.has(data.profession[i])) return false;

  const honor = data.honor[i];
  if (honor < f.minHonor || honor > f.maxHonor) return false;

  // „nigdy online” wypada przy każdym progu aktywności
  const days = data.days[i];
  if (f.maxDays !== Infinity && (days === null || days === undefined || days > f.maxDays)) return false;
  return true;
}

// ── Zliczanie ───────────────────────────────────────────────────────────────

/** Mapa poziom → [liczba dla profesji 1..6]. */
export function countByLevel(data, f) {
  const counts = new Map();
  for (let i = 0; i < data.count; i++) {
    if (!matches(data, i, f)) continue;

    const level = data.level[i];
    let bucket = counts.get(level);
    if (!bucket) {
      bucket = [0, 0, 0, 0, 0, 0];
      counts.set(level, bucket);
    }
    bucket[data.profession[i] - 1] += 1;
  }
  return counts;
}

export function countByActivity(data, f) {
  const buckets = [0, 0, 0, 0, 0];
  for (let i = 0; i < data.count; i++) {
    if (!matches(data, i, f)) continue;
    buckets[activityBucket(data.days[i])] += 1;
  }
  return buckets.map((count, bucket) => [bucket, count]);
}

export function totalsFromCounts(counts) {
  const perProfession = [0, 0, 0, 0, 0, 0];
  let total = 0;
  for (const row of counts.values()) {
    for (let p = 0; p < 6; p++) {
      perProfession[p] += row[p];
      total += row[p];
    }
  }
  return { total, perProfession };
}

// ── Formatowanie ────────────────────────────────────────────────────────────

export function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** „2026-04-17T15-24-07” → „17.04.2026 15:24” */
export function formatTimestamp(ts) {
  const m = ts.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}` : ts;
}

// ── Warstwa DOM ─────────────────────────────────────────────────────────────

function setupDashboard() {
  const el = (id) => {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Brak elementu #${id}`);
    return node;
  };

  let manifest = null;
  let data = null; // zawartość `<ts>.f.json` — komplet potrzebny do filtrowania
  let chart = null;
  let loadToken = 0; // odcina odpowiedzi porzuconych, wolniejszych żądań
  let renderTimer = null;

  if (window.Chart) {
    Chart.defaults.color = "#a0a09a";
    Chart.defaults.borderColor = "rgba(255, 255, 255, 0.06)";
    Chart.defaults.font.family = 'ui-sans-serif, system-ui, "Segoe UI", sans-serif';
  }

  (function buildProfCheckboxes() {
    const container = el("profCheckboxes");
    Object.entries(PROF).forEach(([id, name]) => {
      const color = PROF_COLORS[id];
      const lbl = document.createElement("label");
      lbl.style.color = color;
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = id;
      cb.checked = true;
      cb.style.accentColor = color;
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(name));
      container.appendChild(lbl);
    });
  })();

  function numberOr(id, fallback) {
    const value = el(id).value;
    if (value === "") return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function readFilters() {
    return {
      minLevel: numberOr("minLevel", -Infinity),
      maxLevel: numberOr("maxLevel", Infinity),
      minHonor: numberOr("minHonor", -Infinity),
      maxHonor: numberOr("maxHonor", Infinity),
      maxDays: numberOr("onlineValue", Infinity),
      professions: new Set(
        [...el("profCheckboxes").querySelectorAll("input:checked")].map((cb) => Number(cb.value)),
      ),
    };
  }

  function resetFilters() {
    for (const id of ["minLevel", "maxLevel", "minHonor", "maxHonor", "onlineValue"]) {
      el(id).value = "";
    }
    el("onlinePreset").value = "all";
    for (const cb of el("profCheckboxes").querySelectorAll("input")) cb.checked = true;
  }

  function chartOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        title: { display: true, text: "Level według profesji", color: "#f2f2ef", font: { size: 14, weight: "600" } },
        legend: { display: false },
        tooltip: { enabled: false, external: renderTooltip },
      },
      scales: {
        y: { beginAtZero: true, stacked: true, ticks: { precision: 0 }, grid: { color: "rgba(255, 255, 255, 0.06)" } },
        x: { stacked: true, ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 50 }, grid: { color: "rgba(255, 255, 255, 0.04)" } },
      },
    };
  }

  function renderTooltip({ chart, tooltip }) {
    let node = document.getElementById("profTooltip");
    if (!node) {
      node = document.createElement("div");
      node.id = "profTooltip";
      node.style.cssText =
        "position:fixed;pointer-events:none;background:#1e1e22;border:1px solid #35353b;border-radius:10px;padding:10px 14px;font-size:13px;color:#f2f2ef;min-width:180px;z-index:999;transition:opacity .1s";
      document.body.appendChild(node);
    }
    if (tooltip.opacity === 0) {
      node.style.opacity = 0;
      return;
    }

    const dataIndex = tooltip.dataPoints?.[0]?.dataIndex;
    if (dataIndex == null) {
      node.style.opacity = 0;
      return;
    }

    const total = chart.data.datasets.reduce((sum, ds) => sum + (ds.data[dataIndex] || 0), 0);
    const level = chart.data.labels[dataIndex];
    const rows = chart.data.datasets
      .map((ds) => ({ label: ds.label, color: ds.backgroundColor, val: ds.data[dataIndex] || 0 }))
      .filter((e) => e.val > 0)
      .sort((a, b) => b.val - a.val)
      .map((e) => {
        const pct = total ? ((e.val / total) * 100).toFixed(1) : "0.0";
        return `<div style="display:flex;align-items:center;gap:8px;margin:3px 0">
          <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${e.color};flex-shrink:0"></span>
          <span style="flex:1">${e.label}</span>
          <span style="color:#a0a09a;margin-left:8px">${e.val}</span>
          <span style="color:#3987e5;min-width:48px;text-align:right">${pct}%</span>
        </div>`;
      })
      .join("");

    node.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px;color:#3987e5">Level ${level}</div>
      ${rows}
      <div style="border-top:1px solid #35353b;margin-top:6px;padding-top:6px;color:#a0a09a">Razem: <b style="color:#f2f2ef">${total}</b></div>
    `;

    const pos = chart.canvas.getBoundingClientRect();
    node.style.opacity = 1;

    let x = pos.left + tooltip.caretX + 12;
    let y = pos.top + tooltip.caretY - 10;
    if (x + node.offsetWidth > window.innerWidth - 8) x = pos.left + tooltip.caretX - node.offsetWidth - 12;
    if (y + node.offsetHeight > window.innerHeight - 8) y = window.innerHeight - node.offsetHeight - 8;
    if (y < 8) y = 8;

    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
  }

  function renderChart(counts) {
    const labels = [...counts.keys()].sort((a, b) => a - b);
    const datasets = Object.entries(PROF).map(([id, name]) => ({
      label: name,
      data: labels.map((level) => counts.get(level)[id - 1] || 0),
      backgroundColor: PROF_COLORS[id],
      barPercentage: 1.0,
      categoryPercentage: 1.0,
    }));

    el("chartEmpty").hidden = labels.length > 0;
    el("professionChart").hidden = labels.length === 0;

    if (!chart) {
      chart = new Chart(el("professionChart"), { type: "bar", data: { labels, datasets }, options: chartOptions() });
      return;
    }

    // Podmiana danych zamiast destroy()/new Chart() — filtrowanie 40 tys.
    // wierszy przy każdym znaku w polu było zauważalnie zacinające.
    chart.data.labels = labels;
    chart.data.datasets = datasets;
    chart.update();
  }

  function renderStats(counts, activity) {
    const { total, perProfession } = totalsFromCounts(counts);

    const badges = Object.entries(PROF)
      .map(([id, name]) => ({ name, color: PROF_COLORS[id], count: perProfession[id - 1] }))
      .sort((a, b) => b.count - a.count)
      .map(({ name, color, count }) => `<span style="color:${color};white-space:nowrap">${name}: <b>${count}</b></span>`)
      .join(" · ");

    const activityLine = activity
      .map(([bucket, count]) => `<span>${ACTIVITY_LABELS[bucket]}: <b style="color:var(--text)">${count}</b></span>`)
      .join(" · ");

    el("stats").innerHTML = `
      <div style="margin-bottom:6px">Razem: <b style="color:var(--text)">${total}</b></div>
      <div class="stats-line">${badges}</div>
      <div class="stats-line" style="margin-top:8px">${activityLine}</div>
    `;
  }

  function render() {
    if (!data) return;
    const filters = readFilters();
    const counts = countByLevel(data, filters);
    renderChart(counts);
    renderStats(counts, countByActivity(data, filters));
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 150);
  }

  async function loadSnapshot(entry) {
    if (!entry) return;
    const token = ++loadToken;

    el("error").textContent = "";
    el("stats").textContent = "Ładowanie…";
    el("sourceInfo").textContent = entry.filters;

    try {
      const res = await fetch(entry.filters);
      if (!res.ok) throw new Error(`HTTP ${res.status} dla ${entry.filters}`);
      const json = await res.json();
      // Odpowiedź na porzucone żądanie — użytkownik zdążył przełączyć świat/datę.
      if (token !== loadToken) return;

      data = json;
      render();
    } catch (e) {
      el("error").textContent = String(e?.message || e);
      el("stats").textContent = "—";
    }
  }

  const getWorlds = () => manifest?.worlds || [];
  const currentWorldEntries = () => getWorlds().find((w) => w.name === el("worldSelect").value)?.files || [];
  const selectedEntry = () => currentWorldEntries().find((f) => f.timestamp === el("snapshotSelect").value);

  function fillWorldSelect(selected) {
    el("worldSelect").innerHTML = getWorlds()
      .map((w) => `<option value="${w.name}">${capitalize(w.name)}</option>`)
      .join("");
    if (selected && getWorlds().some((w) => w.name === selected)) el("worldSelect").value = selected;
  }

  function fillSnapshotSelect(selected) {
    const files = [...currentWorldEntries()].reverse(); // najnowsze na górze
    el("snapshotSelect").innerHTML = files
      .map((f) => `<option value="${f.timestamp}">${formatTimestamp(f.timestamp)}</option>`)
      .join("");
    if (selected && files.some((f) => f.timestamp === selected)) el("snapshotSelect").value = selected;
  }

  function writeUrlState() {
    const params = new URLSearchParams({ world: el("worldSelect").value, date: el("snapshotSelect").value });
    history.replaceState(null, "", `${location.pathname}?${params}`);
  }

  async function selectAndLoad() {
    writeUrlState();
    await loadSnapshot(selectedEntry());
  }

  async function init() {
    try {
      const res = await fetch("manifest.json");
      if (!res.ok) throw new Error(`HTTP ${res.status} dla manifest.json`);
      manifest = await res.json();

      const params = new URLSearchParams(location.search);
      fillWorldSelect(params.get("world"));
      fillSnapshotSelect(params.get("date"));
      await selectAndLoad();
    } catch (e) {
      el("error").textContent = String(e?.message || e);
      el("stats").textContent = "—";
    }
  }

  el("worldSelect").addEventListener("change", async () => {
    fillSnapshotSelect();
    await selectAndLoad();
  });
  el("snapshotSelect").addEventListener("change", selectAndLoad);

  el("onlinePreset").addEventListener("change", () => {
    const value = el("onlinePreset").value;
    el("onlineValue").value = value === "all" ? "" : value;
    scheduleRender();
  });

  for (const id of ["minLevel", "maxLevel", "minHonor", "maxHonor", "onlineValue"]) {
    el(id).addEventListener("input", scheduleRender);
  }
  el("profCheckboxes").addEventListener("change", scheduleRender);

  el("resetBtn").addEventListener("click", () => {
    resetFilters();
    scheduleRender();
  });

  el("copyBtn").addEventListener("click", async () => {
    writeUrlState();
    await navigator.clipboard.writeText(location.href);
    const btn = el("copyBtn");
    btn.textContent = "✓";
    setTimeout(() => {
      btn.textContent = "⎘";
    }, 1500);
  });

  init();
}

// Moduły są odroczone, więc dokument jest już sparsowany — ale gdyby plik
// trafił tu wcześniej, czekamy na DOM zamiast wywalać się na brakującym #id.
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupDashboard);
  } else {
    setupDashboard();
  }
}
