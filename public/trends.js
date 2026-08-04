// Widok historii jednego świata: populacja, aktywność i profesje przez wszystkie
// migawki. Górna część jest czysta (bez DOM-u) i testowana w test/trends.test.ts;
// warstwa DOM-owa startuje na końcu pliku.
//
// Dane to `trends.json` — zwinięta historia wszystkich światów, 9 KB po gzipie.
// Te same wykresy z surowych `.f.json` kosztowałyby 14,9 MB i 5,6 mln wierszy.

import { PROF, PROF_COLORS, capitalize, daysBetween, formatSnapshotDate } from "./shared.js";

/**
 * Progi aktywności — **skumulowane**, w odróżnieniu od rozłącznych koszyków
 * `act` w pliku i `ACTIVITY_BOUNDS` w app.js. „≤ 7 dni” to koszyki 0 i 1 razem;
 * pomylenie tych dwóch skal dałoby wykres zaniżony o cały koszyk „< 24h”.
 */
export const ACTIVITY_THRESHOLDS = [
  { key: "24h", label: "< 24h", buckets: [0] },
  { key: "7d", label: "≤ 7 dni", buckets: [0, 1] },
  { key: "30d", label: "≤ 30 dni", buckets: [0, 1, 2] },
];

// Domyślnie ≤ 7 dni: „< 24h” waha się o 14,7% przy populacji stabilnej na 0,6%,
// bo zależy od godziny i dnia tygodnia scrapa. Patrz docs/2026-08-04-spec-trendy.md.
export const DEFAULT_THRESHOLD = "7d";

export function thresholdByKey(key) {
  return ACTIVITY_THRESHOLDS.find((t) => t.key === key) ?? ACTIVITY_THRESHOLDS.find((t) => t.key === DEFAULT_THRESHOLD);
}

/** Liczba aktywnych w każdej migawce przy danym progu. */
export function activeCounts(trend, key) {
  const { buckets } = thresholdByKey(key);
  return trend.total.map((_, i) => buckets.reduce((sum, bucket) => sum + trend.act[bucket][i], 0));
}

/** Udział w populacji, w procentach. Migawka bez graczy daje 0, nie NaN. */
export function shareSeries(counts, totals) {
  return counts.map((count, i) => (totals[i] > 0 ? (count / totals[i]) * 100 : 0));
}

/** Migawki jako wpisy `{ id, startedAt }` — format, który rozumieją funkcje z shared.js. */
export function snapshotEntries(trend) {
  return trend.id.map((id, i) => ({ id, startedAt: trend.startedAt[i], suspect: trend.suspect[i] === 1 }));
}

/**
 * Zmiany między kolejnymi migawkami. `perDay` jest tu ważniejsze niż `delta`:
 * odstępy między migawkami wynoszą 3-17 dni, więc „−120 graczy” z dwóch wierszy
 * tabeli znaczy dwie różne rzeczy, dopóki nie podzieli się przez czas.
 */
export function changeRows(trend) {
  const entries = snapshotEntries(trend);
  const rows = [];

  for (let i = 1; i < entries.length; i++) {
    const days = daysBetween(entries[i - 1], entries[i]);
    const delta = trend.total[i] - trend.total[i - 1];
    rows.push({
      entry: entries[i],
      total: trend.total[i],
      delta,
      days,
      perDay: days && days > 0 ? delta / days : null,
    });
  }
  return rows;
}

/** Podsumowanie całej historii świata — od pierwszej migawki do ostatniej. */
export function summarize(trend) {
  const last = trend.total.length - 1;
  if (last < 0) return null;

  const entries = snapshotEntries(trend);
  const first = trend.total[0];
  const delta = trend.total[last] - first;
  return {
    snapshots: trend.total.length,
    total: trend.total[last],
    delta,
    percent: first > 0 ? (delta / first) * 100 : 0,
    days: daysBetween(entries[0], entries[last]),
  };
}

// ── Stan widoku w URL-u ─────────────────────────────────────────────────────

export function viewToParams(view) {
  const params = new URLSearchParams();
  if (view.world) params.set("world", view.world);
  if (view.threshold !== DEFAULT_THRESHOLD) params.set("prog", view.threshold);
  if (view.share) params.set("udzial", "1");
  return params;
}

export function viewFromParams(params) {
  const threshold = params.get("prog");
  return {
    world: params.get("world") || null,
    threshold: ACTIVITY_THRESHOLDS.some((t) => t.key === threshold) ? threshold : DEFAULT_THRESHOLD,
    share: params.get("udzial") === "1",
  };
}

// ── Warstwa DOM ─────────────────────────────────────────────────────────────

