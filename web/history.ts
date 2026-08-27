// One world's history: cumulative activity thresholds, the series for the charts, and
// fetching raw snapshots once the aggregate stops being enough.
//
// The view has two paths, and that is its entire point:
//   • the default filter → `trends.json`, one fetch, immediately
//   • a filter set → every `.f.json` of that one world, on demand only
// Both end in an object of the same shape, so the drawing cannot tell them apart.
//
// The second path used to stop at a transfer budget and offer the rest behind a button. It
// was removed once the sizes were read off the tree rather than feared: the whole history
// of the most expensive world is 2.1 MB gzipped and the median world 0.9 MB, so the ceiling
// was trimming one world by one snapshot while costing a note, a button and four groups of
// tests. What replaced it is the price in the status line — docs/2026-08-28-history-without-a-budget.md.
//
// No DOM. `fetch` yes — that is not the browser's document interface, and the tests
// substitute a stub for it.
//
// The labels below are Polish because a player reads them — see "Language" in AGENTS.md.

import {
  ACTIVITY_BUCKET_COUNT,
  PROFESSION_COUNT,
  composeActivitySeries,
  composeProfessionSeries,
  getActivityBucketBound,
  getDaysBetween,
  type Filters,
  type ManifestEntry,
  type SnapshotEntry,
  type TypedSnapshot,
  type WorldTrend,
} from "@/src/shared.ts";
import { isDefaultFilters, summarizeFiltered } from "@/web/filters.ts";
import { getJsonFromUrl } from "@/web/fetch-json.ts";
import { assertDefined } from "@/src/lib/assert.ts";

/** Loaded snapshots of one world, by id. */
export type SnapshotStore = Map<string, TypedSnapshot>;

export type ViewState = { world: string | null; date: string | null; threshold: string; share: boolean };

/**
 * The activity thresholds — **cumulative**, unlike the disjoint `act` buckets in the file
 * and `ACTIVITY_BOUNDS` in `filters.ts`. "≤ 7 dni" is buckets 0 and 1 together; confusing
 * the two scales would give a chart understated by the whole "< 24h" bucket.
 *
 * `bound` is the highest number of days a threshold still covers — it is what detects the
 * thresholds that stop saying anything under an activity filter (`getUsableThresholds`).
 */
export const ACTIVITY_THRESHOLDS = [
  { key: "24h", label: "< 24h", buckets: [0] },
  { key: "7d", label: "≤ 7 dni", buckets: [0, 1] },
  { key: "30d", label: "≤ 30 dni", buckets: [0, 1, 2] },
].map((threshold) => ({
  ...threshold,
  // Read off the disjoint scale rather than written again: a threshold ends where its
  // widest bucket ends, so 7 and 30 have one address (`ACTIVITY_BUCKET_BOUNDS`) and the two
  // scales cannot drift apart into a chart understated by a whole bucket.
  bound: getActivityBucketBound(assertDefined(threshold.buckets.at(-1), "a threshold covers a bucket")),
}));

// ≤ 7 days by default: "< 24h" swings by 14.7% while the population is steady at 0.6%,
// because it depends on the hour and weekday of the scrape. See
// docs/2026-08-04-spec-trends.md.
export const DEFAULT_THRESHOLD = "7d";

/**
 * The thresholds that still say something under a given activity filter.
 *
 * Once the user filters to "online ≤ 7 days", the set holds nobody past seven days — the
 * "≤ 7 dni" threshold equals the match count, and "≤ 30 dni" likewise. Three lines on top
 * of each other look like confirmation of something, while being the same question asked
 * three times, so a threshold wider than the filter simply leaves the picker.
 */
export function getUsableThresholds(maxDays = Infinity): typeof ACTIVITY_THRESHOLDS {
  return ACTIVITY_THRESHOLDS.filter((threshold) => threshold.bound < maxDays);
}

export function getThresholdByKey(
  key: string | null,
  maxDays = Infinity,
): (typeof ACTIVITY_THRESHOLDS)[number] | null {
  const usable = getUsableThresholds(maxDays);
  if (usable.length === 0) return null;
  return (
    usable.find((threshold) => threshold.key === key) ??
    usable.find((threshold) => threshold.key === DEFAULT_THRESHOLD) ??
    // `usable` is non-empty here — the line above returned for the empty case.
    assertDefined(usable[usable.length - 1], "a non-empty threshold list has a last entry")
  );
}

