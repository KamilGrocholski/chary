// The view of one world: the chosen snapshot in cross-section and the history of all of
// them, under one filter. This is the only module that touches the DOM — all the counting
// logic sits in `filters.js` and `history.js` and is tested without a browser.
//
// Two data paths, deliberately unequal:
//   • the default filter → history from `trends.json` (9 KB), fetched anyway
//   • a filter set → history computed from that world's `.f.json` (up to 1.9 MB), pulled
//     only after the first filter move and filling the chart in snapshot by snapshot
// Whoever does not filter does not pay a byte for the precision.
//
// The strings a reader sees are Polish — see "Language" in AGENTS.md.

import { PROF, PROF_COLORS, capitalize, formatSnapshotDate, shortDate, utcTime } from "./shared.js";
import {
  activityLabel,
  countByActivity,
  countByLevel,
  describeFilters,
  filtersFromParams,
  filtersToParams,
  isDefaultFilters,
  totalsFromCounts,
  visibleActivityBuckets,
} from "./filters.js";
import {
  activeCounts,
  buildFilteredTrend,
  cachedSnapshots,
  changeRows,
  loadHistory,
  loadedCount,
  shareSeries,
  snapshotEntries,
  summarize,
  thresholdByKey,
  toTypedSnapshot,
  usableThresholds,
  viewFromParams,
  viewToParams,
  windowedEntries,
} from "./history.js";

