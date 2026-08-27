// The shared vocabulary of the whole front end: constants, time and activity bucketing.
//
// This module must not touch the DOM or run anything on import — it is imported by the
// pure modules (`filters.js`, `history.js`) and by the view layer (`app.js`), and the view
// starts by itself once loaded. If anything here reached for `document`, the pure modules'
// tests could no longer run outside a browser. A test holds this.
//
// The strings below are Polish because a player reads them — see "Language" in AGENTS.md.

import { getDateFromIsoText, getMillisecondsFromIsoText } from "./lib/timestamp.js";
import { getIntegerFromText } from "./lib/number.js";
import { assert, assertDefined } from "./lib/assert.js";

/**
 * The vocabulary the whole front end shares, stated once so the modules cannot disagree
 * about what they are passing each other. There is no build step (AGENTS.md §1), so these
 * are JSDoc typedefs rather than TypeScript — `checkJs` reads them all the same.
 *
 * @typedef {object} SnapshotEntry One snapshot, as much of it as a date needs.
 * @property {string} id The identifier, and the stem of the filenames. NOT a date — §9.2.
 * @property {string} [startedAt] When the scrape began. The only trustworthy time there is.
 * @property {boolean|number} [suspect] Whether the population guard flagged it.
 *
 * @typedef {SnapshotEntry & { filters: string, names?: string }} ManifestEntry
 *   The same entry as `manifest.json` lists it, i.e. carrying the path of its `.f.json`.
 *   Two typedefs rather than one optional field: only the manifest can promise a path, and
 *   `getSnapshotEntries` composes entries from the aggregate, which holds no paths at all.
 *
 * @typedef {object} Filters What the reader asked to see. Unset ends are infinite, never 0.
 * @property {number} minLevel
 * @property {number} maxLevel
 * @property {number} minHonor
 * @property {number} maxHonor
 * @property {number} maxDays
 * @property {Set<number>} professions
 *
 * @typedef {object} RawSnapshot A `.f.json` as it arrives over the wire.
 * @property {number} count
 * @property {number[]} level
 * @property {number[]} profession
 * @property {number[]} honor
 * @property {(number|null)[]} days `null` is an account never used.
 *
 * @typedef {object} TypedSnapshot The same, converted for the pass over it.
 * @property {number} count
 * @property {Int16Array} level A level fits in 16 bits with room to spare.
 * @property {Uint8Array} profession 1-6.
 * @property {Int32Array} honor Signed: honor can be negative — §9.2.
 * @property {Int32Array} days ⚠️ `null` is **−1** here — a typed array cannot hold null.
 * @property {{ reason: string } | null} [suspect] What the population guard said about this
   snapshot. The scraper writes more fields than this; the view draws the sentence and
   nothing else, so this states what is read rather than what is written — §9.8.
 *
 * @typedef {RawSnapshot | TypedSnapshot} Snapshot Either representation. `isNeverOnline` is
 *   the only thing that knows the difference, which is what keeps one code path in
 *   `filters.js`.
 *
 * @typedef {object} SnapshotSummary The few numbers a chart draws. The shape of one row of
 *   `trends.json`, which is why the two history paths cannot be told apart.
 * @property {number} total
 * @property {number[]} act Five disjoint activity buckets — §10.
 * @property {number[]} byProf Six counts, professions 1-6.
 *
 * @typedef {object} WorldTrend One world's folded history, columnar: row i of every column
 *   is the same snapshot.
 * @property {string[]} id
 * @property {string[]} startedAt
 * @property {number[]} total
 * @property {number[][]} act
 * @property {number[][]} byProf
 * @property {number[]} suspect
 * @property {number} bytes What one snapshot of this world costs a client, gzipped.
 */

/**
 * The professions, in the ranking's own Polish. Read by the parser as well as by the view:
 * `src/parser.ts` folds these names to match a column heading, so this table and the
 * ranking's vocabulary are the same thing stated once (§9.1).
 *
 * @type {Record<number, string>}
 */
export const PROFESSION_NAMES = {
  1: "Wojownik",
  2: "Mag",
  3: "Paladyn",
  4: "Tropiciel",
  5: "Tancerz ostrzy",
  6: "Łowca",
};