/**
 * The number of active players in each snapshot at a given threshold.
 */
export function getActiveCounts(trend: WorldTrend, key: string | null, maxDays = Infinity): number[] {
  const threshold = getThresholdByKey(key, maxDays);
  if (!threshold) return trend.total.slice();
  return trend.total.map((_, index) =>
    threshold.buckets.reduce(
      (sum, bucket) => sum + assertDefined(trend.act[bucket]?.[index], "every activity bucket has a count per snapshot"),
      0,
    ),
  );
}

/**
 * The share of the population, as a percentage. A snapshot with no players gives 0, not NaN.
 *
 * @param totals the **unfiltered** population — §9.6
 */
export function getShareSeries(counts: number[], totals: number[]): number[] {
  return counts.map((count, index) => {
    const total = totals[index] ?? 0;
    return total > 0 ? (count / total) * 100 : 0;
  });
}

/**
 * Snapshots as `{ id, startedAt }` entries — the format the functions in shared.ts read.
 */
export function getSnapshotEntries(trend: WorldTrend): SnapshotEntry[] {
  return trend.id.map((id, index) => ({ id, startedAt: trend.startedAt[index], suspect: trend.suspect[index] === 1 }));
}

/**
 * One row per snapshot, carrying the change from the one before it. `perDay` matters more
 * here than `delta`: the intervals run 3-17 days, so "−120 players" on two rows of the
 * table means two different things until it is divided by time.
 *
 * That same division rescues a partially loaded history: a missing snapshot makes a longer
 * interval rather than a false jump, because `perDay` divides by real elapsed time.
 *
 * The oldest snapshot gets a row too, with `days`, `delta` and `perDay` all `null`. It used
 * to be skipped — the loop started at 1, because a change needs a predecessor — and the
 * table it feeds is headed "Migawka", so the row that was never there read as a snapshot
 * missing from the data. A reader counting rows against the chart beside them found one
 * short in every world.
 */
export function getChangeRows(trend: WorldTrend) {
  const entries = getSnapshotEntries(trend);
  const rows = [];

  for (let index = 0; index < entries.length; index++) {
    const total = assertDefined(trend.total[index], "every snapshot has a population");
    // The oldest snapshot is a row like any other, and its change is UNKNOWN rather than
    // zero. It used to be left out entirely, which read as a snapshot missing from the
    // data rather than as a transition that does not exist: the table is headed "Migawka",
    // so a reader counts rows against the chart beside it and finds one short (§9.6 — keep
    // unknown and zero apart, and a hole is named where it falls).
    const previous = index > 0 ? trend.total[index - 1] : undefined;
    const days = index > 0 ? getDaysBetween(entries[index - 1], entries[index]) : null;
    const delta = previous === undefined ? null : total - previous;
    rows.push({
      entry: entries[index],
      total,
      delta,
      days,
      perDay: delta !== null && days && days > 0 ? delta / days : null,
    });
  }
  return rows;
}

/**
 * A world's whole history summarised — from the first snapshot to the last.
 */
export function summarize(trend: WorldTrend) {
  const last = trend.total.length - 1;
  if (last < 0) return null;

  const entries = getSnapshotEntries(trend);
  const first = assertDefined(trend.total[0], "a history with a last snapshot has a first");
  const total = assertDefined(trend.total[last], "a history with a last snapshot has its population");
  const delta = total - first;
  return {
    snapshots: trend.total.length,
    total,
    delta,
    percent: first > 0 ? (delta / first) * 100 : 0,
    days: getDaysBetween(entries[0], entries[last]),
  };
}

// ── The view state in the URL (everything except the filters) ───────────────
//
// `prog` and `udzial` are Polish and stay that way: they are the contract of links people
// have already shared, which is why trends.html still exists. See "Language" in AGENTS.md.

export function composeViewParams(view: ViewState): URLSearchParams {
  const params = new URLSearchParams();
  if (view.world) params.set("world", view.world);
  if (view.date) params.set("date", view.date);
  if (view.threshold && view.threshold !== DEFAULT_THRESHOLD) params.set("prog", view.threshold);
  if (view.share) params.set("udzial", "1");
  return params;
}

export function readViewFromParams(params: URLSearchParams): ViewState {
  const threshold = params.get("prog");
  return {
    world: params.get("world") || null,
    date: params.get("date") || null,
    threshold:
      threshold !== null && ACTIVITY_THRESHOLDS.some((known) => known.key === threshold) ? threshold : DEFAULT_THRESHOLD,
    share: params.get("udzial") === "1",
  };
}

