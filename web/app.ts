// The view of one world: the chosen snapshot in cross-section and the history of all of
// them, under one filter. This is the only module that touches the DOM — all the counting
// logic sits in `filters.ts` and `history.ts` and is tested without a browser.
//
// Two data paths, deliberately unequal:
//   • the default filter → history from `trends.json`, fetched anyway
//   • a filter set → history computed from EVERY `.f.json` of that world, pulled only after
//     the first filter move and filling the chart in snapshot by snapshot
// Whoever does not filter does not pay a byte for the precision.
//
// The strings a reader sees are Polish — see "Language" in AGENTS.md.

import {
  POLISH_LOCALE,
  PROFESSION_COLORS,
  getProfessionEntries,
  capitalize,
  formatSnapshotDate,
  formatShortDate,
  formatUtcTime,
  type Filters,
  type ManifestEntry,
  type SnapshotEntry,
  type WorldTrend,
} from "@/src/shared.ts";
import {
  getActivityLabel,
  countByActivity,
  countByLevel,
  describeFilters,
  readFiltersFromParams,
  composeFiltersParams,
  isDefaultFilters,
  getTotalsFromCounts,
  getVisibleActivityBuckets,
} from "@/web/filters.ts";
import {
  getActiveCounts,
  buildFilteredTrend,
  getCachedSnapshots,
  getChangeRows,
  loadHistory,
  getLoadedCount,
  getShareSeries,
  getSnapshotEntries,
  summarize,
  getThresholdByKey,
  composeTypedSnapshot,
  getUsableThresholds,
  readViewFromParams,
  composeViewParams,
} from "@/web/history.ts";
import { MargoStatError } from "@/web/margostat-error.ts";
import { assert, assertDefined } from "@/src/lib/assert.ts";
import { BYTES_IN_KILOBYTE, BYTES_IN_MEGABYTE } from "@/src/lib/byte-size.ts";
import { getFiniteNumberFromText, getIntegerFromText } from "@/src/lib/number.ts";
import { getMillisecondsFromIsoText } from "@/src/lib/timestamp.ts";
import { ResourceFetchError, ResourceParseError, getJsonFromUrl } from "@/web/fetch-json.ts";

type ManifestWorld = { name: string; files: ManifestEntry[] };
type Manifest = { worlds: ManifestWorld[] };
type Trends = { schema: number; builtAt: string; worlds: Record<string, WorldTrend> };

/**
 * Chart.js is vendored, minified and carries no types (§9.3). Naming the hole here is the
 * point: it is one name, in one place, rather than an implicit `any` spreading out of every
 * chart the view touches.
 */
type ChartInstance = any;

/**
 * A node this view expects `index.html` to hold.
 *
 * Its own class rather than a bare `Error` because it is the one failure here that is
 * ours: the markup and this file ship together, so a missing id means they went out of
 * step, and the code says that at a glance in a console shared with nothing.
 */
class MissingElementError extends MargoStatError {
  readonly elementId: string;

  constructor(id: string) {
    super("MissingElement", `index.html has no element #${id}`);
    this.elementId = id;
  }
}

/**
 * The theme, read from `:root` in `index.html`.
 *
 * It used to be spelled twice: 13 tokens in the stylesheet and 24 copies of eight of their
 * values in here, as `"#a0a09a"` and `"rgba(255, 255, 255, 0.06)"`. Changing `--muted`
 * repainted the page and left every chart, tooltip and legend on the old grey, and nothing
 * said so — the same fault §9.7 already forbids inside CSS, one file to the left.
 *
 * A missing token is an assertion, not a fallback: the stylesheet and this module ship in
 * the same commit, so a name that no longer resolves is our bug and not something a visitor
 * can be shown a substitute for. A colour nobody wrote is exactly §9.5's "value nobody
 * wrote" — an empty string here paints a chart in the browser's default black on black.
 *
 * Inline styles in the markup this module writes do NOT come through here: `var(--muted)`
 * in a `style="..."` resolves in the browser, so the token stays a token all the way down.
 * This object exists for Chart.js, which takes concrete colours and nothing else.
 */
/**
 * How long a burst of typing is allowed to run before the view redraws and, if a filter is
 * set, before the history starts fetching. Long enough that "250" is one render rather than
 * three; short enough that letting go of the key feels like the answer arriving.
 */
const RENDER_DEBOUNCE_MS = 150;

function getThemeTokens() {
  const style = getComputedStyle(document.documentElement);
  const requireToken = (name: string) => {
    const value = style.getPropertyValue(name).trim();
    assert(value !== "", `index.html defines the token ${name}`);
    return value;
  };
  return {
    text: requireToken("--text"),
    muted: requireToken("--muted"),
    accent: requireToken("--accent"),
    warn: requireToken("--warn"),
    ok: requireToken("--ok"),
    grid: requireToken("--grid"),
    gridSoft: requireToken("--grid-soft"),
  };
}

