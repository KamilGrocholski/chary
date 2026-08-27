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
import { assertDefined } from "./lib/assert.js";

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

/** @type {Record<number, string>} */
export const PROFESSION_NAMES = {
  1: "Wojownik",
  2: "Mag",
  3: "Paladyn",
  4: "Tropiciel",
  5: "Tancerz ostrzy",
  6: "Łowca",
};

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
 * The activity bucket: 0 = <24h, 1 = 1-7 days, 2 = 8-30 days, 3 = >30 days, 4 = never.
 * The buckets are **disjoint**, not cumulative — the cumulative thresholds live in
 * `ACTIVITY_THRESHOLDS` in `history.js`, and those are two different scales.
 *
 * The same function as `getActivityBucket` in `src/trends.ts`, with one difference: that one
 * does not know the −1 sentinel, because there are no typed arrays on the server side and
 * nowhere for it to come from. On the values the scraper can produce, both must give the
 * same answer — drift would give a history that disagrees with the snapshot view. A test
 * holds this.
 *
 * @param {number | null | undefined} days
 * @returns {number} 0-4
 */
export function getActivityBucket(days) {
  if (isNeverOnline(days)) return 4;

  // `isNeverOnline` has already refused `null`, `undefined` and the −1 sentinel, but it
  // says so in prose rather than in a type the checker can follow — a predicate cannot
  // express "not null, and not a negative number". Restating the check here instead would
  // put the sentinel's meaning in two places, which is the one thing that module exists to
  // prevent (§9.1).
  const value = /** @type {number} */ (days);
  if (value === 0) return 0;
  if (value <= 7) return 1;
  if (value <= 30) return 2;
  return 3;
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
  return Object.entries(PROFESSION_NAMES).map(([id, name]) => [
    assertDefined(getIntegerFromText(id), `a profession key is a whole number, got "${id}"`),
    name,
  ]);
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
  return (to - from) / 86_400_000;
}