// ── Raw snapshots: conversion, memory, fetching ─────────────────────────────

/**
 * A raw `.f.json` → typed arrays. Plain JS arrays held for ten snapshots at once cost
 * several times the overhead; this comes to 11 B per row.
 *
 * `days` is deliberately an `Int32Array`, not an `Int16Array`: the range of real values fits
 * into 16 bits with room to spare, but an overflow would wrap to a negative number, i.e.
 * silently turn a player from years ago into an account never used. Two bytes per row is a
 * cheap price for not having that class of bug.
 *
 * @param json a parsed `.f.json`
 */
export function composeTypedSnapshot(json: unknown): TypedSnapshot {
  // The one place a fetched `.f.json` becomes ours. Read rather than cast: a truncated
  // file parses as perfectly good JSON, and every column below would then be `undefined`
  // — which `Int16Array.from` turns into a snapshot full of zeros rather than an error
  // anybody could see (§9.5).
  const file = json as Record<string, unknown>;
  const rows = assertDefined(file.count, "a .f.json states its row count") as number;

  const source = {
    level: file.level as number[],
    profession: file.profession as number[],
    honor: file.honor as number[],
    days: file.days as (number | null)[],
  };
  for (const [column, values] of Object.entries(source)) {
    assertDefined(values, `a .f.json holds a ${column} column`);
  }

  const days = new Int32Array(rows);
  for (let index = 0; index < rows; index++) {
    const date = source.days[index];
    days[index] = date === null || date === undefined ? -1 : date;
  }

  return {
    count: rows,
    level: Int16Array.from(source.level),
    profession: Uint8Array.from(source.profession),
    honor: Int32Array.from(source.honor),
    days,
    // Read for the one field the view draws. The scraper writes four; naming only the
    // sentence keeps this type honest about what is actually consumed (§9.2).
    suspect: (file.suspect ?? null) as { reason: string } | null,
  };
}

// The snapshots are held in memory per world. Without a ceiling, switching worlds one by
// one would collect all 21 in the tab, well over 100 MB.
const MAX_CACHED_WORLDS = 2;
const cache = new Map<string, SnapshotStore>();

export function getCachedSnapshots(world: string): SnapshotStore {
  let store = cache.get(world);
  if (!store) {
    store = new Map();
    cache.set(world, store);
    while (cache.size > MAX_CACHED_WORLDS) {
      // The oldest world in insertion order. A Map with more entries than the ceiling
      // always has a first key, so there is nothing here to answer `undefined`.
      cache.delete(assertDefined(cache.keys().next().value, "a Map over its ceiling has a first key"));
    }
  }
  return store;
}

/**
 * How many of the given snapshots are already in memory.
 */
export function getLoadedCount(store: SnapshotStore, entries: SnapshotEntry[]): number {
  return entries.reduce((loaded, entry) => loaded + (store.has(entry.id) ? 1 : 0), 0);
}

// Fetches in flight, one per world.
//
// Without this, every `input` event in a filter field started its own pass: the list of
// missing snapshots is computed at start, so three characters typed into "Min level" pulled
// the same set of files three times. For gordion that is 5.7 MB instead of 1.9 MB — the
// exact opposite of the promise that transfer is bought knowingly.
export type FetchOptions = {
  concurrency?: number;
  onProgress?: (loaded: number, total: number, failed: number) => void;
  /** Answers true once the reader has moved on. */
  isStale?: () => boolean;
};

type HistoryReading = { store: SnapshotStore; failed: string[] };

const inFlight = new Map<string, Promise<HistoryReading>>();

/**
 * Fetches a world's missing snapshots, `concurrency` at a time. A second call for the same
 * world receives the pass already running instead of starting its own.
 *
 * `isStale()` lets the work be abandoned once the user has switched worlds — without it a
 * slower response would feed data into a view that no longer exists. A snapshot that could
 * not be fetched lands in `failed` and simply has no point on the chart: one broken
 * response must not take down the whole history.
 */
export function loadHistory(
  world: string,
  entries: ManifestEntry[],
  options: FetchOptions = {},
): Promise<HistoryReading> {
  const running = inFlight.get(world);
  if (running) return running;

  const loading = loadMissingSnapshots(world, entries, options).finally(() => inFlight.delete(world));
  inFlight.set(world, loading);
  return loading;
}