function startView() {
  /**
   * A node `index.html` is expected to hold.
   */
  const getElement = (id: string): HTMLElement => {
    const node = document.getElementById(id);
    if (!node) throw new MissingElementError(id);
    return node;
  };

  const theme = getThemeTokens();

  /**
   * A form control this view reads or writes.
   *
   * Its own lookup because `HTMLElement` has no `.value`, and asking a `<div>` for one is a
   * bug nothing could see while every node came back as the same type. Which ids are
   * really `<input>`s and `<select>`s is held statically: `dashboard.test.ts` reads the
   * ids passed to `field()` out of this file and checks each against the markup, so the
   * pairing is proved where it is written rather than asserted where it is used.
   */
  const getField = (id: string): HTMLInputElement | HTMLSelectElement => (getElement(id) as HTMLInputElement | HTMLSelectElement);

  /**
   * The checkable inputs inside a container — the profession checkboxes.
   */
  const getCheckboxes = (id: string, selector: string = "input"): HTMLInputElement[] =>
    ([...getElement(id).querySelectorAll(selector)] as HTMLInputElement[]);

  let manifest: Manifest | null = null;
  let trends: Trends | null = null;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;

  // The history is bought knowingly: as long as nobody has moved the filter, `trends.json`
  // is enough and there is no reason to pull megabytes.
  let worldToken = 0; // invalidates a fetch after the world is switched
  let snapshotToken = 0; // the same for the single snapshot being cross-sectioned
  let progress = { loaded: 0, expected: 0, failed: 0, running: false };

  const charts: Record<string, ChartInstance> = {};
  // The X axis is linear in epoch milliseconds, so 3-17 day intervals are visibly
  // different. Chart.js has a time scale for this, but it needs a date adapter we do not
  // vendor — so we generate the labels ourselves and put the ticks exactly at the snapshots.
  let tickValues: number[] = [];
  // The ends of the X axis, in the same epoch milliseconds. They come from the aggregate,
  // never from the drawn series: a snapshot can still be missing — one that failed to fetch,
  // or one still in flight — and an axis that shrank with it would move the left edge of the
  // chart the moment somebody typed a level, the same world silently changing the period it
  // describes.
  let axisRange: { min: number, max: number } | null = null;
  let entriesByTime: Map<number, SnapshotEntry> = new Map();
  let thresholdKeys = ""; // the last set of thresholds filled in, so the choice is not cleared

  // Chart.js arrives as a global from `vendor/`, minified and with no type information —
  // so it is named once, here, and the hole it leaves is `ChartInstance` rather than an
  // implicit `any` on every chart the view touches (§9.3).
  const Chart = ((window as any).Chart as any);
  if (Chart) {
    Chart.defaults.color = theme.muted;
    Chart.defaults.borderColor = theme.grid;
    Chart.defaults.font.family = 'ui-sans-serif, system-ui, "Segoe UI", sans-serif';
  }

  (function buildProfessionCheckboxes() {
    const container = getElement("profCheckboxes");
    getProfessionEntries().forEach(([id, name]) => {
      const color = assertDefined(PROFESSION_COLORS[id], `profession ${id} has a colour`);
      const label = document.createElement("label");
      label.style.color = color;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = String(id);
      checkbox.checked = true;
      checkbox.style.accentColor = color;
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(name));
      container.appendChild(label);
    });
  })();

  // ── Reading the state out of the form ─────────────────────────────────────

  function readFieldNumber(id: string, fallback: number): number {
    const value = getField(id).value;
    if (value === "") return fallback;
    // A field left holding something unreadable falls back rather than becoming a number:
    // `Number("")` is 0, and a "0" in `minLevel` is a filter somebody could have meant.
    return getFiniteNumberFromText(value.trim()) ?? fallback;
  }

  /**
   * A profession id out of our own markup or out of `PROFESSION_NAMES`.
   *
   * An assertion rather than a fallback: these come from `index.html` and from a constant
   * in `shared.js`, both ours, so a value that is not 1-6 means the two went out of step
   * and no reading here could repair it (§9.5).
   */
  function requireProfessionId(value: string | number): number {
    const id = assertDefined(getIntegerFromText(String(value)), `a profession id is a whole number, got "${value}"`);
    assert(id >= 1 && id <= 6, `a profession id is 1-6, got ${id}`);
    return id;
  }

  function readFilters() {
    const maxDays = readFieldNumber("onlineValue", Infinity);
    return {
      minLevel: readFieldNumber("minLevel", -Infinity),
      maxLevel: readFieldNumber("maxLevel", Infinity),
      minHonor: readFieldNumber("minHonor", -Infinity),
      maxHonor: readFieldNumber("maxHonor", Infinity),
      maxDays: maxDays < 0 ? Infinity : maxDays,
      professions: new Set(
        getCheckboxes("profCheckboxes", "input:checked").map((checkbox) => requireProfessionId(checkbox.value)),
      ),
    };
  }

  function readView() {
    return {
      world: getField("worldSelect").value,
      date: getField("snapshotSelect").value,
      threshold: getField("thresholdSelect").value,
      share: getField("modeSelect").value === "udzial",
    };
  }

  /** The inverse of readFilters — puts the state from the URL back into the form fields. */
  /**
   */
  function applyFilters(filters: Filters) {
    const setFieldValue = (id: string, value: number) => {
      getField(id).value = Number.isFinite(value) ? String(value) : "";
    };
    setFieldValue("minLevel", filters.minLevel);
    setFieldValue("maxLevel", filters.maxLevel);
    setFieldValue("minHonor", filters.minHonor);
    setFieldValue("maxHonor", filters.maxHonor);
    setFieldValue("onlineValue", filters.maxDays);
    getField("onlinePreset").value = Number.isFinite(filters.maxDays) ? String(filters.maxDays) : "all";
    for (const checkbox of getCheckboxes("profCheckboxes")) {
      checkbox.checked = filters.professions.has(requireProfessionId(checkbox.value));
    }
  }

  function resetFilters() {
    for (const id of ["minLevel", "maxLevel", "minHonor", "maxHonor", "onlineValue"]) {
      getField(id).value = "";
    }
    getField("onlinePreset").value = "all";
    for (const checkbox of getCheckboxes("profCheckboxes")) checkbox.checked = true;
  }

  function writeUrlState() {
    const params = composeFiltersParams(readFilters());
    for (const [key, value] of composeViewParams(readView())) params.set(key, value);
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
  const getCurrentWorld = () => getField("worldSelect").value;
  const getCurrentWorldEntries = () => getWorlds().find((world) => world.name === getCurrentWorld())?.files || [];
  const getSelectedEntry = () => getCurrentWorldEntries().find((filters) => filters.id === getField("snapshotSelect").value);
  const getBaseTrend = () => trends?.worlds[getCurrentWorld()] ?? null;
  const getCurrentSnapshot = () => getCachedSnapshots(getCurrentWorld()).get(getField("snapshotSelect").value) ?? null;

  /**
   * Every snapshot of this world that has a date, i.e. a place on the time axis — and, since
   * the transfer budget was removed, the whole plan: a filtered history fetches all of them.
   *
   * The intersection with the manifest is what makes it a plan rather than a wish. A
   * snapshot the aggregate knows and the manifest does not has no URL to fetch, so counting
   * it as expected would leave "the history is incomplete" standing forever.
   */
  function getDatedEntries() {
    const base = getBaseTrend();
    if (!base) return [];
    const dated = new Set(base.id);
    return getCurrentWorldEntries().filter((entry) => dated.has(entry.id));
  }

  // ── Formatting numbers ────────────────────────────────────────────────────

  const formatNumber = (value: number) => value.toLocaleString(POLISH_LOCALE);
  // Fractions in Polish too — "−5,3%" next to "23 719" rather than "−5.3%", two
  // conventions at once.
  const formatDecimal = (value: number, digits = 1) =>
    value.toLocaleString(POLISH_LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const formatSigned = (value: number, format = formatNumber) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${format(Math.abs(value))}`;
  // A transfer, as the person paying for it reads it. Under a megabyte in whole kilobytes:
  // "0,4 MB" says less than "360 KB" to somebody deciding whether to press the button.
  const formatBytes = (value: number) =>
    value >= BYTES_IN_MEGABYTE
      ? `${formatDecimal(value / BYTES_IN_MEGABYTE)} MB`
      : `${formatNumber(Math.round(value / BYTES_IN_KILOBYTE))} KB`;

  /**
   * An exception turned into a message for a person. The error bar used to carry the raw
   * exception text — "Failed to fetch", or "HTTP 500 for worlds/gordion/2026-…f.json" —
   * i.e. a message in English, with a file path and no hint about what to do. The path does
   * not disappear from the view: it stands in the "Plik" field in the filter drawer.
   */
  /**
   * What to tell the player about a failure.
   *
   * Switches on the failure's `code`, never on its message. It used to match the message
   * with a regular expression, which made every one of those English sentences load-bearing
   * — rewording `HTTP 404 — …` would have quietly changed which Polish sentence appeared,
   * with every test still green (§9.5).
   */
  /**
   * @param subject what could not be fetched, in Polish, for the sentence
   */
  function describeFailure(error: unknown, subject: string): string {
    if (error instanceof ResourceFetchError) {
      return `Nie udało się pobrać ${subject}: serwer odpowiedział kodem ${error.status}.`;
    }
    if (error instanceof MargoStatError) {
      if (error.code === "ResourceParse") {
        return `Nie udało się odczytać ${subject}: plik nie jest poprawnym JSON-em.`;
      }
    }
    return `Nie udało się pobrać ${subject} — wygląda na brak połączenia. Odśwież stronę i spróbuj ponownie.`;
  }

  // ── The cross-section chart: levels by profession ─────────────────────────

  function composeLevelChartOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        title: { display: true, text: "Level według profesji", color: theme.text, font: { size: 14, weight: "600" } },
        legend: { display: false },
        tooltip: { enabled: false, external: renderLevelTooltip },
      },
      scales: {
        y: { beginAtZero: true, stacked: true, ticks: { precision: 0 }, grid: { color: theme.grid } },
        x: { stacked: true, ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 50 }, grid: { color: theme.gridSoft } },
      },
    };
  }

  function renderLevelTooltip({ chart, tooltip }: { chart: ChartInstance, tooltip: any }) {
    let node = document.getElementById("profTooltip");
    if (!node) {
      node = document.createElement("div");
      node.id = "profTooltip";
      node.style.cssText =
        "position:fixed;pointer-events:none;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:10px 14px;font-size:13px;color:var(--text);min-width:180px;z-index:999;transition:opacity .1s";
      document.body.appendChild(node);
    }
    if (tooltip.opacity === 0) {
      node.style.opacity = "0";
      return;
    }

    const dataIndex = tooltip.dataPoints?.[0]?.dataIndex;
    if (dataIndex == null) {
      node.style.opacity = "0";
      return;
    }

    const total = chart.data.datasets.reduce((sum: number, dataset: any) => sum + (dataset.data[dataIndex] || 0), 0);
    const level = chart.data.labels[dataIndex];
    const rows = chart.data.datasets
      .map((dataset: any) => ({ label: dataset.label, color: dataset.backgroundColor, value: dataset.data[dataIndex] || 0 }))
      .filter((row: { value: number }) => row.value > 0)
      .sort((left: { value: number }, right: { value: number }) => right.value - left.value)
      .map((row: { label: string, color: string, value: number }) => {
        // The same notation as in the bar and the table: "12,3%" and "1 234", not "12.3%".
        const percentText = total ? formatDecimal((row.value / total) * 100, 1) : formatDecimal(0, 1);
        return `<div style="display:flex;align-items:center;gap:8px;margin:3px 0">
          <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${row.color};flex-shrink:0"></span>
          <span style="flex:1">${row.label}</span>
          <span style="color:var(--muted);margin-left:8px">${formatNumber(row.value)}</span>
          <span style="color:var(--accent);min-width:48px;text-align:right">${percentText}%</span>
        </div>`;
      })
      .join("");

    node.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px;color:var(--accent)">Level ${level}</div>
      ${rows}
      <div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;color:var(--muted)">Razem: <b style="color:var(--text)">${formatNumber(total)}</b></div>
    `;

    const canvasBox = chart.canvas.getBoundingClientRect();
    node.style.opacity = "1";

    // The gap the tooltip keeps from the cursor, and the one it keeps from every edge it
    // can be pushed against. Named because the second is spelled four times below and read
    // as four unrelated eights.
    const CURSOR_GAP = 12;
    const EDGE_GAP = 8;

    let x = canvasBox.left + tooltip.caretX + CURSOR_GAP;
    let y = canvasBox.top + tooltip.caretY - 10;
    if (x + node.offsetWidth > window.innerWidth - EDGE_GAP) x = canvasBox.left + tooltip.caretX - node.offsetWidth - CURSOR_GAP;
    if (y + node.offsetHeight > window.innerHeight - EDGE_GAP) y = window.innerHeight - node.offsetHeight - EDGE_GAP;
    // The filter bar is sticky and has a higher z-index than the tooltip, so the upper
    // clamp has to end below it rather than 8 px from the window's edge.
    const barBottom = getElement("filterBar").getBoundingClientRect().bottom || 0;
    if (y < barBottom + EDGE_GAP) y = barBottom + EDGE_GAP;

    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
  }

  function renderLevelChart(counts: Map<number, number[]>) {
    const labels = [...counts.keys()].sort((left, right) => left - right);
    const datasets = getProfessionEntries().map(([id, name]) => ({
      label: name,
      data: labels.map((level) => counts.get(level)?.[id - 1] || 0),
      backgroundColor: PROFESSION_COLORS[id],
      barPercentage: 1.0,
      categoryPercentage: 1.0,
    }));

    getElement("chartEmpty").hidden = labels.length > 0;
    getElement("professionChart").hidden = labels.length === 0;

    if (!charts.professionChart) {
      charts.professionChart = new Chart(getElement("professionChart"), {
        type: "bar",
        data: { labels, datasets },
        options: composeLevelChartOptions(),
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

  /**
   * @returns Chart.js's own options shape — §9.3
   */
  function composeTimeChartOptions(title: string, { percent = false }: { percent?: boolean } = {}): any {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        title: { display: true, text: title, color: theme.text, font: { size: 14, weight: "600" } },
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items: any[]) => {
              const entry = entriesByTime.get(items[0].parsed.x);
              if (!entry) return "";
              // The UTC hour, because it is what explains the jumps in "last online".
              return `${formatSnapshotDate(entry)} (${formatUtcTime(entry.startedAt)} UTC)`;
            },
            label: (item: any) => `${item.dataset.label}: ${percent ? `${formatDecimal(item.parsed.y)}%` : formatNumber(item.parsed.y)}`,
            footer: (items: any[]) => (entriesByTime.get(items[0].parsed.x)?.suspect ? "⚠ migawka może być obcięta" : ""),
          },
        },
      },
      scales: {
        y: {
          beginAtZero: percent,
          ticks: { precision: percent ? 1 : 0, callback: (value: number) => (percent ? `${formatDecimal(value)}%` : formatNumber(value)) },
          grid: { color: theme.grid },
        },
        x: {
          type: "linear",
          ...(axisRange ?? {}),
          afterBuildTicks: (axis: any) => {
            axis.ticks = tickValues.map((value) => ({ value }));
          },
          ticks: { callback: (value: number) => formatShortDate(value), maxRotation: 45, autoSkip: false },
          grid: { color: theme.gridSoft },
        },
      },
    };
  }

  /** A suspect snapshot's point is drawn hollow — otherwise a truncated scrape looks like a drop. */
  /**
   */
  function composePointStyle(trend: WorldTrend, color: string) {
    return {
      pointBackgroundColor: trend.suspect.map((suspect: number) => (suspect ? "transparent" : color)),
      pointBorderColor: trend.suspect.map((suspect: number) => (suspect ? theme.warn : color)),
      pointBorderWidth: trend.suspect.map((suspect: number) => (suspect ? 2 : 1)),
      pointRadius: trend.suspect.map((suspect: number) => (suspect ? 6 : 3)),
      pointHoverRadius: 6,
    };
  }

  function composeSeries(trend: WorldTrend, values: number[]) {
    // A point whose date cannot be read is dropped rather than placed at NaN, where
    // Chart.js draws nothing and the series silently loses a snapshot without saying so.
    return values
      .map((y: number, index: number) => ({ x: getMillisecondsFromIsoText(trend.startedAt[index]), y }))
      .filter((point: { x: number | null }) => point.x !== null);
  }

  function drawChart(id: string, datasets: any[], options: any) {
    if (!charts[id]) {
      charts[id] = new Chart(getElement(id), { type: "line", data: { datasets }, options });
      return;
    }
    charts[id].data.datasets = datasets;
    charts[id].options = options;
    charts[id].update();
  }

  /**
   * @param population the **unfiltered** population — §9.6
   */
  function renderHistoryCharts(trend: WorldTrend, population: number[], filters: Filters, share: boolean) {
    // Under the default filter, "the isMatch' share of the population" is 100% by
    // definition — so the population chart stays in counts instead of drawing a flat line.
    const filtered = !isDefaultFilters(filters);
    const popShare = share && filtered;

    drawChart(
      "popChart",
      [
        {
          label: filtered ? "Pasujących" : "Populacja",
          data: composeSeries(trend, popShare ? getShareSeries(trend.total, population) : trend.total),
          borderColor: theme.accent,
          backgroundColor: theme.accent,
          tension: 0.15,
          ...composePointStyle(trend, theme.accent),
        },
      ],
      composeTimeChartOptions(
        popShare
          ? "Udział pasujących w populacji"
          : filtered
            ? "Pasujących filtrowi w czasie"
            : "Populacja świata w czasie",
        { percent: popShare },
      ),
    );

    const threshold = getThresholdByKey(getField("thresholdSelect").value, filters.maxDays);
    if (threshold) {
      const counts = getActiveCounts(trend, threshold.key, filters.maxDays);
      drawChart(
        "actChart",
        [
          {
            label: `Aktywni ${threshold.label}`,
            data: composeSeries(trend, share ? getShareSeries(counts, population) : counts),
            borderColor: theme.ok,
            backgroundColor: theme.ok,
            tension: 0.15,
            ...composePointStyle(trend, theme.ok),
          },
        ],
        composeTimeChartOptions(
          share ? `Udział aktywnych ${threshold.label} w populacji` : `Aktywni ${threshold.label} w czasie`,
          { percent: share },
        ),
      );
    }

    const professionOptions = composeTimeChartOptions(share ? "Udział profesji w populacji" : "Profesje w czasie", {
      percent: share,
    });
    // The only chart with six series, so the only one that needs a legend. The options
    // object is Chart.js's own shape, which carries no types here (§9.3).
    (professionOptions.plugins as any).legend = {
      display: true,
      position: "bottom",
      labels: { boxWidth: 12, usePointStyle: true },
    };

    drawChart(
      "profChart",
      getProfessionEntries()
        .filter(([id]) => filters.professions.has(id))
        .map(([id, name]) => {
          const values = assertDefined(trend.byProf[id - 1], `profession ${id} has a series`);
          return {
            label: name,
            data: composeSeries(trend, share ? getShareSeries(values, population) : values),
            borderColor: PROFESSION_COLORS[id],
            backgroundColor: PROFESSION_COLORS[id],
            tension: 0.15,
            pointRadius: 3,
            pointHoverRadius: 6,
          };
        }),
      professionOptions,
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

  /** @param key one of `FILTER_GROUPS`'s keys, or "prof" */
  function clearFilterGroup(key: string) {
    if (key === "prof") {
      for (const checkbox of getCheckboxes("profCheckboxes")) checkbox.checked = true;
    } else {
      for (const id of FILTER_GROUPS[(key as keyof typeof FILTER_GROUPS)] ?? []) getField(id).value = "";
      if (key === "days") getField("onlinePreset").value = "all";
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
  function renderChips(filters: Filters) {
    const chips = describeFilters(filters);
    const box = getElement("filterChips");
    // The chips are rebuilt on every render, so pressing a close button destroyed the
    // element that held focus — focus fell back to `<body>` and two filters could not be
    // removed in a row from the keyboard. So we remember where it was.
    const active = typeof document !== "undefined" ? document.activeElement : null;
    const hadFocus =
      active && box.contains?.(active)
        ? ((active as HTMLElement).dataset?.clear ?? "")
        : null;

    box.innerHTML = chips
      .map(
        ({ key, label }) =>
          `<span class="chip" title="${label}">${label}<button type="button" data-clear="${key}" aria-label="Usuń filtr: ${label}">×</button></span>`,
      )
      .join("");
    getElement("filtersToggle").textContent = chips.length > 0 ? `Filtry (${chips.length})` : "Filtry";

    if (hadFocus === null) return;
    const buttons = [...box.querySelectorAll("button")];
    // The same chip if it survived; otherwise the first one left; and when the last one is
    // gone — the button the chips grow out from.
    const next = buttons.find((button) => button.dataset?.clear === hadFocus) ?? buttons[0] ?? getElement("filtersToggle");
    next.focus?.();
  }

  function setFieldsOpen(open: boolean) {
    // Closing hides the drawer with `display: none`. If focus were inside, the browser
    // would drop it onto `<body>` and the next Tab would start from the top of the
    // document — so we hand it to the button that opens the drawer.
    const fields = getElement("filterFields");
    const active = typeof document !== "undefined" ? document.activeElement : null;
    const focusWasInside = !open && active && fields.contains?.(active);

    fields.hidden = !open;
    getElement("filtersToggle").setAttribute("aria-expanded", String(open));
    if (focusWasInside) getElement("filtersToggle").focus?.();
  }

  function renderMatchLine(matched: number, population: number) {
    const share = population > 0 ? (matched / population) * 100 : 0;
    getElement("matchLine").innerHTML =
      `<span>Pasuje: <b>${formatNumber(matched)}</b></span>` +
      `<span>z ${formatNumber(population)}<span class="wide-only"> w tej migawce</span></span>` +
      `<span>(${formatDecimal(share, 1)}%)</span>`;
  }

  function renderStats(counts: Map<number, number[]>, activity: [number, number][], maxDays: number, professions: Set<number>) {
    const { perProfession } = getTotalsFromCounts(counts);

    // Zero isMatch is not a distribution made of zeros: six professions and five activity
    // buckets printed as "0" read like broken data, not like the answer "nobody isMatch".
    // The same principle as `getVisibleActivityBuckets`.
    if (perProfession.every((count) => count === 0)) {
      getElement("stats").innerHTML =
        `<div class="stats-line">Żaden gracz w tej migawce nie spełnia filtrów — rozkładu nie ma z czego złożyć.</div>`;
      return;
    }

    // A profession unchecked in the filter has nothing to contribute — "Mag: 0" next to
    // the result of a "Wojownik and Tropiciel only" filter looks like missing data rather
    // than exclusion. `profChart` draws only the chosen series; here it did not.
    const badges = getProfessionEntries()
      .filter(([id]) => professions.has(id))
      .map(([id, name]) => ({
        name,
        color: PROFESSION_COLORS[id],
        count: assertDefined(perProfession[id - 1], `profession ${id} has a count`),
      }))
      .sort((left, right) => right.count - left.count)
      .map(
        ({ name, color, count }) =>
          `<span style="color:${color};white-space:nowrap">${name}: <b>${formatNumber(count)}</b></span>`,
      )
      .join(" · ");

    const visible = new Set(getVisibleActivityBuckets(maxDays));
    const activityLine = activity
      .filter(([bucket]: [number, number]) => visible.has(bucket))
      .map(
        ([bucket, count]: [number, number]) =>
          `<span>${getActivityLabel(bucket, maxDays)}: <b style="color:var(--text)">${formatNumber(count)}</b></span>`,
      )
      .join(" · ");

    getElement("stats").innerHTML = `
      <div class="stats-line">${badges}</div>
      <div class="stats-line" style="margin-top:8px">${activityLine}</div>
    `;
  }

  /**
   * The scraper flags a snapshot whose population dropped suspiciously far — most often
   * that means the ranking returned fewer pages during an outage. Without this bar the flag
   * would be written for nobody.
   */
  /**
   * @param suspect written by the scraper, in Polish, for a player — §9.8
   */
  function showSuspect(suspect: { reason: string } | null | undefined) {
    const node = getElement("suspect");
    if (!suspect) {
      node.hidden = true;
      node.textContent = "";
      return;
    }
    node.hidden = false;
    node.innerHTML = `<span aria-hidden="true">⚠</span><span><b>Ta migawka może być niekompletna.</b> ${suspect.reason}</span>`;
  }

  /**
   * @param base the aggregate, which owns the time axis — §9.6
   */
  function renderSummary(trend: WorldTrend, base: WorldTrend) {
    const summary = summarize(trend);
    if (!summary) {
      getElement("summary").textContent = "—";
      return;
    }
    const color = summary.delta < 0 ? "var(--danger)" : summary.delta > 0 ? "var(--ok)" : "var(--muted)";
    const span = summary.days === null ? "—" : `${Math.round(summary.days)} dni`;
    // "Od pierwszej migawki" is a lie the moment a snapshot is missing from the front: the
    // axis still reaches April while the number counts from June. Then it says from when.
    const from =
      trend.startedAt[0] === base.startedAt[0]
        ? "pierwszej migawki"
        : formatShortDate(assertDefined(getMillisecondsFromIsoText(trend.startedAt[0]), "a drawn snapshot has a readable startedAt"));

    getElement("summary").innerHTML = `
      <div style="margin-bottom:6px">Ostatnia migawka: <b style="color:var(--text)">${formatNumber(summary.total)}</b></div>
      <div class="stats-line">
        <span>Zmiana od ${from}: <b style="color:${color}">${formatSigned(summary.delta)}</b>
          <span style="color:${color}">(${formatSigned(summary.percent, formatDecimal)}%)</span></span>
        <span>Migawek: <b style="color:var(--text)">${summary.snapshots}</b></span>
        <span>Okres: <b style="color:var(--text)">${span}</b></span>
      </div>
    `;
  }

  function renderTable(trend: WorldTrend) {
    const rows = getChangeRows(trend).reverse(); // the newest at the top
    // A world with one snapshot has nothing to compare against anything. Clearing the
    // content alone left the `.card` with its border and padding — an empty box that still
    // caught the tab key (`tabindex="0"`) and was still announced as the region "Zmiany
    // populacji między migawkami", only with no content. The `#singlePoint` note above
    // already says why there is no table, so the card is to disappear entirely.
    // Fewer than two snapshots is not a trend, and a table of changes whose every change
    // is an em dash says less than `#singlePoint` already says beside it.
    getElement("changeTable").hidden = rows.length < 2;
    if (rows.length < 2) {
      getElement("changeTable").innerHTML = "";
      return;
    }

    const body = rows
      .map(({ entry, total, delta, days, perDay }) => {
        // A change nobody can compute is grey and an em dash, never a green zero: the
        // oldest snapshot has no predecessor, and "0" there would be a measurement.
        const color = delta === null || delta === 0 ? "var(--muted)" : delta < 0 ? "var(--danger)" : "var(--ok)";
        return `<tr>
          <td>${formatSnapshotDate(entry ?? null)}${entry?.suspect ? ' <span title="migawka może być obcięta" style="color:var(--warn)">⚠</span>' : ""}</td>
          <td class="number">${days === null ? "—" : formatDecimal(days)}</td>
          <td class="number">${formatNumber(total)}</td>
          <td class="number" style="color:${color}">${delta === null ? "—" : formatSigned(delta)}</td>
          <td class="number" style="color:${color}">${perDay === null ? "—" : formatSigned(perDay, formatDecimal)}</td>
        </tr>`;
      })
      .join("");

    getElement("changeTable").innerHTML = `
      <table>
        <thead><tr><th>Migawka</th><th class="number">Odstęp (dni)</th><th class="number">Populacja</th><th class="number">Zmiana</th><th class="number">Na dobę</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    `;
  }

  /**
   * Thresholds wider than the activity filter leave the picker: under such a filter they
   * would count exactly the same players as the isMatch chart, so they would collapse onto
   * it into one line that looks like confirmation of something.
   */
  function fillThresholdSelect(maxDays: number, preferred?: string) {
    const usable = getUsableThresholds(maxDays);
    const keys = usable.map((threshold) => threshold.key).join(",");
    // The choice is read BEFORE the options are replaced. `innerHTML` on a `<select>`
    // resets the value to the first option, so reading it afterwards would always give
    // "< 24h" — dropping the user onto a series that swings by 14.7% and freezing that
    // into the link.
    const wanted = preferred ?? getField("thresholdSelect").value;

    if (keys !== thresholdKeys) {
      thresholdKeys = keys;
      getElement("thresholdSelect").innerHTML = usable.map((threshold) => `<option value="${threshold.key}">${threshold.label}</option>`).join("");
    }
    const chosen = getThresholdByKey(wanted, maxDays);
    if (chosen) getField("thresholdSelect").value = chosen.key;

    getField("thresholdSelect").disabled = usable.length === 0;
    getElement("actChartBox").hidden = usable.length === 0;
    getElement("thresholdNote").hidden = usable.length === getUsableThresholds(Infinity).length;
    if (!getElement("thresholdNote").hidden) {
      const limit = `≤ ${maxDays === 0 ? "< 24h" : `${formatNumber(maxDays)} dni`}`;
      getElement("thresholdNote").innerHTML =
        `<span aria-hidden="true">ℹ</span><span><b>Filtr aktywności zawęził progi.</b> ` +
        (usable.length === 0
          ? `Każdy próg jest szerszy niż filtr (${limit}), więc wykres aktywnych rysowałby tę samą linię co wykres pasujących — ukryty.`
          : `Progi szersze niż filtr (${limit}) zniknęły z wyboru: pod nim liczyłyby dokładnie tych samych graczy.`) +
        `</span>`;
    }
    return usable;
  }

  /**
   * The history counter, which doubles as the fetch progress bar — and, while it is running,
   * as the price of what is being fetched.
   *
   * It counts against every dated snapshot the world has, never against how many arrived:
   * "10 migawek" under a world that has 12 reads as a complete set of data, and a range
   * quietly short is worse than a range openly incomplete.
   *
   * The price is here because the transfer budget is not. Nobody is stopped at a ceiling any
   * more, so the only thing left that keeps the transfer knowingly bought is naming it while
   * it is being spent — a number nobody sees is a number bought blind.
   *
   * What it prices is what is still coming, not the whole set: snapshots already in memory
   * from an earlier filter cost nothing to draw again, and a figure that counted them would
   * overstate the transfer every time after the first.
   *
   * It is approximate and says so with a `~`: `bytes` in `trends.json` is the gzip size of
   * the world's NEWEST snapshot and the older ones are smaller, because the population grew.
   * Measured on aether, 12 × 98.5 KB = 1.15 MB against 1.156 MB actually on disk — close,
   * but a number that might be wrong may not look like one that is right (§9.6).
   *
   * @param bytes gzip size of one snapshot; 0 = not measured
   */
  function renderHistoryStatus(loaded: number, available: number, bytes: number) {
    const node = getElement("historyStatus");
    if (available === 0) {
      node.textContent = "brak datowanych migawek";
      return;
    }
    if (loaded >= available) {
      node.textContent = `${available} ${available === 1 ? "migawka" : "migawek"}`;
      return;
    }
    // Not the whole set. "Wczytywanie…" may be written only while something is still in
    // flight — otherwise the status stays forever on a progress bar that has stopped.
    const parts = [
      progress.running
        ? `wczytywanie dokładnych danych… ${loaded} z ${available} migawek`
        : `${loaded} z ${available} migawek`,
    ];
    // Absent is not zero: a world whose price was never measured gets no figure rather than
    // a "0 KB" nobody wrote (§9.5).
    if (progress.running && bytes > 0) parts.push(`~${formatBytes((available - loaded) * bytes)}`);
    if (!progress.running && progress.failed > 0) parts.push(`${progress.failed} nie wczytano`);
    node.textContent = parts.join(" · ");
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  /**
   * Clears the history charts. Without this, early returns from `renderHistory` left the
   * **previous world's** series on screen under the new world's heading and table —
   * tooltips showing those snapshots' dates included.
   */
  function clearHistoryCharts() {
    tickValues = [];
    axisRange = null;
    entriesByTime = new Map();
    for (const id of ["popChart", "actChart", "profChart"]) {
      if (!charts[id]) continue;
      charts[id].data.datasets = [];
      charts[id].update();
    }
    // Hidden for the same reason as with a single snapshot: an empty card with a border is
    // a visible empty box and a dead tab stop. `renderTable` will bring it back once it has
    // something to show.
    getElement("changeTable").hidden = true;
    getElement("changeTable").innerHTML = "";
  }

  function renderCrossSection(filters: Filters) {
    const data = getCurrentSnapshot();
    const base = getBaseTrend();
    if (!data) {
      getElement("stats").textContent = "Ładowanie…";
      getElement("matchLine").textContent = "Ładowanie…";
      // The histogram is from the previous snapshot too, until the new one arrives.
      if (charts.professionChart) {
        charts.professionChart.data.labels = [];
        charts.professionChart.data.datasets = [];
        charts.professionChart.update();
      }
      return;
    }

    const counts = countByLevel(data, filters);
    const matched = getTotalsFromCounts(counts).total;
    const index = base ? base.id.indexOf(getField("snapshotSelect").value) : -1;

    // The unfiltered population of this very snapshot where the aggregate knows it, and
    // the snapshot's own row count otherwise — never a count from a different snapshot.
    const population = base && index > -1 ? base.total[index] : undefined;
    renderMatchLine(matched, population ?? data.count);
    renderLevelChart(counts);
    renderStats(counts, countByActivity(data, filters), filters.maxDays, filters.professions);
  }

  function renderHistory(filters: Filters) {
    const base = getBaseTrend();
    if (!base) {
      getElement("historyStatus").textContent = "brak historii dla tego świata";
      getElement("summary").textContent = "—";
      clearHistoryCharts();
      return;
    }

    const dated = getDatedEntries();
    const { trend, population, loaded, expected } = buildFilteredTrend(
      base,
      getCachedSnapshots(getCurrentWorld()),
      filters,
      new Set(dated.map((entry) => entry.id)),
    );

    renderHistoryStatus(loaded, dated.length, base.bytes ?? 0);
    // The note hangs on how much is genuinely missing — not on whether anything is still in
    // flight. Otherwise a failed fetch made it disappear, leaving an incomplete chart with
    // nothing said about it.
    getElement("partialNote").hidden = loaded >= expected;
    if (!getElement("partialNote").hidden) {
      const stalled = !progress.running;
      getElement("partialNote").innerHTML =
        `<span aria-hidden="true">${stalled ? "⚠" : "⏳"}</span><span><b>` +
        (stalled ? "Historia jest niepełna." : "Historia dopełnia się w tle.") +
        `</b> Narysowane są tylko migawki już wczytane ` +
        `(${loaded} z ${expected}) — ` +
        `brakującym punktom nie podstawiamy niczego zmyślonego.` +
        (stalled && progress.failed > 0 ? ` ${progress.failed} nie udało się pobrać.` : "") +
        `</span>`;
    }

    const usable = fillThresholdSelect(filters.maxDays);
    const share = getField("modeSelect").value === "udzial";

    // One point is a valid state, not an error — luvia joined in the last round.
    getElement("singlePoint").hidden = trend.id.length !== 1 || expected !== 1;
    getElement("suspectNote").hidden = !trend.suspect.some((suspect) => suspect === 1);
    getElement("onlineNote").hidden = usable.length === 0;

    if (trend.id.length === 0) {
      getElement("summary").textContent = "—";
      clearHistoryCharts();
      return;
    }

    renderSummary(trend, base);
    // Ticks and tooltips for every snapshot the world has, not only the drawn ones: a gap
    // keeps its dates on the axis, which is what makes it visible rather than invisible.
    // Every snapshot in the aggregate carries a `startedAt` — one without it never enters
    // `trends.json`, because there is nowhere to put it on a time axis (§9.2). An
    // unreadable one here is therefore a broken aggregate, not a case to draw around.
    tickValues = base.startedAt.flatMap((isoText) => {
      const milliseconds = getMillisecondsFromIsoText(isoText);
      return milliseconds === null ? [] : [milliseconds];
    });
    const first = tickValues[0];
    const last = tickValues[tickValues.length - 1];
    axisRange = first !== undefined && last !== undefined && tickValues.length > 1 ? { min: first, max: last } : null;
    entriesByTime = new Map(
      getSnapshotEntries(base).flatMap((entry) => {
        const milliseconds = getMillisecondsFromIsoText(entry.startedAt);
        return milliseconds === null ? [] : [([milliseconds, entry] as [number, SnapshotEntry])];
      }),
    );
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
    if (renderTimer !== null) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      render();
      void ensureHistory();
    }, RENDER_DEBOUNCE_MS);
  }

  /**
   * With no delay — for controls that change in one step. The debounce exists so that
   * typing into a number field does not start a render per character; picking an option
   * from a list or clicking a button is a single event, so waiting 150 ms there is nothing
   * but latency the user can feel.
   */
  function renderNow() {
    if (renderTimer !== null) clearTimeout(renderTimer);
    render();
    void ensureHistory();
  }

  // ── Fetching ──────────────────────────────────────────────────────────────

  async function loadSnapshot(entry: ManifestEntry | undefined) {
    if (!entry) return;
    const token = ++snapshotToken;
    const world = getCurrentWorld();
    const store = getCachedSnapshots(world);

    getElement("sourceInfo").textContent = entry.filters;
    getElement("snapshotMeta").textContent = formatSnapshotDate(entry);

    // The previous snapshot's error does not describe this one — cleared on both paths,
    // including when the data is already in memory and nothing is fetched.
    getElement("error").textContent = "";

    const held = store.get(entry.id);
    if (held) {
      showSuspect(held.suspect ?? null);
      render();
      return;
    }

    getElement("stats").textContent = "Ładowanie…";
    showSuspect(null);

    try {
      const json = await getJsonFromUrl(entry.filters);
      // A response to an abandoned request — the user has switched world or date.
      if (token !== snapshotToken) return;

      const snapshot = composeTypedSnapshot(json);
      store.set(entry.id, snapshot);
      showSuspect(snapshot.suspect ?? null);
      render();
    } catch (error) {
      // The same guard as on success: a rejected abandoned request must not wipe out a
      // correctly rendered cross-section of another snapshot.
      if (token !== snapshotToken) return;
      getElement("error").textContent = describeFailure(error, "migawki przekroju");
      getElement("stats").textContent = "—";
      // Without this the bar stayed on the previous snapshot's numbers or on "Ładowanie…",
      // i.e. a result with nothing behind it stood next to a red error.
      getElement("matchLine").textContent = "—";
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

    const world = getCurrentWorld();
    const entries = getDatedEntries();
    const store = getCachedSnapshots(world);
    if (entries.length === 0 || getLoadedCount(store, entries) === entries.length) return;

    const token = worldToken;
    progress = { loaded: getLoadedCount(store, entries), expected: entries.length, failed: 0, running: true };
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
    progress = { loaded: getLoadedCount(store, entries), expected: entries.length, failed: failed.length, running: false };
    render();
  }

  // ── The selects ───────────────────────────────────────────────────────────

  /**
   * @param selected the world to keep chosen, where one is to be kept
   */
  function fillWorldSelect(selected?: string | null) {
    getElement("worldSelect").innerHTML = getWorlds()
      .map((world) => `<option value="${world.name}">${capitalize(world.name)}</option>`)
      .join("");
    if (selected && getWorlds().some((world) => world.name === selected)) getField("worldSelect").value = selected;
  }

  /**
   * @param selected the id to keep chosen, where one is to be kept
   */
  function fillSnapshotSelect(selected?: string | null) {
    const files = [...getCurrentWorldEntries()].reverse(); // the newest at the top
    getElement("snapshotSelect").innerHTML = files
      .map((filters) => `<option value="${filters.id}">${formatSnapshotDate(filters)}</option>`)
      .join("");
    if (selected && files.some((filters) => filters.id === selected)) getField("snapshotSelect").value = selected;
  }

  async function selectAndLoad() {
    writeUrlState();
    await loadSnapshot(getSelectedEntry());
    await ensureHistory();
  }

  function readManifest(json: unknown): Manifest {
    const worlds = (json as { worlds?: unknown })?.worlds;
    if (!Array.isArray(worlds)) throw new ResourceParseError("manifest.json");
    return (json as Manifest);
  }

  function readTrends(json: unknown): Trends {
    const worlds = (json as { worlds?: unknown })?.worlds;
    if (typeof worlds !== "object" || worlds === null) throw new ResourceParseError("trends.json");
    return (json as Trends);
  }

  async function loadInitialView() {
    try {
      const [manifestJson, trendsJson] = await Promise.all([
        getJsonFromUrl("manifest.json"),
        getJsonFromUrl("trends.json"),
      ]);
      // Read, not cast. Both documents are fetched over a network and served from a cache
      // that can be older than this script, so "it parsed" is not "it is what I expect" —
      // and a missing `worlds` here would surface as an empty page rather than as the
      // failure it is (§9.5).
      manifest = readManifest(manifestJson);
      trends = readTrends(trendsJson);

      const params = new URLSearchParams(location.search);
      const view = readViewFromParams(params);
      fillWorldSelect(view.world);
      fillSnapshotSelect(view.date);
      applyFilters(readFiltersFromParams(params));
      fillThresholdSelect(readFilters().maxDays, view.threshold);
      getField("modeSelect").value = view.share ? "udzial" : "liczba";


      // A link carrying filters is to work straight away — the history starts without
      // waiting for a mouse move.
      await selectAndLoad();
    } catch (error) {
      getElement("error").textContent = describeFailure(error, "indeksu migawek");
      getElement("stats").textContent = "—";
      getElement("matchLine").textContent = "—";
      // `#summary` stayed on "Ładowanie…" forever — so a line promising data that will
      // never arrive stood next to the error message.
      getElement("summary").textContent = "—";
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────

  getElement("worldSelect").addEventListener("change", async () => {
    worldToken += 1; // abandons the previous world's history
    progress = { loaded: 0, expected: 0, failed: 0, running: false };
    // The charts are cleared at once, synchronously. The first render of a new world comes
    // only after a snapshot is fetched, so without this the previous world's series stand
    // under the new heading for a few hundred milliseconds — with tooltips showing those
    // dates.
    clearHistoryCharts();
    getElement("historyStatus").textContent = "—";
    fillSnapshotSelect();
    await selectAndLoad();
  });
  getElement("snapshotSelect").addEventListener("change", selectAndLoad);

  getElement("onlinePreset").addEventListener("change", () => {
    const value = getField("onlinePreset").value;
    getField("onlineValue").value = value === "all" ? "" : value;
    renderNow();
  });

  for (const id of ["minLevel", "maxLevel", "minHonor", "maxHonor", "onlineValue"]) {
    getElement(id).addEventListener("input", scheduleRender);
  }
  getElement("profCheckboxes").addEventListener("change", scheduleRender);

  for (const id of ["thresholdSelect", "modeSelect"]) {
    getElement(id).addEventListener("change", renderNow);
  }

  // Literals, not a loop over an array: the test "every element fetched has its node in the
  // markup" looks for calls with the identifier written out, so an identifier hidden in a
  // variable stops being held by anything.
  const resetAndRender = () => {
    resetFilters();
    renderNow();
  };
  getElement("resetBtn").addEventListener("click", resetAndRender);
  getElement("emptyResetBtn").addEventListener("click", resetAndRender);

  getElement("filtersToggle").addEventListener("click", (event) => {
    event.stopPropagation?.();
    setFieldsOpen(getElement("filterFields").hidden);
  });

  // The drawer closes like any other: Escape, or a click outside it. Without that it covers
  // the charts and the only way out is hitting the same button again.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !getElement("filterFields").hidden) setFieldsOpen(false);
  });
  document.addEventListener("click", (event) => {
    if (getElement("filterFields").hidden) return;
    if (!getElement("filterBar").contains?.((event.target as Node | null))) setFieldsOpen(false);
  });

  getElement("filterChips").addEventListener("click", (event) => {
    const key = (event.target as HTMLElement | null)?.dataset?.clear;
    if (key) clearFilterGroup(key);
  });

  loadInitialView();
}

// Modules are deferred, so the document is already parsed — but should this file ever
// arrive earlier, we wait for the DOM instead of failing on a missing #id.
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startView);
  } else {
    startView();
  }
}