/** How many professions there are. Six is a fact of the game, not a number we chose. */
export const PROFESSION_COUNT = Object.keys(PROFESSION_NAMES).length;

// MargoMeter's series palette (validated for contrast/CVD on a dark background).
/** @type {Record<number, string>} */
export const PROFESSION_COLORS = {
  1: "#3987e5", // Wojownik — blue
  2: "#d55181", // Mag — magenta
  3: "#199e70", // Paladyn — aquamarine
  4: "#c98500", // Tropiciel — yellow
  5: "#9085e9", // Tancerz ostrzy — violet
  6: "#e66767", // Łowca — red
};

/**
 * An account never used — the ranking shows a date in 1969 for it.
 *
 * A raw `.f.json` stores such a row as `null`, but typed arrays cannot hold `null`, so
 * after the conversion in `history.js` it is **−1**. Both spellings mean the same thing
 * and must fall out of every activity threshold.
 *
 * **This check has to come before the `days > maxDays` comparison.** `−1 > anything` is
 * false, so a filter that asks about the threshold first lets accounts never used into
 * *every* activity threshold — the exact opposite of what the data says.
 *
 * @param {number | null | undefined} days
 * @returns {boolean}
 */
export function isNeverOnline(days) {
  return days === null || days === undefined || days < 0;
}

/**
 * The activity scale, **disjoint**: how many days ago a player was last online, in the four
 * bands the data is counted in. The fifth bucket — an account never used — is not a number
 * of days and so has no bounds here; it is `ACTIVITY_BUCKET_COUNT - 1`.
 *
 * The one place 7 and 30 are written. They used to be written four times: twice as a
 * comparison (here and in `src/trends.ts`), once as these bounds in `filters.js`, and once
 * as `bound` in `ACTIVITY_THRESHOLDS`. ⚠️ The cumulative thresholds in `history.js` are a
 * **different scale** over the same subject — §10 — and they derive their edges from this
 * table rather than restating them.
 *
 * @type {readonly (readonly [number, number])[]}
 */
export const ACTIVITY_BUCKET_BOUNDS = /** @type {const} */ ([
  [0, 0],
  [1, 7],
  [8, 30],
  [31, Infinity],
]);

/** Four bands of days, plus "never used". */
export const ACTIVITY_BUCKET_COUNT = ACTIVITY_BUCKET_BOUNDS.length + 1;

/** The bucket an account never used falls into — the one with no upper bound in days. */
export const NEVER_ONLINE_BUCKET = ACTIVITY_BUCKET_COUNT - 1;

/**
 * The activity bucket: 0 = <24h, 1 = 1-7 days, 2 = 8-30 days, 3 = >30 days, 4 = never.
 *
 * Read by both sides — the browser filters with it and `src/trends.ts` folds the history
 * with it (§9.1). The server cannot produce the −1 sentinel, having no typed arrays, so on
 * its values this answers exactly what a version without that check would; the difference
 * costs one comparison and saves a second implementation.
 *
 * @param {number | null | undefined} days
 * @returns {number} 0 to ACTIVITY_BUCKET_COUNT - 1
 */
export function getActivityBucket(days) {
  if (isNeverOnline(days)) return NEVER_ONLINE_BUCKET;

  // `isNeverOnline` has already refused `null`, `undefined` and the −1 sentinel, but it
  // says so in prose rather than in a type the checker can follow — a predicate cannot
  // express "not null, and not a negative number". Restating the check here instead would
  // put the sentinel's meaning in two places, which is the one thing that module exists to
  // prevent (§9.1).
  const value = /** @type {number} */ (days);
  const bucket = ACTIVITY_BUCKET_BOUNDS.findIndex(([, to]) => value <= to);

  // The last band reaches Infinity, so a finite number always lands somewhere. A miss would
  // mean the table stopped covering the number line, not that this reading is unusual.
  assert(bucket !== -1, "the activity bands cover every non-negative number of days");
  return bucket;
}

/**
 * A counter per activity bucket, and one per profession: zero-filled, the right length, and
 * the length stated in one place. They were nine array literals — `[0, 0, 0, 0, 0]` next to
 * `[0, 0, 0, 0, 0, 0]` — across `filters.js`, `history.js` and `src/trends.ts`, and nothing
 * connected their length to the tables above.
 *
 * @returns {number[]}
 */
