// Stitching the pages of a walk into one snapshot — pure functions, so they can be tested.
//
// `world-scraper.ts` runs the CLI and the whole scrape at the top level of the module, so
// importing it from a test would start a round. The same reasoning that put the backoff in
// `retry.ts` puts this here.
//
// ── Why a walk repeats itself ────────────────────────────────────────────────
//
// A round walks one world at ~1 req/s: 6-10 minutes for luvia, 13 for gordion. The ranking
// is live and re-sorts under us the whole time, and `?page=N` is an offset into it, so the
// walk is reading a list that moves between requests:
//
//   a player is inserted above rank 100N  →  everyone below shifts DOWN  →  page N+1
//                                            repeats the tail of page N
//   a player leaves above rank 100N       →  everyone below shifts UP    →  the players
//                                            between the two pages are never fetched
//
// The first is what this file removes. Measured on 2026-08-27 over `public/worlds/` as
// scraped: luvia carried 43, 52 and 27 repeated rows in its three snapshots, every pair
// byte-identical, sitting at the tail of one page (index %100 = 94-99) and again at the
// head of the next (%100 = 0-5). Repo-wide it was 150 rows in 6 760 201 — luvia is 122 of
// them, because it takes ~5500 new players a round against ~350 for aether or gordion.
//
// ── Why by charId, and not by the rank the page prints ───────────────────────
//
// The "#" column looks like a rank and is not one: probed against luvia on 2026-08-27,
// page 2 prints 101..200 and page 3 prints 201..300, contiguous by construction, because
// it is the row's offset and not a stored position. It therefore says the same thing
// whether or not the page repeats players, and a sequence check over it would have found
// nothing while reporting that everything was fine.
//
// `charId` is the ranking's own identity for a character and cannot honestly appear twice
// in one ranking, so a repeat of it is the walk's error and nobody else's.
//
// ── What this CANNOT see ─────────────────────────────────────────────────────
//
// The other direction leaves no trace on the page. A player the list shifted past is
// simply absent, and there is nothing in what came back to say a player is missing —
// `count` is a floor, not a measurement, and §9.5 forbids inventing the difference. It is
// real: 20 luvia charIds sit in the 2026-08-04 and 2026-08-26 snapshots and not in the
// 2026-08-16 one between them, where aether, gordion, classic and brutal score 0.
// `shiftedBoundaries` is what can honestly be reported — the seams where the list was
// caught moving — and it is a lower bound on how much moved, not a count of what was lost.

import type { PlayerRow } from "@/src/parser.ts";

/** One walk's pages, stitched: the rows that survived and what it cost to get them. */
export type PageOverlap = {
  /** The snapshot's rows, in rank order, each character once. */
  rows: PlayerRow[];
  /** Rows dropped because the walk had already fetched that character. */
  overlapRows: number;
  /**
   * Page seams at which the list had shifted. A lower bound on the movement during the
   * walk — a shift the other way leaves nothing to count.
   */
  shiftedBoundaries: number;
};

/**
 * Removes the characters a walk fetched more than once, keeping the first copy.
 *
 * First and not last, because the first is the one whose position the rest of the snapshot
 * was built around: row *i* is rank *i+1* (§9.2), so dropping the earlier copy would move
 * every row above the repeat as well.
 */
export function removePageOverlap(pages: PlayerRow[][]): PageOverlap {
  const rows: PlayerRow[] = [];
  const seen = new Set<number>();
  let overlapRows = 0;
  let shiftedBoundaries = 0;

  for (const [index, page] of pages.entries()) {
    const before = overlapRows;
    for (const row of page) {
      const charId = row[2];
      if (seen.has(charId)) {
        overlapRows++;
        continue;
      }
      seen.add(charId);
      rows.push(row);
    }
    // The first page has no page before it, so a repeat inside it is not a seam. Still
    // dropped and still counted — it is only the name of the other number that would lie.
    if (index > 0 && overlapRows > before) shiftedBoundaries++;
  }

  return { rows, overlapRows, shiftedBoundaries };
}
