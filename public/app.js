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

// Zakresy koszyków aktywności (w dniach). Koszyk 4 to konta nigdy nieużywane.
// Koszyki są rozłączne, nie skumulowane — etykiety muszą to oddawać, bo „≤ 7 dni”
// przy koszyku 1-7 sugerowało, że to wszyscy z ostatniego tygodnia, a to tylko ci,
// których nie ma w koszyku „< 24h”.
export const ACTIVITY_BOUNDS = [
  [0, 0],
  [1, 7],
  [8, 30],
  [31, Infinity],
];

/**
 * Etykieta koszyka przycięta do aktywnego progu — przy filtrze „14 dni” koszyk
 * 8-30 zawiera realnie 8-14 dni i tak ma być podpisany.
 */
export function activityLabel(bucket, maxDays = Infinity) {
  if (bucket === 4) return "nigdy";

  const [from, to] = ACTIVITY_BOUNDS[bucket];
  const hi = Math.min(to, maxDays);
  if (from === 0) return "< 24h";
  if (hi === Infinity) return `> ${from - 1} dni`;
  if (from === hi) return from === 1 ? "1 dzień" : `${from} dni`;
  return `${from}-${hi} dni`;
}

/**
 * Koszyki, które przy danym progu mogą być niepuste. Bez tego widok pokazywał
 * „> 30 dni: 0 · nigdy: 0” — zera z definicji, wyglądające jak zepsute dane.
 */
export function visibleActivityBuckets(maxDays = Infinity) {
  if (maxDays === Infinity) return [0, 1, 2, 3, 4];
  return ACTIVITY_BOUNDS.map(([from], bucket) => (from <= maxDays ? bucket : null)).filter((b) => b !== null);
}

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

// ── Stan widoku w URL-u ─────────────────────────────────────────────────────
//
// Bez tego przycisk „kopiuj link do tego widoku” wysyłał widok domyślny —
// ktoś, kto ustawił poziom 250-320 i honor > 100k, dzielił się czymś innym,
// niż miał na ekranie.

export function filtersToParams(f) {
  const params = new URLSearchParams();
  const put = (key, value) => {
    if (Number.isFinite(value)) params.set(key, String(value));
  };

  put("minLevel", f.minLevel);
  put("maxLevel", f.maxLevel);
  put("minHonor", f.minHonor);
  put("maxHonor", f.maxHonor);
  put("maxDays", f.maxDays);

  const profs = [...f.professions].sort((a, b) => a - b);
  if (profs.length !== 6) params.set("prof", profs.join(","));

  return params;
}

