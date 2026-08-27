// Filtering and counting — the core used by the view of a single snapshot and by the
// history of all of them alike. No DOM, no `fetch`, nothing run on import.
//
// It works on two representations of a snapshot at once, and has to stay that way:
//   • a raw `.f.json` — `level/profession/honor` are `number[]`, `days` is `(number|null)[]`
//   • a snapshot after the conversion in `history.ts` — typed arrays, `null` stored as −1
// Only `isNeverOnline` from `shared.ts` knows the difference, so there is one code path here.
//
// The strings below are Polish because a player reads them — see "Language" in AGENTS.md.

import {
  ACTIVITY_BUCKET_BOUNDS,
  NEVER_ONLINE_BUCKET,
  POLISH_LOCALE,
  PROFESSION_COUNT,
  PROFESSION_NAMES,
  composeActivityCounts,
  composeProfessionCounts,
  getActivityBucket,
  isNeverOnline,
  type Filters,
  type Snapshot,
  type SnapshotSummary,
} from "@/src/shared.ts";
import { getFiniteNumberFromText, getIntegerFromText } from "@/src/lib/number.ts";
import { assertDefined } from "@/src/lib/assert.ts";

export type FilterChip = { key: string; label: string };

// The bounds of the activity buckets, in days — bucket 4 is accounts never used. Disjoint,
// not cumulative, which is what the labels below have to convey: "≤ 7 dni" over the 1-7
// bucket suggested everyone from the last week, when it is only those not in "< 24h".
//
// The scale itself lives in `shared.ts`, because `src/trends.ts` reads it too (§9.1).
// Re-exported under the name this module's callers already use.
export { ACTIVITY_BUCKET_BOUNDS as ACTIVITY_BOUNDS };

/**
 * A bucket's label trimmed to the active threshold — under a "14 days" filter the 8-30
 * bucket really holds 8-14 days, and that is how it is to be labelled.
 *
 * @param bucket 0-4
 */
export function getActivityLabel(bucket: number, maxDays = Infinity): string {
  if (bucket === NEVER_ONLINE_BUCKET) return "nigdy";

  const [from, to] = assertDefined(ACTIVITY_BUCKET_BOUNDS[bucket], "an activity bucket outside 0-4 has no bounds");
  const upperBound = Math.min(to, maxDays);
  if (from === 0) return "< 24h";
  if (upperBound === Infinity) return `> ${from - 1} dni`;
  if (from === upperBound) return from === 1 ? "1 dzień" : `${from} dni`;
  return `${from}-${upperBound} dni`;
}

/**
 * The buckets that can be non-empty under a given threshold. Without this the view showed
 * "> 30 dni: 0 · nigdy: 0" — zeros by definition, looking like broken data.
 */
export function getVisibleActivityBuckets(maxDays = Infinity): number[] {
  if (maxDays === Infinity) return [0, 1, 2, 3, 4];
  return ACTIVITY_BUCKET_BOUNDS.flatMap(([from], bucket) => (from <= maxDays ? [bucket] : []));
}

// ── Filters ─────────────────────────────────────────────────────────────────