export function composeActivityCounts() {
  return new Array(ACTIVITY_BUCKET_COUNT).fill(0);
}

/** @returns {number[]} */
export function composeProfessionCounts() {
  return new Array(PROFESSION_COUNT).fill(0);
}

/** One series per profession, for a history folded column by column. @returns {number[][]} */
export function composeProfessionSeries() {
  return Array.from({ length: PROFESSION_COUNT }, () => []);
}

/** One series per activity bucket, same shape and same reason. @returns {number[][]} */
export function composeActivitySeries() {
  return Array.from({ length: ACTIVITY_BUCKET_COUNT }, () => []);
}

/**
 * The last day a bucket still covers. What the cumulative thresholds in `history.js` are
 * built from: "≤ 7 dni" is buckets 0 and 1, and its edge is whatever the table says bucket
 * 1 ends at — never a 7 written a second time.
 *
 * @param {number} bucket
 * @returns {number}
 */
export function getActivityBucketBound(bucket) {
  const bounds = assertDefined(ACTIVITY_BUCKET_BOUNDS[bucket], "a bucket of days has bounds");
  return bounds[1];
}

/**
 * @param {string} s
 * @returns {string}
 */
/**
 * The professions as `[id, name]` pairs, with the id a **number**.
 *
 * `Object.entries` stringifies every key, so `PROFESSION_NAMES` read that way hands back "1" where
 * the rest of the code has a `Set<number>` and does `id - 1`. Converting at each of the
 * six call sites is six chances to forget; converting here is one.
 *
 * @returns {[number, string][]}
 */
export function getProfessionEntries() {
  return Object.entries(PROFESSION_NAMES).map(
    ([id, name]) =>
      /** @type {[number, string]} */ ([
        assertDefined(getIntegerFromText(id), `a profession key is a whole number, got "${id}"`),
        name,
      ]),
  );
}

/**
 * @param {string} s
 * @returns {string}
 */
export function capitalize(s) {
  return s ? s[0]?.toUpperCase() + s.slice(1) : s;
}

/**
 * The snapshot's date in the browser's local time, computed from `startedAt`.
 *
 * A snapshot's identifier (the stem of the filename) is NOT usable as a date: until July
 * 2026 it came from the scraper's local time, afterwards from UTC, so two snapshots side
 * by side would show two different clocks. When `startedAt` is missing we fall back to the
 * identifier and say outright that it is an approximation.
 *
 * @param {SnapshotEntry | null | undefined} entry
 * @returns {string}
 */
export function formatSnapshotDate(entry) {
  const d = getDateFromIsoText(entry?.startedAt);
  if (d !== null) {
    const p = (/** @type {number} */ n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  const m = String(entry?.id ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]} (?)` : String(entry?.id ?? "—");
}

/**
 * A tick label on the time axis — `DD.MM` in local time.
 *
 * Takes milliseconds rather than text on purpose: by this point the number came from
 * `getMillisecondsFromIsoText`, so it is ours and there is nothing left to refuse.
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatShortDate(ms) {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The snapshot's UTC hour — the only place where we deliberately show a non-local time.
 * It is what explains the jumps in the "last online" metric: rounds run once at 4 a.m. and
 * once at 9 p.m.
 *
 * @param {string | null | undefined} startedAt
 * @returns {string | null}
 */
export function formatUtcTime(startedAt) {
  const d = getDateFromIsoText(startedAt);
  return d === null ? null : d.toISOString().slice(11, 16);
}

const MILLISECONDS_IN_DAY = 86_400_000;

/**
 * The interval between snapshots in days — computed from `startedAt` and nothing else.
 *
 * @param {SnapshotEntry | null | undefined} a
 * @param {SnapshotEntry | null | undefined} b
 * @returns {number | null}
 */
export function getDaysBetween(a, b) {
  const from = getMillisecondsFromIsoText(a?.startedAt);
  const to = getMillisecondsFromIsoText(b?.startedAt);
  // Either end unreadable means there is no interval — not an interval of zero, which
  // would divide a change by no time at all and report it as an infinite rate.
  if (from === null || to === null) return null;
  return (to - from) / MILLISECONDS_IN_DAY;
}
