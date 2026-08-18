// Filtering and counting — the core used by the view of a single snapshot and by the
// history of all of them alike. No DOM, no `fetch`, nothing run on import.
//
// It works on two representations of a snapshot at once, and has to stay that way:
//   • a raw `.f.json` — `level/profession/honor` are `number[]`, `days` is `(number|null)[]`
//   • a snapshot after the conversion in `history.js` — typed arrays, `null` stored as −1
// Only `isNeverOnline` from `shared.js` knows the difference, so there is one code path here.
//
// The strings below are Polish because a player reads them — see "Language" in AGENTS.md.

import { PROF, activityBucket, isNeverOnline } from "./shared.js";

// The bounds of the activity buckets (in days). Bucket 4 is accounts never used.
// The buckets are disjoint, not cumulative — the labels have to convey that, because
// "≤ 7 dni" over the 1-7 bucket suggested it was everyone from the last week, when it is
// only those not in the "< 24h" bucket.
export const ACTIVITY_BOUNDS = [
  [0, 0],
  [1, 7],
  [8, 30],
  [31, Infinity],
];

/**
 * A bucket's label trimmed to the active threshold — under a "14 days" filter the 8-30
 * bucket really holds 8-14 days, and that is how it is to be labelled.
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
 * The buckets that can be non-empty under a given threshold. Without this the view showed
 * "> 30 dni: 0 · nigdy: 0" — zeros by definition, looking like broken data.
 */
export function visibleActivityBuckets(maxDays = Infinity) {
  if (maxDays === Infinity) return [0, 1, 2, 3, 4];
  return ACTIVITY_BOUNDS.map(([from], bucket) => (from <= maxDays ? bucket : null)).filter((b) => b !== null);
}

// ── Filters ─────────────────────────────────────────────────────────────────

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

/**
 * Whether the filter rejects nothing. This is not cosmetic: under the default filter the
 * history view takes the ready-made `trends.json` (9 KB) instead of fetching one world's
 * snapshots (up to 1.9 MB). The whole lazy fetching path hangs on this function.
 */
export function isDefaultFilters(f) {
  return (
    f.minLevel === -Infinity &&
    f.maxLevel === Infinity &&
    f.minHonor === -Infinity &&
    f.maxHonor === Infinity &&
    f.maxDays === Infinity &&
    f.professions.size === 6
  );
}

/**
 * The active filters as a list of chips — the only place turning a filter into labels.
 *
 * `key` says which **group** of controls the chip's close button clears; never a single
 * field, because "Poziom 250-400" is one thing to the reader though two `<input>`s to the
 * code.
 *
 * The chips are a view of `readFilters()`, not separate state — otherwise they would be a
 * second place able to drift from the form.
 */
export function describeFilters(f) {
  const n = (value) => value.toLocaleString("pl-PL");
  const chips = [];

  const range = (key, name, min, max) => {
    const hasMin = Number.isFinite(min);
    const hasMax = Number.isFinite(max);
    if (!hasMin && !hasMax) return;
    chips.push({
      key,
      label: hasMin && hasMax ? `${name} ${n(min)}-${n(max)}` : hasMin ? `${name} ≥ ${n(min)}` : `${name} ≤ ${n(max)}`,
    });
  };

  range("level", "Poziom", f.minLevel, f.maxLevel);
  range("honor", "Honor", f.minHonor, f.maxHonor);

  if (Number.isFinite(f.maxDays)) {
    const days = f.maxDays === 1 ? "1 dzień" : `${n(f.maxDays)} dni`;
    chips.push({ key: "days", label: f.maxDays === 0 ? "Online < 24h" : `Online ≤ ${days}` });
  }

  if (f.professions.size !== 6) {
    const names = [...f.professions].sort((a, b) => a - b).map((p) => PROF[p]);
    chips.push({
      key: "prof",
      // Past two names the label pushes the bar beyond one line, and nobody reads it whole
      // anyway — at that point only the count matters.
      label: names.length === 0 ? "Żadna profesja" : names.length <= 2 ? names.join(", ") : `${names.length} z 6 profesji`,
    });
  }

  return chips;
}

export function matches(data, i, f) {
  const level = data.level[i];
  if (!level || level < f.minLevel || level > f.maxLevel) return false;
  if (!f.professions.has(data.profession[i])) return false;

  const honor = data.honor[i];
  if (honor < f.minHonor || honor > f.maxHonor) return false;

  // "never online" falls out under every activity threshold — and it has to be checked
  // before the threshold, because the −1 sentinel passes every `>` comparison.
  const days = data.days[i];
  if (f.maxDays !== Infinity && (isNeverOnline(days) || days > f.maxDays)) return false;
  return true;
}

// ── Counting ────────────────────────────────────────────────────────────────

/** A map level → [count for professions 1..6]. Needed only by the single-snapshot view. */
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

/**
 * A snapshot summarised under a filter — **the shape of a `trends.json` row**, only
 * computed on the client and with a filter applied. That is what lets the history charts
 * receive exactly the data they used to draw from the aggregate, needing not one line of
 * new drawing code.
 *
 * One pass, not three: across a world's whole history, `countByLevel` and `countByActivity`
 * separately would mean 2N passes over the array instead of N.
 *
 * Under the default filter it must give number for number what `summarizeSnapshot` from
 * `src/trends.ts` computed on the server — a test over every snapshot holds this.
 */
export function summarizeFiltered(data, f) {
  const act = [0, 0, 0, 0, 0];
  const byProf = [0, 0, 0, 0, 0, 0];
  let total = 0;

  for (let i = 0; i < data.count; i++) {
    if (!matches(data, i, f)) continue;
    total += 1;
    act[activityBucket(data.days[i])] += 1;
    byProf[data.profession[i] - 1] += 1;
  }
  return { total, act, byProf };
}

// ── The filter state in the URL ─────────────────────────────────────────────
//
// Without this the address in the browser's bar described the default view — somebody who
// set level 250-320 and honor > 100k got something other than what was on their screen
// after copying the address or reloading the page.

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
    // A negative day threshold means nothing — we treat it as no filter rather than
    // silently showing an empty page.
    maxDays: maxDays < 0 ? Infinity : maxDays,
    professions: new Set(parsed.length > 0 ? parsed : [1, 2, 3, 4, 5, 6]),
  };
}