export function filtersFromParams(params) {
  const num = (key, fallback) => {
    const raw = params.get(key);
    if (raw === null || raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };

  const rawProf = params.get("prof");
  const parsed = (rawProf ?? "")
    .split(",")
    .map(Number)
    .filter((p) => Number.isInteger(p) && p >= 1 && p <= 6);

  const maxDays = num("maxDays", Infinity);
  return {
    minLevel: num("minLevel", -Infinity),
    maxLevel: num("maxLevel", Infinity),
    minHonor: num("minHonor", -Infinity),
    maxHonor: num("maxHonor", Infinity),
    // Ujemny próg dni nie znaczy nic — traktujemy jak brak filtra zamiast
    // po cichu pokazywać pustą stronę.
    maxDays: maxDays < 0 ? Infinity : maxDays,
    professions: new Set(parsed.length > 0 ? parsed : [1, 2, 3, 4, 5, 6]),
  };
}

// ── Formatowanie ────────────────────────────────────────────────────────────

export function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Data migawki w czasie lokalnym przeglądarki, liczona z `startedAt`.
 *
 * Identyfikator migawki (trzon nazwy pliku) NIE nadaje się na datę: do lipca 2026
 * powstawał z czasu lokalnego scrapera, później z UTC, więc dwie migawki obok siebie
 * pokazywałyby dwa różne zegary. Gdy `startedAt` brakuje, wracamy do identyfikatora
 * i mówimy wprost, że to przybliżenie.
 */
export function formatSnapshotDate(entry) {
  if (entry?.startedAt) {
    const d = new Date(entry.startedAt);
    if (!Number.isNaN(d.getTime())) {
      const p = (n) => String(n).padStart(2, "0");
      return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
  }

  const m = String(entry?.id ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]} (?)` : String(entry?.id ?? "—");
}

/** Odstęp między migawkami w dniach — liczony wyłącznie z `startedAt`. */
export function daysBetween(a, b) {
  if (!a?.startedAt || !b?.startedAt) return null;
  const diff = new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  return Number.isNaN(diff) ? null : diff / 86_400_000;
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
    const maxDays = numberOr("onlineValue", Infinity);
    return {
      minLevel: numberOr("minLevel", -Infinity),
      maxLevel: numberOr("maxLevel", Infinity),
      minHonor: numberOr("minHonor", -Infinity),
      maxHonor: numberOr("maxHonor", Infinity),
      maxDays: maxDays < 0 ? Infinity : maxDays,
      professions: new Set(
        [...el("profCheckboxes").querySelectorAll("input:checked")].map((cb) => Number(cb.value)),
      ),
    };
  }

  /** Odwrotność readFilters — wsadza stan z URL-a z powrotem w pola formularza. */
  function applyFilters(f) {
    const put = (id, value) => {
      el(id).value = Number.isFinite(value) ? String(value) : "";
    };
    put("minLevel", f.minLevel);
    put("maxLevel", f.maxLevel);
    put("minHonor", f.minHonor);
    put("maxHonor", f.maxHonor);
    put("onlineValue", f.maxDays);
    el("onlinePreset").value = Number.isFinite(f.maxDays) ? String(f.maxDays) : "all";
    for (const cb of el("profCheckboxes").querySelectorAll("input")) {
      cb.checked = f.professions.has(Number(cb.value));
    }
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

  function renderStats(counts, activity, maxDays) {
    const { total, perProfession } = totalsFromCounts(counts);

    const badges = Object.entries(PROF)
      .map(([id, name]) => ({ name, color: PROF_COLORS[id], count: perProfession[id - 1] }))
      .sort((a, b) => b.count - a.count)
      .map(({ name, color, count }) => `<span style="color:${color};white-space:nowrap">${name}: <b>${count}</b></span>`)
      .join(" · ");

    const visible = new Set(visibleActivityBuckets(maxDays));
    const activityLine = activity
      .filter(([bucket]) => visible.has(bucket))
      .map(([bucket, count]) => `<span>${activityLabel(bucket, maxDays)}: <b style="color:var(--text)">${count}</b></span>`)
      .join(" · ");

    el("stats").innerHTML = `
      <div style="margin-bottom:6px">Razem: <b style="color:var(--text)">${total}</b></div>
      <div class="stats-line">${badges}</div>
      <div class="stats-line" style="margin-top:8px">${activityLine}</div>
    `;
  }

  function render() {
    if (!data) return;
    writeUrlState();
    const filters = readFilters();
    const counts = countByLevel(data, filters);
    renderChart(counts);
    renderStats(counts, countByActivity(data, filters), filters.maxDays);
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
  const selectedEntry = () => currentWorldEntries().find((f) => f.id === el("snapshotSelect").value);

  function fillWorldSelect(selected) {
    el("worldSelect").innerHTML = getWorlds()
      .map((w) => `<option value="${w.name}">${capitalize(w.name)}</option>`)
      .join("");
    if (selected && getWorlds().some((w) => w.name === selected)) el("worldSelect").value = selected;
  }

  function fillSnapshotSelect(selected) {
    const files = [...currentWorldEntries()].reverse(); // najnowsze na górze
    el("snapshotSelect").innerHTML = files
      .map((f) => `<option value="${f.id}">${formatSnapshotDate(f)}</option>`)
      .join("");
    if (selected && files.some((f) => f.id === selected)) el("snapshotSelect").value = selected;
  }

  function writeUrlState() {
    const params = filtersToParams(readFilters());
    params.set("world", el("worldSelect").value);
    params.set("date", el("snapshotSelect").value);
    params.sort();
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
      applyFilters(filtersFromParams(params));
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