export function getEmptyFilters(): Filters {
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
export function isDefaultFilters(filters: Filters): boolean {
  return (
    filters.minLevel === -Infinity &&
    filters.maxLevel === Infinity &&
    filters.minHonor === -Infinity &&
    filters.maxHonor === Infinity &&
    filters.maxDays === Infinity &&
    filters.professions.size === 6
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
export function describeFilters(filters: Filters): FilterChip[] {
  const formatNumber = (value: number) => value.toLocaleString(POLISH_LOCALE);
  const chips: FilterChip[] = [];

  const addRangeChip = (key: string, name: string, minimum: number, maximum: number) => {
    const hasMin = Number.isFinite(minimum);
    const hasMax = Number.isFinite(maximum);
    if (!hasMin && !hasMax) return;
    chips.push({
      key,
      label: hasMin && hasMax ? `${name} ${formatNumber(minimum)}-${formatNumber(maximum)}` : hasMin ? `${name} ≥ ${formatNumber(minimum)}` : `${name} ≤ ${formatNumber(maximum)}`,
    });
  };

  addRangeChip("level", "Poziom", filters.minLevel, filters.maxLevel);
  addRangeChip("honor", "Honor", filters.minHonor, filters.maxHonor);

  if (Number.isFinite(filters.maxDays)) {
    const days = filters.maxDays === 1 ? "1 dzień" : `${formatNumber(filters.maxDays)} dni`;
    chips.push({ key: "days", label: filters.maxDays === 0 ? "Online < 24h" : `Online ≤ ${days}` });
  }

  if (filters.professions.size !== 6) {
    const names = [...filters.professions]
      .sort((left, right) => left - right)
      .map((profession) => assertDefined(PROFESSION_NAMES[profession], `profession ${profession} has a name`));
    chips.push({
      key: "prof",
      // Past two names the label pushes the bar beyond one line, and nobody reads it whole
      // anyway — at that point only the count matters.
      label: names.length === 0 ? "Żadna profesja" : names.length <= 2 ? names.join(", ") : `${names.length} z 6 profesji`,
    });
  }

  return chips;
}

export function isMatch(data: Snapshot, index: number, filters: Filters): boolean {
  // A row past the end is not a row: `count` is the length of every column (§9.2), so
  // this only fires on a file that broke that promise, and it must not read as a match.
  const level = data.level[index];
  const profession = data.profession[index];
  const honor = data.honor[index];
  if (level === undefined || profession === undefined || honor === undefined) return false;

  if (!level || level < filters.minLevel || level > filters.maxLevel) return false;
  if (!filters.professions.has(profession)) return false;
  if (honor < filters.minHonor || honor > filters.maxHonor) return false;

  // "never online" falls out under every activity threshold — and it has to be checked
  // before the threshold, because the −1 sentinel passes every `>` comparison.
  const days = data.days[index];
  if (filters.maxDays !== Infinity && (isNeverOnline(days) || (days as number) > filters.maxDays)) return false;
  return true;
}

// ── Counting ────────────────────────────────────────────────────────────────

/**
 * A map level → [count for professions 1..6]. Needed only by the single-snapshot view.
 */
export function countByLevel(data: Snapshot, filters: Filters): Map<number, number[]> {
  const counts = new Map<number, number[]>();
  for (let index = 0; index < data.count; index++) {
    if (!isMatch(data, index, filters)) continue;

    // `isMatch` above has already refused a row any column is short of.
    const level = assertDefined(data.level[index], "a matched row has a level");
    const profession = assertDefined(data.profession[index], "a matched row has a profession");
    let bucket = counts.get(level);
    if (!bucket) {
      bucket = composeProfessionCounts();
      counts.set(level, bucket);
    }
    bucket[profession - 1] = assertDefined(bucket[profession - 1], "professions are 1-6") + 1;
  }
  return counts;
}

export function countByActivity(data: Snapshot, filters: Filters): [number, number][] {
  const buckets = composeActivityCounts();
  for (let index = 0; index < data.count; index++) {
    if (!isMatch(data, index, filters)) continue;
    const bucket = getActivityBucket(data.days[index]);
    buckets[bucket] = assertDefined(buckets[bucket], "getActivityBucket answers 0-4") + 1;
  }
  return buckets.map((count, bucket): [number, number] => [bucket, count]);
}

export function getTotalsFromCounts(counts: Map<number, number[]>): { total: number; perProfession: number[] } {
  const perProfession = composeProfessionCounts();
  let total = 0;
  for (const row of counts.values()) {
    for (let profession = 0; profession < PROFESSION_COUNT; profession++) {
      const count = assertDefined(row[profession], "a level bucket holds six counts");
      perProfession[profession] = assertDefined(perProfession[profession], "six professions") + count;
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
 */
export function summarizeFiltered(data: Snapshot, filters: Filters): SnapshotSummary {
  const act = composeActivityCounts();
  const byProf = composeProfessionCounts();
  let total = 0;

  for (let index = 0; index < data.count; index++) {
    if (!isMatch(data, index, filters)) continue;
    const bucket = getActivityBucket(data.days[index]);
    const profession = assertDefined(data.profession[index], "a matched row has a profession");
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

export function composeFiltersParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  const setParam = (key: string, value: number) => {
    if (Number.isFinite(value)) params.set(key, String(value));
  };

  setParam("minLevel", filters.minLevel);
  setParam("maxLevel", filters.maxLevel);
  setParam("minHonor", filters.minHonor);
  setParam("maxHonor", filters.maxHonor);
  setParam("maxDays", filters.maxDays);

  const profs = [...filters.professions].sort((left, right) => left - right);
  if (profs.length !== 6) params.set("prof", profs.join(","));

  return params;
}

export function readFiltersFromParams(params: URLSearchParams): Filters {
  // A query string is text a stranger can write, so every reading may fail and every
  // failure falls back to the default rather than to a number nobody typed: `Number("")`
  // is 0, which would read as a deliberate "minimum level 0".
  const getNumberFromParam = (key: string, fallback: number) => {
    const rawValue = params.get(key);
    if (rawValue === null || rawValue === "") return fallback;
    return getFiniteNumberFromText(rawValue.trim()) ?? fallback;
  };

  const rawProfessions = params.get("prof");
  // Read and kept in one step: a `.map` then `.filter` leaves the reader's `null` in the
  // element type, and the only way back out of it is a cast (§9.5).
  const parsed = (rawProfessions ?? "").split(",").flatMap((part) => {
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
