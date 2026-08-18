// The shared vocabulary of the whole front end: constants, time and activity bucketing.
//
// This module must not touch the DOM or run anything on import — it is imported by the
// pure modules (`filters.js`, `history.js`) and by the view layer (`app.js`), and the view
// starts by itself once loaded. If anything here reached for `document`, the pure modules'
// tests could no longer run outside a browser. A test holds this.
//
// The strings below are Polish because a player reads them — see "Language" in AGENTS.md.

export const PROF = {
  1: "Wojownik",
  2: "Mag",
  3: "Paladyn",
  4: "Tropiciel",
  5: "Tancerz ostrzy",
  6: "Łowca",
};

// margometer's series palette (validated for contrast/CVD on a dark background).
export const PROF_COLORS = {
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
export function isNeverOnline(days) {
  return days === null || days === undefined || days < 0;
}

/**
 * The activity bucket: 0 = <24h, 1 = 1-7 days, 2 = 8-30 days, 3 = >30 days, 4 = never.
 * The buckets are **disjoint**, not cumulative — the cumulative thresholds live in
 * `ACTIVITY_THRESHOLDS` in `history.js`, and those are two different scales.
 *
 * The same function as `activityBucket` in `src/trends.ts`, with one difference: that one
 * does not know the −1 sentinel, because there are no typed arrays on the server side and
 * nowhere for it to come from. On the values the scraper can produce, both must give the
 * same answer — drift would give a history that disagrees with the snapshot view. A test
 * holds this.
 */
export function activityBucket(days) {
  if (isNeverOnline(days)) return 4;
  if (days === 0) return 0;
  if (days <= 7) return 1;
  if (days <= 30) return 2;
  return 3;
}

export function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * The snapshot's date in the browser's local time, computed from `startedAt`.
 *
 * A snapshot's identifier (the stem of the filename) is NOT usable as a date: until July
 * 2026 it came from the scraper's local time, afterwards from UTC, so two snapshots side
 * by side would show two different clocks. When `startedAt` is missing we fall back to the
 * identifier and say outright that it is an approximation.
 */
export function formatSnapshotDate(entry) {
  if (entry?.startedAt) {
    const d = new Date(entry.startedAt);
    if (!Number.isNaN(d.getTime())) {
      const p = (n) => String(n).padStart(2, "0");
      return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
  }

  const m = String(entry?.id ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]} (?)` : String(entry?.id ?? "—");
}

/** A tick label on the time axis — `DD.MM` in local time. */
export function shortDate(ms) {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The snapshot's UTC hour — the only place where we deliberately show a non-local time.
 * It is what explains the jumps in the "last online" metric: rounds run once at 4 a.m. and
 * once at 9 p.m.
 */
export function utcTime(startedAt) {
  const d = new Date(startedAt);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(11, 16);
}

/** The interval between snapshots in days — computed from `startedAt` and nothing else. */
export function daysBetween(a, b) {
  if (!a?.startedAt || !b?.startedAt) return null;
  const diff = new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  return Number.isNaN(diff) ? null : diff / 86_400_000;
}
