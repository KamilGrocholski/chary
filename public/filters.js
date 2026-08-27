// Filtering and counting — the core used by the view of a single snapshot and by the
// history of all of them alike. No DOM, no `fetch`, nothing run on import.
//
// It works on two representations of a snapshot at once, and has to stay that way:
//   • a raw `.f.json` — `level/profession/honor` are `number[]`, `days` is `(number|null)[]`
//   • a snapshot after the conversion in `history.js` — typed arrays, `null` stored as −1
// Only `isNeverOnline` from `shared.js` knows the difference, so there is one code path here.
//
// The strings below are Polish because a player reads them — see "Language" in AGENTS.md.

import {
  ACTIVITY_BUCKET_BOUNDS,
  NEVER_ONLINE_BUCKET,
  PROFESSION_COUNT,
  PROFESSION_NAMES,
  composeActivityCounts,
  composeProfessionCounts,
  getActivityBucket,
  isNeverOnline,
} from "./shared.js";
import { getFiniteNumberFromText, getIntegerFromText } from "./lib/number.js";
import { assertDefined } from "./lib/assert.js";

/**
 * @typedef {import("./shared.js").Filters} Filters
 * @typedef {import("./shared.js").Snapshot} Snapshot
 * @typedef {import("./shared.js").SnapshotSummary} SnapshotSummary
 * @typedef {{ key: string, label: string }} FilterChip
 */

// The bounds of the activity buckets, in days — bucket 4 is accounts never used. Disjoint,
// not cumulative, which is what the labels below have to convey: "≤ 7 dni" over the 1-7
// bucket suggested everyone from the last week, when it is only those not in "< 24h".
//
// The scale itself lives in `shared.js`, because `src/trends.ts` reads it too (§9.1).
// Re-exported under the name this module's callers already use.
export { ACTIVITY_BUCKET_BOUNDS as ACTIVITY_BOUNDS };

/**
 * A bucket's label trimmed to the active threshold — under a "14 days" filter the 8-30
 * bucket really holds 8-14 days, and that is how it is to be labelled.
 *
 * @param {number} bucket 0-4
 * @param {number} [maxDays]
 * @returns {string}
 */
export function getActivityLabel(bucket, maxDays = Infinity) {
  if (bucket === NEVER_ONLINE_BUCKET) return "nigdy";

  const [from, to] = assertDefined(ACTIVITY_BUCKET_BOUNDS[bucket], "an activity bucket outside 0-4 has no bounds");
  const hi = Math.min(to, maxDays);
  if (from === 0) return "< 24h";
  if (hi === Infinity) return `> ${from - 1} dni`;
  if (from === hi) return from === 1 ? "1 dzień" : `${from} dni`;
  return `${from}-${hi} dni`;
}

/**
 * The buckets that can be non-empty under a given threshold. Without this the view showed
 * "> 30 dni: 0 · nigdy: 0" — zeros by definition, looking like broken data.
 *
 * @param {number} [maxDays]
 * @returns {number[]}
 */
export function getVisibleActivityBuckets(maxDays = Infinity) {
  if (maxDays === Infinity) return [0, 1, 2, 3, 4];
  return ACTIVITY_BUCKET_BOUNDS.flatMap(([from], bucket) => (from <= maxDays ? [bucket] : []));
}

// ── Filters ─────────────────────────────────────────────────────────────────

