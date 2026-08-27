// The shared vocabulary of the whole front end: constants, time and activity bucketing.
//
// This module must not touch the DOM or run anything on import — it is imported by the pure
// modules (`web/filters.ts`, `web/history.ts`), by the view layer (`web/app.ts`, which starts
// by itself once loaded) and by `src/trends.ts` on the server. If anything here reached for
// `document`, none of the others could be tested outside a browser. A test holds this.
//
// The strings below are Polish because a player reads them — see "Language" in AGENTS.md.

import { getDateFromIsoText, getMillisecondsFromIsoText } from "@/src/lib/timestamp.ts";
import { getIntegerFromText } from "@/src/lib/number.ts";
import { assert, assertDefined } from "@/src/lib/assert.ts";

/** One snapshot, as much of it as a date needs. */
export type SnapshotEntry = {
  /** The identifier, and the stem of the filenames. NOT a date — §9.2. */
  id: string;
  /** When the scrape began. The only trustworthy time there is. */
  startedAt?: string;
  /** Whether the population guard flagged it. */
  suspect?: boolean | number;
};

/**
 * The same entry as `manifest.json` lists it, i.e. carrying the path of its `.f.json`.
 *
 * Two types rather than one optional field: only the manifest can promise a path, and
 * `getSnapshotEntries` composes entries from the aggregate, which holds no paths at all.
 */
export type ManifestEntry = SnapshotEntry & { filters: string; names?: string };

/** What the reader asked to see. Unset ends are infinite, never 0. */
export type Filters = {
  minLevel: number;
  maxLevel: number;
  minHonor: number;
  maxHonor: number;
  maxDays: number;
  professions: Set<number>;
};

/** A `.f.json` as it arrives over the wire. */
export type RawSnapshot = {
  count: number;
  level: number[];
  profession: number[];
  honor: number[];
  /** `null` is an account never used. */
  days: (number | null)[];
};

/** The same, converted for the pass over it. */
export type TypedSnapshot = {
  count: number;
  /** A level fits in 16 bits with room to spare. */
  level: Int16Array;
  /** 1-6. */
  profession: Uint8Array;
  /** Signed: honor can be negative — §9.2. */
  honor: Int32Array;
  /** ⚠️ `null` is **−1** here — a typed array cannot hold null. */
  days: Int32Array;
  /**
   * What the population guard said about this snapshot. The scraper writes more fields than
   * this; the view draws the sentence and nothing else, so this states what is read rather
   * than what is written — §9.8.
   */
  suspect?: { reason: string } | null;
};

/**
 * Either representation. `isNeverOnline` is the only thing that knows the difference, which
 * is what keeps one code path in `web/filters.ts`.
 */
export type Snapshot = RawSnapshot | TypedSnapshot;

/**
 * The few numbers a chart draws. The shape of one row of `trends.json`, which is why the two
 * history paths cannot be told apart.
 */
export type SnapshotSummary = {
  total: number;
  /** Five disjoint activity buckets — §10. */
  act: number[];
  /** Six counts, professions 1-6. */
  byProf: number[];
};

/** One world's folded history, columnar: row i of every column is the same snapshot. */
export type WorldTrend = {
  id: string[];
  startedAt: string[];
  total: number[];
  act: number[][];
  byProf: number[][];
  suspect: number[];
  /**
   * What one of this world's snapshots costs over the wire: the gzip size of the newest
   * `.f.json`. One number per world, not per snapshot — per-snapshot sizes in the manifest
   * measured 5835 → 7164 B gzip, i.e. +1.3 KB on every visit for everyone, and within a world
   * the sizes barely move. A raw size times a constant ratio will not do instead: the ratio is
   * 4.18 for one world and 4.85 for another, so a constant misjudges one by 15%.
   */
  bytes: number;
};

/**
 * The locale every number a player reads is formatted in — "23 719" and "−5,3%", never
 * "23,719" and "-5.3%". One spelling, because a page that mixes two conventions in one
 * table looks like two different numbers.
 */
export const POLISH_LOCALE = "pl-PL";

/**
 * The professions, in the ranking's own Polish. Read by the parser as well as by the view:
 * `src/parser.ts` folds these names to match a column heading, so this table and the
 * ranking's vocabulary are the same thing stated once (§9.1).
 */