function setupView() {
  const el = (id) => {
    const node = document.getElementById(id);
    if (!node) throw new Error(`no element #${id}`);
    return node;
  };

  let manifest = null;
  let trends = null;
  let renderTimer = null;

  // The history is bought knowingly: as long as nobody has moved the filter, `trends.json`
  // is enough and there is no reason to pull megabytes.
  let worldToken = 0; // invalidates a fetch after the world is switched
  let snapshotToken = 0; // the same for the single snapshot being cross-sectioned
  let progress = { loaded: 0, expected: 0, failed: 0, running: false };

  const charts = {};
  // The X axis is linear in epoch milliseconds, so 3-17 day intervals are visibly
  // different. Chart.js has a time scale for this, but it needs a date adapter we do not
  // vendor — so we generate the labels ourselves and put the ticks exactly at the snapshots.
  let tickValues = [];
  let entriesByTime = new Map();
  let thresholdKeys = ""; // the last set of thresholds filled in, so the choice is not cleared

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

  // ── Reading the state out of the form ─────────────────────────────────────

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

  function readView() {
    return {
      world: el("worldSelect").value,
      date: el("snapshotSelect").value,
      threshold: el("thresholdSelect").value,
      share: el("modeSelect").value === "udzial",
    };
  }

  /** The inverse of readFilters — puts the state from the URL back into the form fields. */
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

  function writeUrlState() {
    const params = filtersToParams(readFilters());
    for (const [key, value] of viewToParams(readView())) params.set(key, value);
    params.sort();
    // The anchor stays: without it the first filter change after clicking "Historia"
    // wiped the anchor out of the address, so a reload returned to the top of the page.
    const hash = location.hash || "";
    const query = params.toString();
    const url = `${location.pathname}${query ? `?${query}` : ""}${hash}`;
    // `render()` runs on every character and on every history file fetched. Safari cuts
    // in after ~100 `replaceState` calls per 30 s, and an exception would take down the
    // render halfway — so we write only when the address actually changed.
    if (url === `${location.pathname}${location.search || ""}${hash}`) return;
    history.replaceState(null, "", url);
  }

  // ── Data ──────────────────────────────────────────────────────────────────

  const getWorlds = () => manifest?.worlds || [];
  const currentWorld = () => el("worldSelect").value;
  const currentWorldEntries = () => getWorlds().find((w) => w.name === currentWorld())?.files || [];
  const selectedEntry = () => currentWorldEntries().find((f) => f.id === el("snapshotSelect").value);
  const baseTrend = () => trends?.worlds[currentWorld()] ?? null;
  const currentSnapshot = () => cachedSnapshots(currentWorld()).get(el("snapshotSelect").value) ?? null;

  /** The snapshots that can reach the time axis at all: dated and inside the window. */
  function historyEntries() {
    const base = baseTrend();
    if (!base) return [];
    const dated = new Set(base.id);
    return windowedEntries(currentWorldEntries().filter((e) => dated.has(e.id)));
  }

  // ── Formatting numbers ────────────────────────────────────────────────────

  const num = (n) => n.toLocaleString("pl-PL");
  // Fractions in Polish too — "−5,3%" next to "23 719" rather than "−5.3%", two
  // conventions at once.
  const dec = (n, digits = 1) =>
    n.toLocaleString("pl-PL", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const signed = (n, format = num) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${format(Math.abs(n))}`;

  /**
   * An exception turned into a message for a person. The error bar used to carry the raw
   * exception text — "Failed to fetch", or "HTTP 500 for worlds/gordion/2026-…f.json" —
   * i.e. a message in English, with a file path and no hint about what to do. The path does
   * not disappear from the view: it stands in the "Plik" field in the filter drawer.
   */
  function describeFailure(error, what) {
    const message = String(error?.message ?? error);
    const http = message.match(/^HTTP (\d{3})/);
    if (http) return `Nie udało się pobrać ${what}: serwer odpowiedział kodem ${http[1]}.`;
    if (/JSON|Unexpected token/i.test(message)) {
      return `Nie udało się odczytać ${what}: plik nie jest poprawnym JSON-em.`;
    }
    return `Nie udało się pobrać ${what} — wygląda na brak połączenia. Odśwież stronę i spróbuj ponownie.`;
  }

  // ── The cross-section chart: levels by profession ─────────────────────────

  function levelChartOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        title: { display: true, text: "Level według profesji", color: "#f2f2ef", font: { size: 14, weight: "600" } },
        legend: { display: false },
        tooltip: { enabled: false, external: renderLevelTooltip },
      },
      scales: {
        y: { beginAtZero: true, stacked: true, ticks: { precision: 0 }, grid: { color: "rgba(255, 255, 255, 0.06)" } },
        x: { stacked: true, ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 50 }, grid: { color: "rgba(255, 255, 255, 0.04)" } },
      },
    };
  }

  function renderLevelTooltip({ chart, tooltip }) {
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
        // The same notation as in the bar and the table: "12,3%" and "1 234", not "12.3%".
        const pct = total ? dec((e.val / total) * 100, 1) : dec(0, 1);
        return `<div style="display:flex;align-items:center;gap:8px;margin:3px 0">
          <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${e.color};flex-shrink:0"></span>
          <span style="flex:1">${e.label}</span>
          <span style="color:#a0a09a;margin-left:8px">${num(e.val)}</span>
          <span style="color:#3987e5;min-width:48px;text-align:right">${pct}%</span>
        </div>`;
      })
      .join("");

    node.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px;color:#3987e5">Level ${level}</div>
      ${rows}
      <div style="border-top:1px solid #35353b;margin-top:6px;padding-top:6px;color:#a0a09a">Razem: <b style="color:#f2f2ef">${num(total)}</b></div>
    `;

    const pos = chart.canvas.getBoundingClientRect();
    node.style.opacity = 1;

    let x = pos.left + tooltip.caretX + 12;
    let y = pos.top + tooltip.caretY - 10;
    if (x + node.offsetWidth > window.innerWidth - 8) x = pos.left + tooltip.caretX - node.offsetWidth - 12;
    if (y + node.offsetHeight > window.innerHeight - 8) y = window.innerHeight - node.offsetHeight - 8;
    // The filter bar is sticky and has a higher z-index than the tooltip, so the upper
    // clamp has to end below it rather than 8 px from the window's edge.
    const barBottom = el("filterBar").getBoundingClientRect().bottom || 0;
    if (y < barBottom + 8) y = barBottom + 8;

    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
  }

  function renderLevelChart(counts) {
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

    if (!charts.professionChart) {
      charts.professionChart = new Chart(el("professionChart"), {
        type: "bar",
        data: { labels, datasets },
        options: levelChartOptions(),
      });
      return;
    }

    // Swapping the data instead of destroy()/new Chart() — filtering 40k rows on every
    // character typed into a field stuttered noticeably.
    charts.professionChart.data.labels = labels;
    charts.professionChart.data.datasets = datasets;
    charts.professionChart.update();
  }

  // ── The history charts ────────────────────────────────────────────────────

  function timeChartOptions(title, { percent = false } = {}) {
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
              const entry = entriesByTime.get(items[0].parsed.x);
              if (!entry) return "";
              // The UTC hour, because it is what explains the jumps in "last online".
              return `${formatSnapshotDate(entry)} (${utcTime(entry.startedAt)} UTC)`;
            },
            label: (item) => `${item.dataset.label}: ${percent ? `${dec(item.parsed.y)}%` : num(item.parsed.y)}`,
            footer: (items) => (entriesByTime.get(items[0].parsed.x)?.suspect ? "⚠ migawka może być obcięta" : ""),
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

  /** A suspect snapshot's point is drawn hollow — otherwise a truncated scrape looks like a drop. */
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

  function renderHistoryCharts(trend, population, filters, share) {
    // Under the default filter, "the matches' share of the population" is 100% by
    // definition — so the population chart stays in counts instead of drawing a flat line.
    const filtered = !isDefaultFilters(filters);
    const popShare = share && filtered;

    drawChart(
      "popChart",
      [
        {
          label: filtered ? "Pasujących" : "Populacja",
          data: series(trend, popShare ? shareSeries(trend.total, population) : trend.total),
          borderColor: "#3987e5",
          backgroundColor: "#3987e5",
          tension: 0.15,
          ...pointStyle(trend, "#3987e5"),
        },
      ],
      timeChartOptions(
        popShare
          ? "Udział pasujących w populacji"
          : filtered
            ? "Pasujących filtrowi w czasie"
            : "Populacja świata w czasie",
        { percent: popShare },
      ),
    );

    const threshold = thresholdByKey(el("thresholdSelect").value, filters.maxDays);
    if (threshold) {
      const counts = activeCounts(trend, threshold.key, filters.maxDays);
      drawChart(
        "actChart",
        [
          {
            label: `Aktywni ${threshold.label}`,
            data: series(trend, share ? shareSeries(counts, population) : counts),
            borderColor: "#199e70",
            backgroundColor: "#199e70",
            tension: 0.15,
            ...pointStyle(trend, "#199e70"),
          },
        ],
        timeChartOptions(
          share ? `Udział aktywnych ${threshold.label} w populacji` : `Aktywni ${threshold.label} w czasie`,
          { percent: share },
        ),
      );
    }

    const profOptions = timeChartOptions(share ? "Udział profesji w populacji" : "Profesje w czasie", {
      percent: share,
    });
    // The only chart with six series, so the only one that needs a legend.
    profOptions.plugins.legend = { display: true, position: "bottom", labels: { boxWidth: 12, usePointStyle: true } };

    drawChart(
      "profChart",
      Object.entries(PROF)
        .filter(([id]) => filters.professions.has(Number(id)))
        .map(([id, name]) => {
          const values = trend.byProf[id - 1];
          return {
            label: name,
            data: series(trend, share ? shareSeries(values, population) : values),
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

  // ── Rendering the text ────────────────────────────────────────────────────

  // The groups a chip's close button clears. Never a single field: "Poziom 250-400" is one
  // thing to the reader, though two `<input>`s to the code.
  const FILTER_GROUPS = {
    level: ["minLevel", "maxLevel"],
    honor: ["minHonor", "maxHonor"],
    days: ["onlineValue"],
  };

  function clearFilterGroup(key) {
    if (key === "prof") {
      for (const cb of el("profCheckboxes").querySelectorAll("input")) cb.checked = true;
    } else {
      for (const id of FILTER_GROUPS[key] ?? []) el(id).value = "";
      if (key === "days") el("onlinePreset").value = "all";
    }
    scheduleRender();
  }

  /**
   * The chips for the active filters in the bar. Baymard: sites showing the active filters
   * both in the panel and as a summary above the results have markedly fewer user errors
   * than sites with only one of those patterns — so we have both.
   *
   * The chips are a view of `readFilters()`, not their own state: `describeFilters`
   * computes the labels, and the close button writes back into the same form fields.
   */
  function renderChips(filters) {
    const chips = describeFilters(filters);
    const box = el("filterChips");
    // The chips are rebuilt on every render, so pressing a close button destroyed the
    // element that held focus — focus fell back to `<body>` and two filters could not be
    // removed in a row from the keyboard. So we remember where it was.
    const active = typeof document !== "undefined" ? document.activeElement : null;
    const hadFocus = active && box.contains?.(active) ? (active.dataset?.clear ?? "") : null;

    box.innerHTML = chips
      .map(
        ({ key, label }) =>
          `<span class="chip" title="${label}">${label}<button type="button" data-clear="${key}" aria-label="Usuń filtr: ${label}">×</button></span>`,
      )
      .join("");
    el("filtersToggle").textContent = chips.length > 0 ? `Filtry (${chips.length})` : "Filtry";

    if (hadFocus === null) return;
    const buttons = [...box.querySelectorAll("button")];
    // The same chip if it survived; otherwise the first one left; and when the last one is
    // gone — the button the chips grow out from.
    const next = buttons.find((b) => b.dataset?.clear === hadFocus) ?? buttons[0] ?? el("filtersToggle");
    next.focus?.();
  }

  function setFieldsOpen(open) {
    // Closing hides the drawer with `display: none`. If focus were inside, the browser
    // would drop it onto `<body>` and the next Tab would start from the top of the
    // document — so we hand it to the button that opens the drawer.
    const fields = el("filterFields");
    const active = typeof document !== "undefined" ? document.activeElement : null;
    const focusWasInside = !open && active && fields.contains?.(active);

    fields.hidden = !open;
    el("filtersToggle").setAttribute("aria-expanded", String(open));
    if (focusWasInside) el("filtersToggle").focus?.();
  }

  function renderMatchLine(matched, population) {
    const share = population > 0 ? (matched / population) * 100 : 0;
    el("matchLine").innerHTML =
      `<span>Pasuje: <b>${num(matched)}</b></span>` +
      `<span>z ${num(population)}<span class="wide-only"> w tej migawce</span></span>` +
      `<span>(${dec(share, 1)}%)</span>`;
  }

  function renderStats(counts, activity, maxDays, professions) {
    const { perProfession } = totalsFromCounts(counts);

    // Zero matches is not a distribution made of zeros: six professions and five activity
    // buckets printed as "0" read like broken data, not like the answer "nobody matches".
    // The same principle as `visibleActivityBuckets`.
    if (perProfession.every((n) => n === 0)) {
      el("stats").innerHTML =
        `<div class="stats-line">Żaden gracz w tej migawce nie spełnia filtrów — rozkładu nie ma z czego złożyć.</div>`;
      return;
    }

    // A profession unchecked in the filter has nothing to contribute — "Mag: 0" next to
    // the result of a "Wojownik and Tropiciel only" filter looks like missing data rather
    // than exclusion. `profChart` draws only the chosen series; here it did not.
    const badges = Object.entries(PROF)
      .filter(([id]) => professions.has(Number(id)))
      .map(([id, name]) => ({ name, color: PROF_COLORS[id], count: perProfession[id - 1] }))
      .sort((a, b) => b.count - a.count)
      .map(
        ({ name, color, count }) =>
          `<span style="color:${color};white-space:nowrap">${name}: <b>${num(count)}</b></span>`,
      )
      .join(" · ");

    const visible = new Set(visibleActivityBuckets(maxDays));
    const activityLine = activity
      .filter(([bucket]) => visible.has(bucket))
      .map(
        ([bucket, count]) =>
          `<span>${activityLabel(bucket, maxDays)}: <b style="color:var(--text)">${num(count)}</b></span>`,
      )
      .join(" · ");

    el("stats").innerHTML = `
      <div class="stats-line">${badges}</div>
      <div class="stats-line" style="margin-top:8px">${activityLine}</div>
    `;
  }

  /**
   * The scraper flags a snapshot whose population dropped suspiciously far — most often
   * that means the ranking returned fewer pages during an outage. Without this bar the flag
   * would be written for nobody.
   */
  function showSuspect(suspect) {
    const node = el("suspect");
    if (!suspect) {
      node.hidden = true;
      node.textContent = "";
      return;
    }
    node.hidden = false;
    node.innerHTML = `<span aria-hidden="true">⚠</span><span><b>Ta migawka może być niekompletna.</b> ${suspect.reason}</span>`;
  }

  function renderSummary(trend) {
    const s = summarize(trend);
    if (!s) {
      el("summary").textContent = "—";
      return;
    }
    const color = s.delta < 0 ? "#e66767" : s.delta > 0 ? "#199e70" : "var(--muted)";
    const span = s.days === null ? "—" : `${Math.round(s.days)} dni`;

    el("summary").innerHTML = `
      <div style="margin-bottom:6px">Ostatnia migawka: <b style="color:var(--text)">${num(s.total)}</b></div>
      <div class="stats-line">
        <span>Zmiana od pierwszej migawki: <b style="color:${color}">${signed(s.delta)}</b>
          <span style="color:${color}">(${signed(s.percent, dec)}%)</span></span>
        <span>Migawek: <b style="color:var(--text)">${s.snapshots}</b></span>
        <span>Okres: <b style="color:var(--text)">${span}</b></span>
      </div>
    `;
  }

  function renderTable(trend) {
    const rows = changeRows(trend).reverse(); // the newest at the top
    // A world with one snapshot has nothing to compare against anything. Clearing the
    // content alone left the `.card` with its border and padding — an empty box that still
    // caught the tab key (`tabindex="0"`) and was still announced as the region "Zmiany
    // populacji między migawkami", only with no content. The `#singlePoint` note above
    // already says why there is no table, so the card is to disappear entirely.
    el("changeTable").hidden = rows.length === 0;
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

  /**
   * Thresholds wider than the activity filter leave the picker: under such a filter they
   * would count exactly the same players as the matches chart, so they would collapse onto
   * it into one line that looks like confirmation of something.
   */
  function fillThresholdSelect(maxDays, preferred) {
    const usable = usableThresholds(maxDays);
    const keys = usable.map((t) => t.key).join(",");
    // The choice is read BEFORE the options are replaced. `innerHTML` on a `<select>`
    // resets the value to the first option, so reading it afterwards would always give
    // "< 24h" — dropping the user onto a series that swings by 14.7% and freezing that
    // into the link.
    const wanted = preferred ?? el("thresholdSelect").value;

    if (keys !== thresholdKeys) {
      thresholdKeys = keys;
      el("thresholdSelect").innerHTML = usable.map((t) => `<option value="${t.key}">${t.label}</option>`).join("");
    }
    const chosen = thresholdByKey(wanted, maxDays);
    if (chosen) el("thresholdSelect").value = chosen.key;

    el("thresholdSelect").disabled = usable.length === 0;
    el("actChartBox").hidden = usable.length === 0;
    el("thresholdNote").hidden = usable.length === usableThresholds(Infinity).length;
    if (!el("thresholdNote").hidden) {
      const limit = `≤ ${maxDays === 0 ? "< 24h" : `${num(maxDays)} dni`}`;
      el("thresholdNote").innerHTML =
        `<span aria-hidden="true">ℹ</span><span><b>Filtr aktywności zawęził progi.</b> ` +
        (usable.length === 0
          ? `Każdy próg jest szerszy niż filtr (${limit}), więc wykres aktywnych rysowałby tę samą linię co wykres pasujących — ukryty.`
          : `Progi szersze niż filtr (${limit}) zniknęły z wyboru: pod nim liczyłyby dokładnie tych samych graczy.`) +
        `</span>`;
    }
    return usable;
  }

  function renderHistoryStatus(loaded, expected) {
    const node = el("historyStatus");
    if (expected === 0) {
      node.textContent = "brak datowanych migawek";
      return;
    }
    if (loaded >= expected) {
      node.textContent = `${expected} ${expected === 1 ? "migawka" : "migawek"}`;
      return;
    }
    // The full set did not come together. "Wczytywanie…" may be written only while
    // something is still in flight — otherwise the status stays forever on a progress bar
    // that has stopped.
    node.textContent = progress.running
      ? `wczytywanie dokładnych danych… ${loaded} z ${expected} migawek`
      : `${loaded} z ${expected} migawek · ${progress.failed} nie wczytano`;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  /**
   * Clears the history charts. Without this, early returns from `renderHistory` left the
   * **previous world's** series on screen under the new world's heading and table —
   * tooltips showing those snapshots' dates included.
   */
  function clearHistoryCharts() {
    tickValues = [];
    entriesByTime = new Map();
    for (const id of ["popChart", "actChart", "profChart"]) {
      if (!charts[id]) continue;
      charts[id].data.datasets = [];
      charts[id].update();
    }
    // Hidden for the same reason as with a single snapshot: an empty card with a border is
    // a visible empty box and a dead tab stop. `renderTable` will bring it back once it has
    // something to show.
    el("changeTable").hidden = true;
    el("changeTable").innerHTML = "";
  }

  function renderCrossSection(filters) {
    const data = currentSnapshot();
    const base = baseTrend();
    if (!data) {
      el("stats").textContent = "Ładowanie…";
      el("matchLine").textContent = "Ładowanie…";
      // The histogram is from the previous snapshot too, until the new one arrives.
      if (charts.professionChart) {
        charts.professionChart.data.labels = [];
        charts.professionChart.data.datasets = [];
        charts.professionChart.update();
      }
      return;
    }

    const counts = countByLevel(data, filters);
    const matched = totalsFromCounts(counts).total;
    const i = base ? base.id.indexOf(el("snapshotSelect").value) : -1;

    renderMatchLine(matched, i > -1 ? base.total[i] : data.count);
    renderLevelChart(counts);
    renderStats(counts, countByActivity(data, filters), filters.maxDays, filters.professions);
  }

  function renderHistory(filters) {
    const base = baseTrend();
    if (!base) {
      el("historyStatus").textContent = "brak historii dla tego świata";
      el("summary").textContent = "—";
      clearHistoryCharts();
      return;
    }

    const allowed = new Set(historyEntries().map((e) => e.id));
    const { trend, population, loaded, expected } = buildFilteredTrend(
      base,
      cachedSnapshots(currentWorld()),
      filters,
      allowed,
    );

    renderHistoryStatus(loaded, expected);
    // The note hangs on how much is genuinely missing — not on whether anything is still in
    // flight. Otherwise a failed fetch made it disappear, leaving an incomplete chart with
    // nothing said about it.
    el("partialNote").hidden = loaded >= expected;
    if (!el("partialNote").hidden) {
      const stalled = !progress.running;
      el("partialNote").innerHTML =
        `<span aria-hidden="true">${stalled ? "⚠" : "⏳"}</span><span><b>` +
        (stalled ? "Historia jest niepełna." : "Historia dopełnia się w tle.") +
        `</b> Narysowane są tylko migawki już wczytane (${loaded} z ${expected}) — ` +
        `brakującym punktom nie podstawiamy niczego zmyślonego.` +
        (stalled && progress.failed > 0 ? ` ${progress.failed} nie udało się pobrać.` : "") +
        `</span>`;
    }

    const usable = fillThresholdSelect(filters.maxDays);
    const share = el("modeSelect").value === "udzial";

    // One point is a valid state, not an error — luvia joined in the last round.
    el("singlePoint").hidden = trend.id.length !== 1 || expected !== 1;
    el("suspectNote").hidden = !trend.suspect.some((s) => s === 1);
    el("onlineNote").hidden = usable.length === 0;

    if (trend.id.length === 0) {
      el("summary").textContent = "—";
      clearHistoryCharts();
      return;
    }

    renderSummary(trend);
    tickValues = trend.startedAt.map((s) => new Date(s).getTime());
    entriesByTime = new Map(snapshotEntries(trend).map((e) => [new Date(e.startedAt).getTime(), e]));
    renderHistoryCharts(trend, population, filters, share);
    renderTable(trend);
  }

  function render() {
    if (!manifest || !trends) return;
    writeUrlState();
    const filters = readFilters();
    renderChips(filters);
    renderCrossSection(filters);
    renderHistory(filters);
  }

  /**
   * The render and any history fetch go **together, behind the same debounce**. A fetch
   * called straight from the `input` handler started one pass per keystroke — see
   * `inFlight` in history.js.
   */
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      render();
      void ensureHistory();
    }, 150);
  }

  /**
   * With no delay — for controls that change in one step. The debounce exists so that
   * typing into a number field does not start a render per character; picking an option
   * from a list or clicking a button is a single event, so waiting 150 ms there is nothing
   * but latency the user can feel.
   */
  function renderNow() {
    clearTimeout(renderTimer);
    render();
    void ensureHistory();
  }

  // ── Fetching ──────────────────────────────────────────────────────────────

  async function loadSnapshot(entry) {
    if (!entry) return;
    const token = ++snapshotToken;
    const world = currentWorld();
    const store = cachedSnapshots(world);

    el("sourceInfo").textContent = entry.filters;
    el("snapshotMeta").textContent = formatSnapshotDate(entry);

    // The previous snapshot's error does not describe this one — cleared on both paths,
    // including when the data is already in memory and nothing is fetched.
    el("error").textContent = "";

    if (store.has(entry.id)) {
      showSuspect(store.get(entry.id).suspect);
      render();
      return;
    }

    el("stats").textContent = "Ładowanie…";
    showSuspect(null);

    try {
      const res = await fetch(entry.filters);
      if (!res.ok) throw new Error(`HTTP ${res.status} dla ${entry.filters}`);
      const json = await res.json();
      // A response to an abandoned request — the user has switched world or date.
      if (token !== snapshotToken) return;

      store.set(entry.id, toTypedSnapshot(json));
      showSuspect(json.suspect);
      render();
    } catch (e) {
      // The same guard as on success: a rejected abandoned request must not wipe out a
      // correctly rendered cross-section of another snapshot.
      if (token !== snapshotToken) return;
      el("error").textContent = describeFailure(e, "migawki przekroju");
      el("stats").textContent = "—";
      // Without this the bar stayed on the previous snapshot's numbers or on "Ładowanie…",
      // i.e. a result with nothing behind it stood next to a red error.
      el("matchLine").textContent = "—";
    }
  }

  /**
   * Pulls this world's history if the filter has stopped being the default one. Called on
   * every filter change, but does anything only once per world — the rest is a map lookup.
   */
  async function ensureHistory() {
    if (isDefaultFilters(readFilters())) {
      // The history then comes from the complete aggregate, so the failure counter from the
      // previous filter has no business describing it.
      if (progress.expected !== 0 || progress.failed !== 0) {
        progress = { loaded: 0, expected: 0, failed: 0, running: false };
        render();
      }
      return;
    }
    if (!manifest || !trends) return;

    const world = currentWorld();
    const entries = historyEntries();
    const store = cachedSnapshots(world);
    if (entries.length === 0 || loadedCount(store, entries) === entries.length) return;

    const token = worldToken;
    progress = { loaded: loadedCount(store, entries), expected: entries.length, failed: 0, running: true };
    render();

    const { failed } = await loadHistory(world, entries, {
      isStale: () => token !== worldToken,
      onProgress: (loaded, expected, failedCount) => {
        if (token !== worldToken) return;
        progress = { loaded, expected, failed: failedCount, running: true };
        scheduleRender();
      },
    });

    if (token !== worldToken) return;
    // Failed snapshots are described by `#partialNote` in the HISTORIA section, not by
    // `#error` above "PRZEKRÓJ": that bar is about the snapshot being cross-sectioned and
    // stands 1500 px away from the data in question.
    progress = { loaded: loadedCount(store, entries), expected: entries.length, failed: failed.length, running: false };
    render();
  }

  // ── The selects ───────────────────────────────────────────────────────────

  function fillWorldSelect(selected) {
    el("worldSelect").innerHTML = getWorlds()
      .map((w) => `<option value="${w.name}">${capitalize(w.name)}</option>`)
      .join("");
    if (selected && getWorlds().some((w) => w.name === selected)) el("worldSelect").value = selected;
  }

  function fillSnapshotSelect(selected) {
    const files = [...currentWorldEntries()].reverse(); // the newest at the top
    el("snapshotSelect").innerHTML = files
      .map((f) => `<option value="${f.id}">${formatSnapshotDate(f)}</option>`)
      .join("");
    if (selected && files.some((f) => f.id === selected)) el("snapshotSelect").value = selected;
  }

  async function selectAndLoad() {
    writeUrlState();
    await loadSnapshot(selectedEntry());
    await ensureHistory();
  }

  async function init() {
    try {
      const [manifestRes, trendsRes] = await Promise.all([fetch("manifest.json"), fetch("trends.json")]);
      if (!manifestRes.ok) throw new Error(`HTTP ${manifestRes.status} dla manifest.json`);
      if (!trendsRes.ok) throw new Error(`HTTP ${trendsRes.status} dla trends.json`);
      manifest = await manifestRes.json();
      trends = await trendsRes.json();

      const params = new URLSearchParams(location.search);
      const view = viewFromParams(params);
      fillWorldSelect(view.world);
      fillSnapshotSelect(view.date);
      applyFilters(filtersFromParams(params));
      fillThresholdSelect(readFilters().maxDays, view.threshold);
      el("modeSelect").value = view.share ? "udzial" : "liczba";


      // A link carrying filters is to work straight away — the history starts without
      // waiting for a mouse move.
      await selectAndLoad();
    } catch (e) {
      el("error").textContent = describeFailure(e, "indeksu migawek");
      el("stats").textContent = "—";
      el("matchLine").textContent = "—";
      // `#summary` stayed on "Ładowanie…" forever — so a line promising data that will
      // never arrive stood next to the error message.
      el("summary").textContent = "—";
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────

  el("worldSelect").addEventListener("change", async () => {
    worldToken += 1; // abandons the previous world's history
    progress = { loaded: 0, expected: 0, failed: 0, running: false };
    // The charts are cleared at once, synchronously. The first render of a new world comes
    // only after a snapshot is fetched, so without this the previous world's series stand
    // under the new heading for a few hundred milliseconds — with tooltips showing those
    // dates.
    clearHistoryCharts();
    el("historyStatus").textContent = "—";
    fillSnapshotSelect();
    await selectAndLoad();
  });
  el("snapshotSelect").addEventListener("change", selectAndLoad);

  el("onlinePreset").addEventListener("change", () => {
    const value = el("onlinePreset").value;
    el("onlineValue").value = value === "all" ? "" : value;
    renderNow();
  });

  for (const id of ["minLevel", "maxLevel", "minHonor", "maxHonor", "onlineValue"]) {
    el(id).addEventListener("input", scheduleRender);
  }
  el("profCheckboxes").addEventListener("change", scheduleRender);

  for (const id of ["thresholdSelect", "modeSelect"]) {
    el(id).addEventListener("change", renderNow);
  }

  // Literals, not a loop over an array: the test "every element fetched has its node in the
  // markup" looks for calls with the identifier written out, so an identifier hidden in a
  // variable stops being held by anything.
  const resetAndRender = () => {
    resetFilters();
    renderNow();
  };
  el("resetBtn").addEventListener("click", resetAndRender);
  el("emptyResetBtn").addEventListener("click", resetAndRender);

  // The bar's listeners are registered LAST. `test/dom_smoke.ts` calls a node's
  // first-registered listener (`handlers[0]`), so pushing anything ahead of the existing
  // bindings would change what the test actually runs.
  el("filtersToggle").addEventListener("click", (event) => {
    event.stopPropagation?.();
    setFieldsOpen(el("filterFields").hidden);
  });

  // The drawer closes like any other: Escape, or a click outside it. Without that it covers
  // the charts and the only way out is hitting the same button again.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !el("filterFields").hidden) setFieldsOpen(false);
  });
  document.addEventListener("click", (event) => {
    if (el("filterFields").hidden) return;
    if (!el("filterBar").contains?.(event.target)) setFieldsOpen(false);
  });

  el("filterChips").addEventListener("click", (event) => {
    const key = event.target?.dataset?.clear;
    if (key) clearFilterGroup(key);
  });

  init();
}

// Modules are deferred, so the document is already parsed — but should this file ever
// arrive earlier, we wait for the DOM instead of failing on a missing #id.
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupView);
  } else {
    setupView();
  }
}
