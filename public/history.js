// One world's history: cumulative activity thresholds, the series for the charts, and
// fetching raw snapshots once the aggregate stops being enough.
//
// The view has two paths, and that is its entire point:
//   • the default filter → `trends.json`, 9 KB, one fetch, immediately
//   • a filter set → the `.f.json` files of that one world, up to 1.9 MB, on demand only
// Both end in an object of the same shape, so the drawing cannot tell them apart.
//
// No DOM. `fetch` yes — that is not the browser's document interface, and the tests
// substitute a stub for it.
//
// The labels below are Polish because a player reads them — see "Language" in AGENTS.md.

import { daysBetween } from "./shared.js";
import { isDefaultFilters, summarizeFiltered } from "./filters.js";

/**
 * The activity thresholds — **cumulative**, unlike the disjoint `act` buckets in the file
 * and `ACTIVITY_BOUNDS` in `filters.js`. "≤ 7 dni" is buckets 0 and 1 together; confusing
 * the two scales would give a chart understated by the whole "< 24h" bucket.
 *
 * `bound` is the highest number of days a threshold still covers — it is what detects the
 * thresholds that stop saying anything under an activity filter (`usableThresholds`).
 */
export const ACTIVITY_THRESHOLDS = [
  { key: "24h", label: "< 24h", buckets: [0], bound: 0 },
  { key: "7d", label: "≤ 7 dni", buckets: [0, 1], bound: 7 },
  { key: "30d", label: "≤ 30 dni", buckets: [0, 1, 2], bound: 30 },
];

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
export function usableThresholds(maxDays = Infinity) {
  return ACTIVITY_THRESHOLDS.filter((t) => t.bound < maxDays);
}

export function thresholdByKey(key, maxDays = Infinity) {
  const usable = usableThresholds(maxDays);
  if (usable.length === 0) return null;
  return (
    usable.find((t) => t.key === key) ??
    usable.find((t) => t.key === DEFAULT_THRESHOLD) ??
    usable[usable.length - 1]
  );
}

/** The number of active players in each snapshot at a given threshold. */
export function activeCounts(trend, key, maxDays = Infinity) {
  const threshold = thresholdByKey(key, maxDays);
  if (!threshold) return trend.total.slice();
  return trend.total.map((_, i) => threshold.buckets.reduce((sum, bucket) => sum + trend.act[bucket][i], 0));
}

/** The share of the population, as a percentage. A snapshot with no players gives 0, not NaN. */
export function shareSeries(counts, totals) {
  return counts.map((count, i) => (totals[i] > 0 ? (count / totals[i]) * 100 : 0));
}

/** Snapshots as `{ id, startedAt }` entries — the format the functions in shared.js read. */
export function snapshotEntries(trend) {
  return trend.id.map((id, i) => ({ id, startedAt: trend.startedAt[i], suspect: trend.suspect[i] === 1 }));
}

/**
 * The changes between consecutive snapshots. `perDay` matters more here than `delta`: the
 * intervals run 3-17 days, so "−120 players" on two rows of the table means two different
 * things until it is divided by time.
 *
 * That same division rescues a partially loaded history: a missing snapshot makes a longer
 * interval rather than a false jump, because `perDay` divides by real elapsed time.
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

/** A world's whole history summarised — from the first snapshot to the last. */
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

// ── The view state in the URL (everything except the filters) ───────────────
//
// `prog` and `udzial` are Polish and stay that way: they are the contract of links people
// have already shared, which is why trends.html still exists. See "Language" in AGENTS.md.

export function viewToParams(view) {
  const params = new URLSearchParams();
  if (view.world) params.set("world", view.world);
  if (view.date) params.set("date", view.date);
  if (view.threshold && view.threshold !== DEFAULT_THRESHOLD) params.set("prog", view.threshold);
  if (view.share) params.set("udzial", "1");
  return params;
}

export function viewFromParams(params) {
  const threshold = params.get("prog");
  return {
    world: params.get("world") || null,
    date: params.get("date") || null,
    threshold: ACTIVITY_THRESHOLDS.some((t) => t.key === threshold) ? threshold : DEFAULT_THRESHOLD,
    share: params.get("udzial") === "1",
  };
}

// ── Raw snapshots: conversion, memory, fetching ─────────────────────────────

/**
 * What one filtered world may cost over the wire, in gzipped bytes.
 *
 * 2 MB is the worst case the world-view spec already weighed and accepted (gordion, 1.86 MB
 * at the time). The history grows every round, so the ceiling has to be in the currency that
 * grows with it — **bytes, not snapshots**. A count treats gordion (180 KB a snapshot) and
 * brutal (19 KB) as the same purchase, which is how brutal came to be the one world trimmed:
 * it had one extra snapshot from a single-world scrape, and trimming it saved 19 KB while
 * gordion, the reason the ceiling exists at all, was untouched.
 *
 * Binary megabytes, because that is the unit the sizes next to it are quoted in.
 */
export const HISTORY_BUDGET_BYTES = 2 * 1024 * 1024;

/**
 * The fallback ceiling, used only when a world's snapshot size is unknown.
 *
 * `trends.json` and this script are separate files on Pages with separate cache lifetimes,
 * so a fresh script meeting an aggregate built before `bytes` existed is a real state, not a
 * hypothetical one. Falling back to "everything" there would hand somebody gordion's whole
 * history without asking.
 */
export const HISTORY_WINDOW = 12;