/** @returns {Filters} */
export function getEmptyFilters() {
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
 *
 * @param {Filters} f
 * @returns {boolean}
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
 *
 * @param {Filters} f
 * @returns {FilterChip[]}
 */
export function describeFilters(f) {
  const n = (/** @type {number} */ value) => value.toLocaleString("pl-PL");
  /** @type {FilterChip[]} */
  const chips = [];

  const range = (/** @type {string} */ key, /** @type {string} */ name, /** @type {number} */ min, /** @type {number} */ max) => {
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
    const names = [...f.professions]
      .sort((a, b) => a - b)
      .map((p) => assertDefined(PROFESSION_NAMES[/** @type {1|2|3|4|5|6} */ (p)], `profession ${p} has a name`));
    chips.push({
      key: "prof",
      // Past two names the label pushes the bar beyond one line, and nobody reads it whole
      // anyway — at that point only the count matters.
      label: names.length === 0 ? "Żadna profesja" : names.length <= 2 ? names.join(", ") : `${names.length} z 6 profesji`,
    });
  }

  return chips;
}

/**
 * @param {Snapshot} data
 * @param {number} i
 * @param {Filters} f
 * @returns {boolean}
 */
export function isMatch(data, i, f) {
  // A row past the end is not a row: `count` is the length of every column (§9.2), so
  // this only fires on a file that broke that promise, and it must not read as a match.
  const level = data.level[i];
  const profession = data.profession[i];
  const honor = data.honor[i];
  if (level === undefined || profession === undefined || honor === undefined) return false;

  if (!level || level < f.minLevel || level > f.maxLevel) return false;
  if (!f.professions.has(profession)) return false;
  if (honor < f.minHonor || honor > f.maxHonor) return false;

  // "never online" falls out under every activity threshold — and it has to be checked
  // before the threshold, because the −1 sentinel passes every `>` comparison.
  const days = data.days[i];
  if (f.maxDays !== Infinity && (isNeverOnline(days) || /** @type {number} */ (days) > f.maxDays)) return false;
  return true;
}

// ── Counting ────────────────────────────────────────────────────────────────

/**
 * A map level → [count for professions 1..6]. Needed only by the single-snapshot view.
 *
 * @param {Snapshot} data
 * @param {Filters} f
 * @returns {Map<number, number[]>}
 */
export function countByLevel(data, f) {
  /** @type {Map<number, number[]>} */
  const counts = new Map();
  for (let i = 0; i < data.count; i++) {
    if (!isMatch(data, i, f)) continue;

    // `isMatch` above has already refused a row any column is short of.
    const level = assertDefined(data.level[i], "a matched row has a level");
    const profession = assertDefined(data.profession[i], "a matched row has a profession");
    let bucket = counts.get(level);
    if (!bucket) {
      bucket = composeProfessionCounts();
      counts.set(level, bucket);
    }
    bucket[profession - 1] = assertDefined(bucket[profession - 1], "professions are 1-6") + 1;
  }
  return counts;
}

/**
 * @param {Snapshot} data
 * @param {Filters} f
 * @returns {[number, number][]}
 */
export function countByActivity(data, f) {
  const buckets = composeActivityCounts();
  for (let i = 0; i < data.count; i++) {
    if (!isMatch(data, i, f)) continue;
    const bucket = getActivityBucket(data.days[i]);
    buckets[bucket] = assertDefined(buckets[bucket], "getActivityBucket answers 0-4") + 1;
  }
  return buckets.map((count, bucket) => /** @type {[number, number]} */ ([bucket, count]));
}

/**
 * @param {Map<number, number[]>} counts
 * @returns {{ total: number, perProfession: number[] }}
 */
export function getTotalsFromCounts(counts) {
  const perProfession = composeProfessionCounts();
  let total = 0;
  for (const row of counts.values()) {
    for (let p = 0; p < PROFESSION_COUNT; p++) {
      const count = assertDefined(row[p], "a level bucket holds six counts");
      perProfession[p] = assertDefined(perProfession[p], "six professions") + count;
      total += count;
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
 *
 * @param {Snapshot} data
 * @param {Filters} f
 * @returns {SnapshotSummary}
 */
export function summarizeFiltered(data, f) {
  const act = composeActivityCounts();
  const byProf = composeProfessionCounts();
  let total = 0;

  for (let i = 0; i < data.count; i++) {
    if (!isMatch(data, i, f)) continue;
    const bucket = getActivityBucket(data.days[i]);
    const profession = assertDefined(data.profession[i], "a matched row has a profession");
    total += 1;
    act[bucket] = assertDefined(act[bucket], "getActivityBucket answers 0-4") + 1;
    byProf[profession - 1] = assertDefined(byProf[profession - 1], "professions are 1-6") + 1;
  }
  return { total, act, byProf };
}

// ── The filter state in the URL ─────────────────────────────────────────────
//
// Without this the address in the browser's bar described the default view — somebody who
// set level 250-320 and honor > 100k got something other than what was on their screen
// after copying the address or reloading the page.

/**
 * @param {Filters} f
 * @returns {URLSearchParams}
 */
export function composeFiltersParams(f) {
  const params = new URLSearchParams();
  const put = (/** @type {string} */ key, /** @type {number} */ value) => {
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

/**
 * @param {URLSearchParams} params
 * @returns {Filters}
 */
export function readFiltersFromParams(params) {
  // A query string is text a stranger can write, so every reading may fail and every
  // failure falls back to the default rather than to a number nobody typed: `Number("")`
  // is 0, which would read as a deliberate "minimum level 0".
  const getNumberFromParam = (/** @type {string} */ key, /** @type {number} */ fallback) => {
    const raw = params.get(key);
    if (raw === null || raw === "") return fallback;
    return getFiniteNumberFromText(raw.trim()) ?? fallback;
  };

  const rawProf = params.get("prof");
  // Read and kept in one step: a `.map` then `.filter` leaves the reader's `null` in the
  // element type, and the only way back out of it is a cast (§9.5).
  const parsed = (rawProf ?? "").split(",").flatMap((part) => {
    const profession = getIntegerFromText(part.trim());
    return profession !== null && profession >= 1 && profession <= 6 ? [profession] : [];
  });

  const maxDays = getNumberFromParam("maxDays", Infinity);
  return {
    minLevel: getNumberFromParam("minLevel", -Infinity),
    maxLevel: getNumberFromParam("maxLevel", Infinity),
    minHonor: getNumberFromParam("minHonor", -Infinity),
    maxHonor: getNumberFromParam("maxHonor", Infinity),
    // A negative day threshold means nothing — we treat it as no filter rather than
    // silently showing an empty page.
    maxDays: maxDays < 0 ? Infinity : maxDays,
    professions: new Set(parsed.length > 0 ? parsed : [1, 2, 3, 4, 5, 6]),
  };
}
