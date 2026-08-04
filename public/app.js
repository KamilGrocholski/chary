// Widok jednego świata: przekrój wybranej migawki i historia wszystkich, pod jednym
// filtrem. To jedyny moduł, który dotyka DOM-u — cała logika liczenia siedzi
// w `filters.js` i `history.js` i jest testowana bez przeglądarki.
//
// Dwie ścieżki danych, celowo nierównoważne:
//   • filtr domyślny → historia z `trends.json` (9 KB), pobranego i tak
//   • filtr ustawiony → historia liczona z `.f.json` tego świata (do 1,9 MB),
//     dociąganych dopiero po pierwszym ruchu filtrem i dopełniających wykres
//     migawka po migawce
// Kto nie filtruje, nie płaci za dokładność ani bajtem.

import { PROF, PROF_COLORS, capitalize, formatSnapshotDate, shortDate, utcTime } from "./shared.js";
import {
  activityLabel,
  countByActivity,
  countByLevel,
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
    if (!node) throw new Error(`Brak elementu #${id}`);
    return node;
  };

  let manifest = null;
  let trends = null;
  let renderTimer = null;

  // Historia jest kupowana świadomie: dopóki nikt nie ruszył filtra, `trends.json`
  // wystarcza i nie ma powodu ściągać megabajtów.
  let worldToken = 0; // unieważnia pobieranie po przełączeniu świata
  let snapshotToken = 0; // to samo dla pojedynczej migawki przekroju
  let progress = { loaded: 0, expected: 0, failed: 0, running: false };

  const charts = {};
  // Oś X jest liniowa w milisekundach epoki, więc odstępy 3-17 dni są widoczne jako
  // różne. Chart.js ma do tego skalę czasu, ale wymaga adaptera dat, którego nie
  // wendorujemy — podpisy generujemy sami, a podziałki stawiamy dokładnie w migawkach.
  let tickValues = [];
  let entriesByTime = new Map();
  let thresholdKeys = ""; // ostatnio wypełniony zestaw progów, żeby nie kasować wyboru

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

  // ── Odczyt stanu z formularza ─────────────────────────────────────────────

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

  function writeUrlState() {
    const params = filtersToParams(readFilters());
    for (const [key, value] of viewToParams(readView())) params.set(key, value);
    params.sort();
    history.replaceState(null, "", `${location.pathname}?${params}`);
  }

  // ── Dane ──────────────────────────────────────────────────────────────────

  const getWorlds = () => manifest?.worlds || [];
  const currentWorld = () => el("worldSelect").value;
  const currentWorldEntries = () => getWorlds().find((w) => w.name === currentWorld())?.files || [];
  const selectedEntry = () => currentWorldEntries().find((f) => f.id === el("snapshotSelect").value);
  const baseTrend = () => trends?.worlds[currentWorld()] ?? null;
  const currentSnapshot = () => cachedSnapshots(currentWorld()).get(el("snapshotSelect").value) ?? null;

  /** Migawki, które w ogóle mogą trafić na oś czasu: datowane i mieszczące się w oknie. */
  function historyEntries() {
    const base = baseTrend();
    if (!base) return [];
    const dated = new Set(base.id);
    return windowedEntries(currentWorldEntries().filter((e) => dated.has(e.id)));
  }

  // ── Formatowanie liczb ────────────────────────────────────────────────────

  const num = (n) => n.toLocaleString("pl-PL");
  // Ułamki też po polsku — „−5,3%” obok „23 719” zamiast „−5.3%” z dwoma konwencjami naraz.
  const dec = (n, digits = 1) =>
    n.toLocaleString("pl-PL", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const signed = (n, format = num) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${format(Math.abs(n))}`;

  // ── Wykres przekroju: poziomy według profesji ─────────────────────────────

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

    // Podmiana danych zamiast destroy()/new Chart() — filtrowanie 40 tys.
    // wierszy przy każdym znaku w polu było zauważalnie zacinające.
    charts.professionChart.data.labels = labels;
    charts.professionChart.data.datasets = datasets;
    charts.professionChart.update();
  }

  // ── Wykresy historii ──────────────────────────────────────────────────────

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
              // Godzina UTC, bo to ona tłumaczy skoki metryki „ostatnio online”.
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

  function renderHistoryCharts(trend, population, filters, share) {
    // Przy filtrze domyślnym „udział pasujących w populacji” to z definicji 100% —
    // wykres populacji zostaje wtedy w liczbach zamiast rysować płaską linię bez treści.
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
    // Jedyny wykres z sześcioma seriami, więc jako jedyny potrzebuje legendy.
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

  // ── Renderowanie tekstu ───────────────────────────────────────────────────

  function renderMatchLine(matched, population) {
    const share = population > 0 ? (matched / population) * 100 : 0;
    el("matchLine").innerHTML =
      `<span>Pasuje: <b>${num(matched)}</b></span>` +
      `<span>z ${num(population)} w tej migawce</span>` +
      `<span>(${dec(share, 1)}%)</span>`;
  }

  function renderStats(counts, activity, maxDays) {
    const { perProfession } = totalsFromCounts(counts);

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
      <div class="stats-line">${badges}</div>
      <div class="stats-line" style="margin-top:8px">${activityLine}</div>
    `;
  }

  /**
   * Scraper oznacza migawkę, której populacja spadła podejrzanie mocno — najczęściej
   * znaczy to, że ranking podczas awarii oddał mniej stron. Bez tego paska flaga
   * byłaby zapisywana dla nikogo.
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

  /**
   * Progi szersze niż filtr aktywności znikają z wyboru: pod takim filtrem liczyłyby
   * dokładnie tych samych graczy, co wykres pasujących, więc pokrywałyby się z nim
   * w jedną linię wyglądającą na potwierdzenie czegoś.
   */
  function fillThresholdSelect(maxDays, preferred) {
    const usable = usableThresholds(maxDays);
    const keys = usable.map((t) => t.key).join(",");
    if (keys !== thresholdKeys) {
      thresholdKeys = keys;
      el("thresholdSelect").innerHTML = usable.map((t) => `<option value="${t.key}">${t.label}</option>`).join("");
    }
    const chosen = thresholdByKey(preferred ?? el("thresholdSelect").value, maxDays);
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
      const failed = progress.failed > 0 ? ` · ${progress.failed} nie wczytano` : "";
      node.textContent = `${expected} ${expected === 1 ? "migawka" : "migawek"}${failed}`;
      return;
    }
    node.textContent = `wczytywanie dokładnych danych… ${loaded} z ${expected} migawek`;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function renderCrossSection(filters) {
    const data = currentSnapshot();
    const base = baseTrend();
    if (!data) {
      el("stats").textContent = "Ładowanie…";
      el("matchLine").textContent = "Ładowanie…";
      return;
    }

    const counts = countByLevel(data, filters);
    const matched = totalsFromCounts(counts).total;
    const i = base ? base.id.indexOf(el("snapshotSelect").value) : -1;

    renderMatchLine(matched, i > -1 ? base.total[i] : data.count);
    renderLevelChart(counts);
    renderStats(counts, countByActivity(data, filters), filters.maxDays);
  }

  function renderHistory(filters) {
    const base = baseTrend();
    if (!base) {
      el("historyStatus").textContent = "brak historii dla tego świata";
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
    el("partialNote").hidden = !progress.running || loaded >= expected;
    if (!el("partialNote").hidden) {
      el("partialNote").innerHTML =
        `<span aria-hidden="true">⏳</span><span><b>Historia dopełnia się w tle.</b> ` +
        `Narysowane są tylko migawki już wczytane (${loaded} z ${expected}) — brakującym punktom nie podstawiamy niczego zmyślonego.</span>`;
    }

    const usable = fillThresholdSelect(filters.maxDays);
    const share = el("modeSelect").value === "udzial";

    // Jeden punkt to poprawny stan, nie błąd — luvia dołączyła w ostatniej rundzie.
    el("singlePoint").hidden = trend.id.length !== 1 || expected !== 1;
    el("suspectNote").hidden = !trend.suspect.some((s) => s === 1);
    el("onlineNote").hidden = usable.length === 0;

    if (trend.id.length === 0) {
      el("summary").textContent = "—";
      el("changeTable").innerHTML = "";
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
    renderCrossSection(filters);
    renderHistory(filters);
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 150);
  }

  /** Zmiana filtra to moment, w którym agregat przestaje wystarczać. */
  function onFilterChange() {
    scheduleRender();
    void ensureHistory();
  }

  // ── Pobieranie ────────────────────────────────────────────────────────────

  async function loadSnapshot(entry) {
    if (!entry) return;
    const token = ++snapshotToken;
    const world = currentWorld();
    const store = cachedSnapshots(world);

    el("sourceInfo").textContent = entry.filters;
    el("snapshotMeta").textContent = formatSnapshotDate(entry);

    if (store.has(entry.id)) {
      showSuspect(store.get(entry.id).suspect);
      render();
      return;
    }

    el("error").textContent = "";
    el("stats").textContent = "Ładowanie…";
    showSuspect(null);

    try {
      const res = await fetch(entry.filters);
      if (!res.ok) throw new Error(`HTTP ${res.status} dla ${entry.filters}`);
      const json = await res.json();
      // Odpowiedź na porzucone żądanie — użytkownik zdążył przełączyć świat/datę.
      if (token !== snapshotToken) return;

      store.set(entry.id, toTypedSnapshot(json));
      showSuspect(json.suspect);
      render();
    } catch (e) {
      el("error").textContent = String(e?.message || e);
      el("stats").textContent = "—";
    }
  }

  /**
   * Dociąga historię tego świata, jeśli filtr przestał być domyślny. Wywoływane przy
   * każdej zmianie filtra, ale robi coś tylko raz na świat — reszta to sprawdzenie mapy.
   */
  async function ensureHistory() {
    if (isDefaultFilters(readFilters())) return;
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
    progress = { loaded: loadedCount(store, entries), expected: entries.length, failed: failed.length, running: false };
    if (failed.length > 0) {
      el("error").textContent = `Nie udało się pobrać ${failed.length} migawek — historia jest niepełna.`;
    }
    render();
  }

  // ── Selecty ───────────────────────────────────────────────────────────────

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

      // Link z filtrami ma działać od razu — historia startuje bez czekania na ruch myszą.
      await selectAndLoad();
    } catch (e) {
      el("error").textContent = String(e?.message || e);
      el("stats").textContent = "—";
      el("matchLine").textContent = "—";
    }
  }

  // ── Zdarzenia ─────────────────────────────────────────────────────────────

  el("worldSelect").addEventListener("change", async () => {
    worldToken += 1; // porzuca historię poprzedniego świata
    progress = { loaded: 0, expected: 0, failed: 0, running: false };
    fillSnapshotSelect();
    await selectAndLoad();
  });
  el("snapshotSelect").addEventListener("change", selectAndLoad);

  el("onlinePreset").addEventListener("change", () => {
    const value = el("onlinePreset").value;
    el("onlineValue").value = value === "all" ? "" : value;
    onFilterChange();
  });

  for (const id of ["minLevel", "maxLevel", "minHonor", "maxHonor", "onlineValue"]) {
    el(id).addEventListener("input", onFilterChange);
  }
  el("profCheckboxes").addEventListener("change", onFilterChange);

  for (const id of ["thresholdSelect", "modeSelect"]) {
    el(id).addEventListener("change", scheduleRender);
  }

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
    document.addEventListener("DOMContentLoaded", setupView);
  } else {
    setupView();
  }
}