/** The last `HISTORY_WINDOW` snapshots — the entries arrive sorted by `startedAt`. */
export function windowedEntries(entries, size = HISTORY_WINDOW) {
  return entries.length <= size ? entries.slice() : entries.slice(entries.length - size);
}

/**
 * The newest entries that fit into the transfer budget — the entries arrive sorted by
 * `startedAt`.
 *
 * Two at the minimum, even when they do not fit: one point is not a trend, and a chart with
 * a single dot answers nothing that the snapshot view above it does not already answer.
 *
 * @param {number} [bytesPerSnapshot] gzip size of one snapshot; 0 or missing = unknown
 */
export function budgetedEntries(entries, bytesPerSnapshot, budget = HISTORY_BUDGET_BYTES) {
  if (!bytesPerSnapshot || bytesPerSnapshot <= 0) return windowedEntries(entries);
  const fits = Math.max(2, Math.floor(budget / bytesPerSnapshot));
  return windowedEntries(entries, fits);
}

/**
 * A raw `.f.json` → typed arrays. Plain JS arrays held for ten snapshots at once cost
 * several times the overhead; this comes to 11 B per row.
 *
 * `days` is deliberately an `Int32Array`, not an `Int16Array`: the range of real values fits
 * into 16 bits with room to spare, but an overflow would wrap to a negative number, i.e.
 * silently turn a player from years ago into an account never used. Two bytes per row is a
 * cheap price for not having that class of bug.
 */
export function toTypedSnapshot(json) {
  const count = json.count;
  const days = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const d = json.days[i];
    days[i] = d === null || d === undefined ? -1 : d;
  }

  return {
    count,
    level: Int16Array.from(json.level),
    profession: Uint8Array.from(json.profession),
    honor: Int32Array.from(json.honor),
    days,
    suspect: json.suspect ?? null,
  };
}

// The snapshots are held in memory per world. Without a ceiling, switching worlds one by
// one would collect all 21 in the tab, well over 100 MB.
const MAX_CACHED_WORLDS = 2;
const cache = new Map();

export function cachedSnapshots(world) {
  let store = cache.get(world);
  if (!store) {
    store = new Map();
    cache.set(world, store);
    while (cache.size > MAX_CACHED_WORLDS) cache.delete(cache.keys().next().value);
  }
  return store;
}

/** How many of the given snapshots are already in memory. */
export function loadedCount(store, entries) {
  return entries.reduce((n, e) => n + (store.has(e.id) ? 1 : 0), 0);
}

// Fetches in flight, one per world.
//
// Without this, every `input` event in a filter field started its own pass: the list of
// missing snapshots is computed at start, so three characters typed into "Min level" pulled
// the same set of files three times. For gordion that is 5.7 MB instead of 1.9 MB — the
// exact opposite of the promise that transfer is bought knowingly.
const inFlight = new Map();

/**
 * Fetches a world's missing snapshots, `concurrency` at a time. A second call for the same
 * world receives the pass already running instead of starting its own.
 *
 * `isStale()` lets the work be abandoned once the user has switched worlds — without it a
 * slower response would feed data into a view that no longer exists. A snapshot that could
 * not be fetched lands in `failed` and simply has no point on the chart: one broken
 * response must not take down the whole history.
 */
export function loadHistory(world, entries, options = {}) {
  const running = inFlight.get(world);
  if (running) return running;

  const run = fetchMissing(world, entries, options).finally(() => inFlight.delete(world));
  inFlight.set(world, run);
  return run;
}

async function fetchMissing(world, entries, options) {
  const { concurrency = 4, onProgress = () => {}, isStale = () => false } = options;
  const store = cachedSnapshots(world);
  const missing = entries.filter((e) => !store.has(e.id));
  const failed = [];
  let next = 0;

  const worker = async () => {
    while (next < missing.length) {
      if (isStale()) return;
      const entry = missing[next++];
      try {
        const res = await fetch(entry.filters);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${entry.filters}`);
        const json = await res.json();
        if (isStale()) return;
        store.set(entry.id, toTypedSnapshot(json));
      } catch {
        failed.push(entry.id);
      }
      onProgress(loadedCount(store, entries), entries.length, failed.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, worker));
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
 * `allowed` narrows the result to the snapshot window (`windowedEntries`). It does not
 * apply under the default filter: the aggregate is already fetched, so trimming it saves
 * nothing.
 *
 * @param {Set<string>|null} [allowed]
 */
export function buildFilteredTrend(base, store, filters, allowed = null) {
  if (isDefaultFilters(filters)) {
    return { trend: base, population: base.total, loaded: base.id.length, expected: base.id.length };
  }

  const trend = {
    id: [],
    startedAt: [],
    total: [],
    act: [[], [], [], [], []],
    byProf: [[], [], [], [], [], []],
    suspect: [],
  };
  const population = [];

  let expected = 0;
  for (let i = 0; i < base.id.length; i++) {
    if (allowed && !allowed.has(base.id[i])) continue;
    expected += 1;

    const snapshot = store.get(base.id[i]);
    if (!snapshot) continue;

    const s = summarizeFiltered(snapshot, filters);
    trend.id.push(base.id[i]);
    trend.startedAt.push(base.startedAt[i]);
    trend.suspect.push(base.suspect[i]);
    trend.total.push(s.total);
    for (let b = 0; b < 5; b++) trend.act[b].push(s.act[b]);
    for (let p = 0; p < 6; p++) trend.byProf[p].push(s.byProf[p]);
    population.push(base.total[i]);
  }

  return { trend, population, loaded: trend.id.length, expected };
}