function setupTrends() {
  const el = (id) => {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Brak elementu #${id}`);
    return node;
  };

  let trends = null;
  const charts = {};
  // Oś X jest liniowa w milisekundach epoki, więc odstępy 3-17 dni są widoczne jako
  // różne. Chart.js ma do tego skalę czasu, ale wymaga adaptera dat, którego nie
  // wendorujemy — podpisy generujemy sami, a podziałki stawiamy dokładnie w migawkach.
  let tickValues = [];

  if (window.Chart) {
    Chart.defaults.color = "#a0a09a";
    Chart.defaults.borderColor = "rgba(255, 255, 255, 0.06)";
    Chart.defaults.font.family = 'ui-sans-serif, system-ui, "Segoe UI", sans-serif';
  }

  const worldsOf = () => (trends ? Object.keys(trends.worlds).sort() : []);
  const currentTrend = () => trends?.worlds[el("worldSelect").value] ?? null;
  const isShare = () => el("modeSelect").value === "udzial";

  function readView() {
    return { world: el("worldSelect").value, threshold: el("thresholdSelect").value, share: isShare() };
  }

  function writeUrlState() {
    const params = viewToParams(readView());
    params.sort();
    history.replaceState(null, "", params.toString() ? `${location.pathname}?${params}` : location.pathname);
  }

  const shortDate = (ms) => {
    const d = new Date(ms);
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
  };

  function chartOptions(title, { percent = false } = {}) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        title: { display: true, text: title, color: "#f2f2ef", font: { size: 14, weight: "600" } },
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const entry = entryAt(items[0].parsed.x);
              if (!entry) return "";
              // Godzina UTC, bo to ona tłumaczy skoki metryki „ostatnio online”.
              const utc = new Date(entry.startedAt).toISOString().slice(11, 16);
              return `${formatSnapshotDate(entry)} (${utc} UTC)`;
            },
            label: (item) => `${item.dataset.label}: ${percent ? `${dec(item.parsed.y)}%` : num(item.parsed.y)}`,
            footer: (items) => (entryAt(items[0].parsed.x)?.suspect ? "⚠ migawka może być obcięta" : ""),
          },
        },
      },
      scales: {
        y: {
          beginAtZero: percent,
          ticks: { precision: percent ? 1 : 0, callback: (v) => (percent ? `${dec(v)}%` : num(v)) },
          grid: { color: "rgba(255, 255, 255, 0.06)" },
        },
        x: {
          type: "linear",
          afterBuildTicks: (axis) => {
            axis.ticks = tickValues.map((value) => ({ value }));
          },
          ticks: { callback: (v) => shortDate(v), maxRotation: 45, autoSkip: false },
          grid: { color: "rgba(255, 255, 255, 0.04)" },
        },
      },
    };
  }

  function entryAt(ms) {
    const trend = currentTrend();
    if (!trend) return null;
    const i = trend.startedAt.findIndex((s) => new Date(s).getTime() === ms);
    return i === -1 ? null : snapshotEntries(trend)[i];
  }

  /** Punkt podejrzanej migawki rysujemy pusty — inaczej obcięty scrape wygląda jak spadek. */
  function pointStyle(trend, color) {
    return {
      pointBackgroundColor: trend.suspect.map((s) => (s ? "transparent" : color)),
      pointBorderColor: trend.suspect.map((s) => (s ? "#c98500" : color)),
      pointBorderWidth: trend.suspect.map((s) => (s ? 2 : 1)),
      pointRadius: trend.suspect.map((s) => (s ? 6 : 3)),
      pointHoverRadius: 6,
    };
  }

  function series(trend, values) {
    return values.map((y, i) => ({ x: new Date(trend.startedAt[i]).getTime(), y }));
  }

  function drawChart(id, datasets, options) {
    if (!charts[id]) {
      charts[id] = new Chart(el(id), { type: "line", data: { datasets }, options });
      return;
    }
    charts[id].data.datasets = datasets;
    charts[id].options = options;
    charts[id].update();
  }

  function renderCharts(trend) {
    const share = isShare();
    const threshold = thresholdByKey(el("thresholdSelect").value);

    drawChart(
      "popChart",
      [
        {
          label: "Populacja",
          data: series(trend, trend.total),
          borderColor: "#3987e5",
          backgroundColor: "#3987e5",
          tension: 0.15,
          ...pointStyle(trend, "#3987e5"),
        },
      ],
      chartOptions("Populacja świata w czasie"),
    );

    const counts = activeCounts(trend, threshold.key);
    const activity = share ? shareSeries(counts, trend.total) : counts;
    drawChart(
      "actChart",
      [
        {
          label: `Aktywni ${threshold.label}`,
          data: series(trend, activity),
          borderColor: "#199e70",
          backgroundColor: "#199e70",
          tension: 0.15,
          ...pointStyle(trend, "#199e70"),
        },
      ],
      chartOptions(
        share ? `Udział aktywnych ${threshold.label} w populacji` : `Aktywni ${threshold.label} w czasie`,
        { percent: share },
      ),
    );

    const profOptions = chartOptions(share ? "Udział profesji w populacji" : "Profesje w czasie", { percent: share });
    // Jedyny wykres z sześcioma seriami, więc jako jedyny potrzebuje legendy.
    profOptions.plugins.legend = { display: true, position: "bottom", labels: { boxWidth: 12, usePointStyle: true } };

    drawChart(
      "profChart",
      Object.entries(PROF).map(([id, name]) => {
        const values = trend.byProf[id - 1];
        return {
          label: name,
          data: series(trend, share ? shareSeries(values, trend.total) : values),
          borderColor: PROF_COLORS[id],
          backgroundColor: PROF_COLORS[id],
          tension: 0.15,
          pointRadius: 3,
          pointHoverRadius: 6,
        };
      }),
      profOptions,
    );
  }

  const num = (n) => n.toLocaleString("pl-PL");
  // Ułamki też po polsku — „−5,3%” obok „23 719” zamiast „−5.3%” z dwoma konwencjami naraz.
  const dec = (n, digits = 1) =>
    n.toLocaleString("pl-PL", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const signed = (n, format = num) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${format(Math.abs(n))}`;

  function renderSummary(trend) {
    const s = summarize(trend);
    const color = s.delta < 0 ? "#e66767" : s.delta > 0 ? "#199e70" : "var(--muted)";
    const span = s.days === null ? "—" : `${Math.round(s.days)} dni`;

    el("summary").innerHTML = `
      <div style="margin-bottom:6px">Populacja: <b style="color:var(--text)">${num(s.total)}</b></div>
      <div class="stats-line">
        <span>Zmiana od pierwszej migawki: <b style="color:${color}">${signed(s.delta)}</b>
          <span style="color:${color}">(${signed(s.percent, dec)}%)</span></span>
        <span>Migawek: <b style="color:var(--text)">${s.snapshots}</b></span>
        <span>Okres: <b style="color:var(--text)">${span}</b></span>
      </div>
    `;
  }

  function renderTable(trend) {
    const rows = changeRows(trend).reverse(); // najnowsze na górze
    if (rows.length === 0) {
      el("changeTable").innerHTML = "";
      return;
    }

    const body = rows
      .map(({ entry, total, delta, days, perDay }) => {
        const color = delta < 0 ? "#e66767" : delta > 0 ? "#199e70" : "var(--muted)";
        return `<tr>
          <td>${formatSnapshotDate(entry)}${entry.suspect ? ' <span title="migawka może być obcięta" style="color:#c98500">⚠</span>' : ""}</td>
          <td class="num">${days === null ? "—" : dec(days)}</td>
          <td class="num">${num(total)}</td>
          <td class="num" style="color:${color}">${signed(delta)}</td>
          <td class="num" style="color:${color}">${perDay === null ? "—" : signed(perDay, dec)}</td>
        </tr>`;
      })
      .join("");

    el("changeTable").innerHTML = `
      <table>
        <thead><tr><th>Migawka</th><th class="num">Odstęp (dni)</th><th class="num">Populacja</th><th class="num">Zmiana</th><th class="num">Na dobę</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    `;
  }

  function render() {
    const trend = currentTrend();
    if (!trend) return;
    writeUrlState();

    // Jeden punkt to poprawny stan, nie błąd — luvia dołączyła w ostatniej rundzie.
    el("singlePoint").hidden = trend.id.length > 1;
    el("suspectNote").hidden = !trend.suspect.some((s) => s === 1);

    renderSummary(trend);
    tickValues = trend.startedAt.map((s) => new Date(s).getTime());
    renderCharts(trend);
    renderTable(trend);
  }

  function fillWorldSelect(selected) {
    const worlds = worldsOf();
    el("worldSelect").innerHTML = worlds.map((w) => `<option value="${w}">${capitalize(w)}</option>`).join("");
    if (selected && worlds.includes(selected)) el("worldSelect").value = selected;
  }

  function fillThresholdSelect(selected) {
    el("thresholdSelect").innerHTML = ACTIVITY_THRESHOLDS.map(
      (t) => `<option value="${t.key}">${t.label}</option>`,
    ).join("");
    el("thresholdSelect").value = selected;
  }

  async function init() {
    try {
      const res = await fetch("trends.json");
      if (!res.ok) throw new Error(`HTTP ${res.status} dla trends.json`);
      trends = await res.json();

      const view = viewFromParams(new URLSearchParams(location.search));
      fillWorldSelect(view.world);
      fillThresholdSelect(view.threshold);
      el("modeSelect").value = view.share ? "udzial" : "liczba";
      render();
    } catch (e) {
      el("error").textContent = String(e?.message || e);
      el("summary").textContent = "—";
    }
  }

  for (const id of ["worldSelect", "thresholdSelect", "modeSelect"]) {
    el(id).addEventListener("change", render);
  }

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

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupTrends);
  } else {
    setupTrends();
  }
}