export const PROFESSION_NAMES: Record<number, string> = {
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
export const PROFESSION_COLORS: Record<number, string> = {
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
 */
export function isNeverOnline(days: number | null | undefined): boolean {
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
 */
export const ACTIVITY_BUCKET_BOUNDS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 7],
  [8, 30],
  [31, Infinity],
];

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
 * @returns 0 to ACTIVITY_BUCKET_COUNT - 1
 */
export function getActivityBucket(days: number | null | undefined): number {
  if (isNeverOnline(days)) return NEVER_ONLINE_BUCKET;

  // `isNeverOnline` has already refused `null`, `undefined` and the −1 sentinel, but it
  // says so in prose rather than in a type the checker can follow — a predicate cannot
  // express "not null, and not a negative number". Restating the check here instead would
  // put the sentinel's meaning in two places, which is the one thing that module exists to
  // prevent (§9.1).
  const value = days as number;
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
 */
export function composeActivityCounts(): number[] {
  return new Array(ACTIVITY_BUCKET_COUNT).fill(0);
}

export function composeProfessionCounts(): number[] {
  return new Array(PROFESSION_COUNT).fill(0);
}

/** One series per profession, for a history folded column by column. */
export function composeProfessionSeries(): number[][] {
  return Array.from({ length: PROFESSION_COUNT }, () => []);
}

/** One series per activity bucket, same shape and same reason. */
export function composeActivitySeries(): number[][] {
  return Array.from({ length: ACTIVITY_BUCKET_COUNT }, () => []);
}

/**
 * The last day a bucket still covers. What the cumulative thresholds in `history.js` are
 * built from: "≤ 7 dni" is buckets 0 and 1, and its edge is whatever the table says bucket
 * 1 ends at — never a 7 written a second time.
 */
export function getActivityBucketBound(bucket: number): number {
  const bounds = assertDefined(ACTIVITY_BUCKET_BOUNDS[bucket], "a bucket of days has bounds");
  return bounds[1];
}

/**
 * The professions as `[id, name]` pairs, with the id a **number**.
 *
 * `Object.entries` stringifies every key, so `PROFESSION_NAMES` read that way hands back "1" where
 * the rest of the code has a `Set<number>` and does `id - 1`. Converting at each of the
 * six call sites is six chances to forget; converting here is one.
 */
export function getProfessionEntries(): [number, string][] {
  return Object.entries(PROFESSION_NAMES).map(([id, name]) => [
    assertDefined(getIntegerFromText(id), `a profession key is a whole number, got "${id}"`),
    name,
  ]);
}

export function capitalize(text: string): string {
  return text ? text[0]?.toUpperCase() + text.slice(1) : text;
}

/**
 * The snapshot's date in the browser's local time, computed from `startedAt`.
 *
 * A snapshot's identifier (the stem of the filename) is NOT usable as a date: until July
 * 2026 it came from the scraper's local time, afterwards from UTC, so two snapshots side
 * by side would show two different clocks. When `startedAt` is missing we fall back to the
 * identifier and say outright that it is an approximation.
 */
export function formatSnapshotDate(entry: SnapshotEntry | null | undefined): string {
  const date = getDateFromIsoText(entry?.startedAt);
  if (date !== null) {
    const padTwoDigits = (value: number) => String(value).padStart(2, "0");
    return `${padTwoDigits(date.getDate())}.${padTwoDigits(date.getMonth() + 1)}.${date.getFullYear()} ${padTwoDigits(date.getHours())}:${padTwoDigits(date.getMinutes())}`;
  }

  const match = String(entry?.id ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/);
  return match ? `${match[3]}.${match[2]}.${match[1]} ${match[4]}:${match[5]} (?)` : String(entry?.id ?? "—");
}

/**
 * A tick label on the time axis — `DD.MM` in local time.
 *
 * Takes milliseconds rather than text on purpose: by this point the number came from
 * `getMillisecondsFromIsoText`, so it is ours and there is nothing left to refuse.
 */
export function formatShortDate(milliseconds: number): string {
  const date = new Date(milliseconds);
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The snapshot's UTC hour — the only place where we deliberately show a non-local time.
 * It is what explains the jumps in the "last online" metric: rounds run once at 4 a.m. and
 * once at 9 p.m.
 */
export function formatUtcTime(startedAt: string | null | undefined): string | null {
  const date = getDateFromIsoText(startedAt);
  return date === null ? null : date.toISOString().slice(11, 16);
}

const MILLISECONDS_IN_DAY = 86_400_000;

/**
 * The interval between snapshots in days — computed from `startedAt` and nothing else.
 */
export function getDaysBetween(
  earlier: SnapshotEntry | null | undefined,
  later: SnapshotEntry | null | undefined,
): number | null {
  const from = getMillisecondsFromIsoText(earlier?.startedAt);
  const to = getMillisecondsFromIsoText(later?.startedAt);
  // Either end unreadable means there is no interval — not an interval of zero, which
  // would divide a change by no time at all and report it as an infinite rate.
  if (from === null || to === null) return null;
  return (to - from) / MILLISECONDS_IN_DAY;
}
