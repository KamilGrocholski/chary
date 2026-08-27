// The view of one world: the chosen snapshot in cross-section and the history of all of
// them, under one filter. This module is the wiring — it holds what the page knows
// (`manifest`, `trends`, what is in flight), decides when to redraw and what to fetch, and
// hands the work to the rest of `web/`: the form to `controls.ts`, the charts to
// `charts.ts`, the text panels to `panels.ts`, every lookup to `dom.ts`. All the counting
// sits in `filters.ts` and `history.ts` and is tested without a browser.
//
// Two data paths, deliberately unequal:
//   • the default filter → history from `trends.json`, fetched anyway
//   • a filter set → history computed from EVERY `.f.json` of that world, pulled only after
//     the first filter move and filling the chart in snapshot by snapshot
// Whoever does not filter does not pay a byte for the precision.
//
// The strings a reader sees are Polish — see "Language" in AGENTS.md.

import { formatSnapshotDate, type Filters, type ManifestEntry, type WorldTrend } from "@/src/shared.ts";
import {
  countByActivity,
  countByLevel,
  getTotalsFromCounts,
  isDefaultFilters,
  readFiltersFromParams,
} from "@/web/filters.ts";
import {
  buildFilteredTrend,
  getCachedSnapshots,
  loadHistory,
  getLoadedCount,
  composeTypedSnapshot,
  readViewFromParams,
} from "@/web/history.ts";
import { ResourceParseError, getJsonFromUrl } from "@/web/fetch-json.ts";
import { getElement, getField } from "@/web/dom.ts";
import { describeFailure } from "@/web/format.ts";
import { createChartBoard } from "@/web/charts.ts";
import {
  applyFilters,
  buildProfessionCheckboxes,
  clearFilterGroup,
  fillSnapshotSelect,
  fillThresholdSelect,
  fillWorldSelect,
  readFilters,
  renderChips,
  resetFilters,
  setFieldsOpen,
  writeUrlState,
  type ManifestWorld,
} from "@/web/controls.ts";
import {
  clearTable,
  renderHistoryStatus,
  renderMatchLine,
  renderStats,
  renderSummary,
  renderTable,
  showSuspect,
} from "@/web/panels.ts";

type Manifest = { worlds: ManifestWorld[] };
type Trends = { schema: number; builtAt: string; worlds: Record<string, WorldTrend> };

/**
 * How long a burst of typing is allowed to run before the view redraws and, if a filter is
 * set, before the history starts fetching. Long enough that "250" is one render rather than
 * three; short enough that letting go of the key feels like the answer arriving.
 */
const RENDER_DEBOUNCE_MS = 150;

function startView() {
  const board = createChartBoard();
  buildProfessionCheckboxes();

  let manifest: Manifest | null = null;
  let trends: Trends | null = null;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;

  // The history is bought knowingly: as long as nobody has moved the filter, `trends.json`
  // is enough and there is no reason to pull megabytes.
  let worldToken = 0; // invalidates a fetch after the world is switched
  let snapshotToken = 0; // the same for the single snapshot being cross-sectioned
  let progress = { loaded: 0, expected: 0, failed: 0, running: false };

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

  // ── Rendering ─────────────────────────────────────────────────────────────

  function renderCrossSection(filters: Filters) {
    const data = getCurrentSnapshot();
    const base = getBaseTrend();
    if (!data) {
      getElement("stats").textContent = "Ładowanie…";
      getElement("matchLine").textContent = "Ładowanie…";
      // The histogram is from the previous snapshot too, until the new one arrives.
      board.clearLevelChart();
      return;
    }

    const counts = countByLevel(data, filters);
    const matched = getTotalsFromCounts(counts).total;
    const index = base ? base.id.indexOf(getField("snapshotSelect").value) : -1;

    // The unfiltered population of this very snapshot where the aggregate knows it, and
    // the snapshot's own row count otherwise — never a count from a different snapshot.
    const population = base && index > -1 ? base.total[index] : undefined;
    renderMatchLine(matched, population ?? data.count);
    board.renderLevelChart(counts);
    renderStats(counts, countByActivity(data, filters), filters.maxDays, filters.professions);
  }

  /**
   * The history goes away as one thing — the charts and the table under them. Three early
   * returns reach for this, and clearing only the charts left the previous world's table
   * standing under the new world's heading.
   */
  function clearHistory() {
    board.clearHistoryCharts();
    clearTable();
  }

  function renderHistory(filters: Filters) {
    const base = getBaseTrend();
    if (!base) {
      getElement("historyStatus").textContent = "brak historii dla tego świata";
      getElement("summary").textContent = "—";
      clearHistory();
      return;
    }

    const dated = getDatedEntries();
    const { trend, population, loaded, expected } = buildFilteredTrend(
      base,
      getCachedSnapshots(getCurrentWorld()),
      filters,
      new Set(dated.map((entry) => entry.id)),
    );

    renderHistoryStatus(loaded, dated.length, base.bytes ?? 0, progress);
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
      clearHistory();
      return;
    }

    renderSummary(trend, base);
    board.setTimeAxis(base);
    board.renderHistoryCharts(trend, population, filters, share, getField("thresholdSelect").value);
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
      fillWorldSelect(getWorlds(), view.world);
      fillSnapshotSelect(getCurrentWorldEntries(), view.date);
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
    clearHistory();
    getElement("historyStatus").textContent = "—";
    fillSnapshotSelect(getCurrentWorldEntries());
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
    if (!key) return;
    // `clearFilterGroup` writes the fields and stops there — scheduling the redraw is this
    // module's business, like every other filter change.
    clearFilterGroup(key);
    scheduleRender();
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
