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
    // Kotwica zostaje: bez niej pierwsza zmiana filtra po kliknięciu „Historia”
    // kasowała `#historia` z adresu, więc przeładowanie wracało na górę strony.
    const hash = location.hash || "";
    const query = params.toString();
    const url = `${location.pathname}${query ? `?${query}` : ""}${hash}`;
    // `render()` leci przy każdym znaku i przy każdym pobranym pliku historii.
    // Safari przerywa po ~100 wywołaniach `replaceState` na 30 s, a wyjątek
    // wywaliłby render w połowie — więc piszemy tylko wtedy, gdy adres się zmienił.
    if (url === `${location.pathname}${location.search || ""}${hash}`) return;
    history.replaceState(null, "", url);
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

  /**
   * Wyjątek na komunikat dla człowieka. Wcześniej w pasek błędu szedł surowy tekst
   * wyjątku — „Failed to fetch” albo „HTTP 500 dla worlds/gordion/2026-…f.json” —
   * czyli komunikat po angielsku, ze ścieżką pliku i bez podpowiedzi, co zrobić.
   * Ścieżka nie znika z widoku: stoi w polu „Plik” w szufladzie filtrów.
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
        // Ten sam zapis, co w pasku i w tabeli: „12,3%” i „1 234”, nie „12.3%” i „1234”.
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
    // Pasek filtrów jest przyklejony i ma wyższy z-index niż dymek, więc górna klamra
    // musi kończyć się pod nim, a nie na 8 px od krawędzi okna.
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

  // Grupy, które kasuje krzyżyk na chipie. Nigdy pojedyncze pole: „Poziom 250-400”
  // to jeden byt dla czytającego, choć dwa `<input>` dla kodu.
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
   * Chipy aktywnych filtrów w pasku. Baymard: strony pokazujące aktywne filtry naraz
   * w panelu i jako podsumowanie nad wynikami mają wyraźnie mniej błędów użytkownika
   * niż te z jednym z tych wzorców — więc mamy oba.
   *
   * Chipy są widokiem `readFilters()`, nie własnym stanem: etykiety liczy
   * `describeFilters`, a krzyżyk pisze z powrotem do tych samych pól formularza.
   */
  function renderChips(filters) {
    const chips = describeFilters(filters);
    const box = el("filterChips");
    // Chipy są przebudowywane przy każdym renderze, więc naciśnięcie krzyżyka
    // niszczyło element, który miał focus — ten wracał na `<body>` i nie dało się
    // usunąć dwóch filtrów pod rząd z klawiatury. Zapamiętujemy więc, gdzie był.
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
    // Ten sam chip, jeśli przeżył; inaczej pierwszy pozostały; a gdy zniknął ostatni —
    // przycisk, spod którego chipy wyrastają.
    const next = buttons.find((b) => b.dataset?.clear === hadFocus) ?? buttons[0] ?? el("filtersToggle");
    next.focus?.();
  }

  function setFieldsOpen(open) {
    // Zamknięcie chowa szufladę przez `display: none`. Gdyby focus był w środku,
    // przeglądarka zrzuciłaby go na `<body>` i następny Tab startowałby od początku
    // dokumentu — więc oddajemy go przyciskowi, który szufladę otwiera.
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

    // Zero trafień to nie jest rozkład złożony z samych zer: sześć profesji i pięć
    // koszyków aktywności wypisanych jako „0” czyta się jak zepsute dane, a nie jak
    // odpowiedź „nikt nie pasuje”. To ta sama zasada, co `visibleActivityBuckets`.
    if (perProfession.every((n) => n === 0)) {
      el("stats").innerHTML =
        `<div class="stats-line">Żaden gracz w tej migawce nie spełnia filtrów — rozkładu nie ma z czego złożyć.</div>`;
      return;
    }

    // Profesja odznaczona w filtrze nie ma czego wnosić — „Mag: 0” obok wyniku
    // filtra „tylko Wojownik i Tropiciel” wygląda jak brak danych, a nie jak
    // wykluczenie. `profChart` rysuje tylko wybrane serie; tu było inaczej.
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
    // Świat z jedną migawką nie ma czego z czym porównać. Samo wyczyszczenie treści
    // zostawiało `.card` z ramką i paddingiem — puste pudełko, które nadal łapało
    // tabulator (`tabindex="0"`) i nadal było ogłaszane jako region „Zmiany populacji
    // między migawkami”, tyle że bez zawartości. Notka `#singlePoint` wyżej mówi już,
    // dlaczego tabeli nie ma, więc karta ma zniknąć w całości.
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
   * Progi szersze niż filtr aktywności znikają z wyboru: pod takim filtrem liczyłyby
   * dokładnie tych samych graczy, co wykres pasujących, więc pokrywałyby się z nim
   * w jedną linię wyglądającą na potwierdzenie czegoś.
   */
  function fillThresholdSelect(maxDays, preferred) {
    const usable = usableThresholds(maxDays);
    const keys = usable.map((t) => t.key).join(",");
    // Wybór czytamy PRZED podmianą opcji. `innerHTML` na `<select>` zeruje wartość
    // na pierwszą opcję, więc odczyt po podmianie zawsze dawałby „< 24h” — czyli
    // cofałby użytkownika na serię wahającą się o 14,7% i utrwalał to w linku.
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
    // Komplet się nie zebrał. „Wczytywanie…” wolno napisać tylko wtedy, gdy coś
    // jeszcze leci — inaczej status zostaje na zawsze na pasku postępu, który stoi.
    node.textContent = progress.running
      ? `wczytywanie dokładnych danych… ${loaded} z ${expected} migawek`
      : `${loaded} z ${expected} migawek · ${progress.failed} nie wczytano`;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  /**
   * Czyści wykresy historii. Bez tego wczesne wyjścia z `renderHistory` zostawiały
   * na ekranie serie **poprzedniego świata** pod nagłówkiem i tabelą nowego — razem
   * z dymkami pokazującymi daty tamtych migawek.
   */
  function clearHistoryCharts() {
    tickValues = [];
    entriesByTime = new Map();
    for (const id of ["popChart", "actChart", "profChart"]) {
      if (!charts[id]) continue;
      charts[id].data.datasets = [];
      charts[id].update();
    }
    // Ukrywana z tego samego powodu, co przy jednej migawce: pusta karta z ramką
    // to widoczne puste pudełko i martwy przystanek tabulatora. `renderTable`
    // odsłoni ją z powrotem, gdy będzie miała co pokazać.
    el("changeTable").hidden = true;
    el("changeTable").innerHTML = "";
  }

  function renderCrossSection(filters) {
    const data = currentSnapshot();
    const base = baseTrend();
    if (!data) {
      el("stats").textContent = "Ładowanie…";
      el("matchLine").textContent = "Ładowanie…";
      // Histogram też jest z poprzedniej migawki, dopóki nowa nie dojdzie.
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
    // Notka wisi na tym, ile realnie brakuje — nie na tym, czy coś jeszcze leci.
    // Inaczej przy nieudanym pobraniu znikała, zostawiając niepełny wykres bez słowa.
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

    // Jeden punkt to poprawny stan, nie błąd — luvia dołączyła w ostatniej rundzie.
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
   * Render i ewentualne dociągnięcie historii idą **razem, za tym samym debounce'em**.
   * Pobieranie wywoływane wprost z handlera `input` startowało jeden przelot na każdy
   * wciśnięty klawisz — patrz `inFlight` w history.js.
   */
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      render();
      void ensureHistory();
    }, 150);
  }

  /**
   * Bez zwłoki — dla kontrolek, które zmieniają się skokowo. Debounce istnieje po to,
   * żeby pisanie w polu liczbowym nie startowało renderu na każdy znak; wybór opcji
   * z listy i kliknięcie przycisku to jedno zdarzenie, więc czekanie 150 ms jest tam
   * wyłącznie opóźnieniem odczuwalnym przez użytkownika.
   */
  function renderNow() {
    clearTimeout(renderTimer);
    render();
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

    // Błąd poprzedniej migawki nie opisuje tej — czyszczony na obu ścieżkach,
    // także wtedy, gdy dane są już w pamięci i nic nie pobieramy.
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
      // Odpowiedź na porzucone żądanie — użytkownik zdążył przełączyć świat/datę.
      if (token !== snapshotToken) return;

      store.set(entry.id, toTypedSnapshot(json));
      showSuspect(json.suspect);
      render();
    } catch (e) {
      // Ten sam strażnik co przy sukcesie: odrzucenie porzuconego żądania nie może
      // skasować poprawnie wyrenderowanego przekroju innej migawki.
      if (token !== snapshotToken) return;
      el("error").textContent = describeFailure(e, "migawki przekroju");
      el("stats").textContent = "—";
      // Bez tego pasek zostawał na liczbach poprzedniej migawki albo na „Ładowanie…”,
      // czyli obok czerwonego błędu stał wynik, którego nie ma czym poprzeć.
      el("matchLine").textContent = "—";
    }
  }

  /**
   * Dociąga historię tego świata, jeśli filtr przestał być domyślny. Wywoływane przy
   * każdej zmianie filtra, ale robi coś tylko raz na świat — reszta to sprawdzenie mapy.
   */
  async function ensureHistory() {
    if (isDefaultFilters(readFilters())) {
      // Historia idzie wtedy z kompletnego agregatu, więc licznik porażek
      // z poprzedniego filtra nie ma prawa jej opisywać.
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
    // Nieudane migawki opisuje `#partialNote` w sekcji HISTORIA, a nie `#error` nad
    // PRZEKROJEM: tamten pasek dotyczy migawki przekroju i stoi 1500 px od danych,
    // o których mowa.
    progress = { loaded: loadedCount(store, entries), expected: entries.length, failed: failed.length, running: false };
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
      el("error").textContent = describeFailure(e, "indeksu migawek");
      el("stats").textContent = "—";
      el("matchLine").textContent = "—";
      // `#summary` zostawało na „Ładowanie…” na zawsze — obok komunikatu o błędzie
      // stał więc napis obiecujący dane, które nigdy nie dojdą.
      el("summary").textContent = "—";
    }
  }

  // ── Zdarzenia ─────────────────────────────────────────────────────────────

  el("worldSelect").addEventListener("change", async () => {
    worldToken += 1; // porzuca historię poprzedniego świata
    progress = { loaded: 0, expected: 0, failed: 0, running: false };
    // Gasimy wykresy od razu, synchronicznie. Pierwszy render nowego świata przychodzi
    // dopiero po pobraniu migawki, więc bez tego przez kilkaset milisekund pod nowym
    // nagłówkiem stoją serie poprzedniego świata — z dymkami pokazującymi tamte daty.
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

  // Literały, nie pętla po tablicy: test „każdy element pobierany ma swój węzeł
  // w markupie” szuka wywołań z identyfikatorem wpisanym wprost, więc identyfikator
  // schowany w zmiennej przestaje być przez cokolwiek pilnowany.
  const resetAndRender = () => {
    resetFilters();
    renderNow();
  };
  el("resetBtn").addEventListener("click", resetAndRender);
  el("emptyResetBtn").addEventListener("click", resetAndRender);

  // Listenery paska rejestrujemy NA KOŃCU. `test/dom_smoke.ts` wywołuje pierwszy
  // zarejestrowany listener węzła (`handlers[0]`), więc wepchnięcie czegokolwiek przed
  // istniejące podpięcia zmieniłoby to, co test naprawdę uruchamia.
  el("filtersToggle").addEventListener("click", (event) => {
    event.stopPropagation?.();
    setFieldsOpen(el("filterFields").hidden);
  });

  // Szuflada zamyka się jak każda inna: Escape albo klik poza nią. Bez tego zasłania
  // wykresy, a jedyne wyjście to trafienie w ten sam przycisk.
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

// Moduły są odroczone, więc dokument jest już sparsowany — ale gdyby plik
// trafił tu wcześniej, czekamy na DOM zamiast wywalać się na brakującym #id.
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupView);
  } else {
    setupView();
  }
}