async function loadMissingSnapshots(
  world: string,
  entries: ManifestEntry[],
  options: FetchOptions,
): Promise<HistoryReading> {
  const { concurrency = 4, onProgress = () => {}, isStale = () => false } = options;
  const store = getCachedSnapshots(world);
  const missing = entries.filter((entry) => !store.has(entry.id));
  const failed: string[] = [];
  let nextIndex = 0;

  const runWorker = async () => {
    while (nextIndex < missing.length) {
      if (isStale()) return;
      const entry = missing[nextIndex++];
      if (entry === undefined) return;
      try {
        const json = await getJsonFromUrl(entry.filters);
        if (isStale()) return;
        store.set(entry.id, composeTypedSnapshot(json));
      } catch {
        // The boundary with the network (§9.5): whatever came back, this snapshot is not
        // loaded. It gets no point and no substitute — a hole stays a hole, and `perDay`
        // divides by the real elapsed time, so the chart stays honest about the gap.
        failed.push(entry.id);
      }
      onProgress(getLoadedCount(store, entries), entries.length, failed.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, runWorker));
  return { store, failed };
}

/**
 * History under a filter — the same shape as a world's entry in `trends.json`.
 *
 * Under the default filter it returns the aggregate without touching anything: this is the
 * path on which nobody who does not filter pays a byte over 9 KB.
 *
 * With a filter set it computes from the loaded snapshots — and from **only** those. A
 * snapshot not yet fetched gets no point; it may be neither interpolated nor backfilled
 * with the unfiltered number from the aggregate, because the chart would then show a jump
 * that is not in the data.
 *
 * `population` is always the **unfiltered** population of those same snapshots — the
 * denominator for "share" mode. A share computed against the filtered set would sum to 100%
 * and say nothing.
 *
 * `allowed` is the set of snapshots the view actually plans to fetch — `trends.json`
 * intersected with the manifest, not a ceiling. Without it `expected` would count snapshots
 * no fetch is ever planned for, and "the history is incomplete" would stand forever. It does
 * not apply under the default filter: the aggregate is already fetched, so narrowing it
 * saves nothing.
 */
export function buildFilteredTrend(
  base: WorldTrend,
  store: SnapshotStore,
  filters: Filters,
  allowed: Set<string> | null = null,
): { trend: WorldTrend; population: number[]; loaded: number; expected: number } {
  if (isDefaultFilters(filters)) {
    return { trend: base, population: base.total, loaded: base.id.length, expected: base.id.length };
  }

  const trend: WorldTrend = {
    id: [],
    startedAt: [],
    total: [],
    act: composeActivitySeries(),
    byProf: composeProfessionSeries(),
    suspect: [],
    // Not spent on this path: the snapshots are already fetched by the time a filtered
    // trend is built, so there is nothing left to price.
    bytes: base.bytes,
  };
  const population: number[] = [];

  let expected = 0;
  for (let index = 0; index < base.id.length; index++) {
    // Every column of the aggregate is the same length — that is what columnar means
    // (§9.2) — so a short one is a broken file rather than a snapshot to skip.
    const id = assertDefined(base.id[index], "every column of trends.json is the same length");
    if (allowed && !allowed.has(id)) continue;
    expected += 1;

    const snapshot = store.get(id);
    // A snapshot that did not load gets no point: no interpolation, no substituting the
    // unfiltered number from the aggregate. The hole stays a hole — §9.6.
    if (!snapshot) continue;

    const summary = summarizeFiltered(snapshot, filters);
    trend.id.push(id);
    trend.startedAt.push(assertDefined(base.startedAt[index], "every column of trends.json is the same length"));
    trend.suspect.push(assertDefined(base.suspect[index], "every column of trends.json is the same length"));
    trend.total.push(summary.total);
    for (let bucket = 0; bucket < ACTIVITY_BUCKET_COUNT; bucket++) {
      assertDefined(trend.act[bucket], "five activity buckets").push(assertDefined(summary.act[bucket], "five activity buckets"));
    }
    for (let profession = 0; profession < PROFESSION_COUNT; profession++) {
      assertDefined(trend.byProf[profession], "six professions").push(assertDefined(summary.byProf[profession], "six professions"));
    }
    population.push(assertDefined(base.total[index], "every column of trends.json is the same length"));
  }

  return { trend, population, loaded: trend.id.length, expected };
}
