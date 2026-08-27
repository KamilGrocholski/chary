import { describe, expect, test } from "bun:test";
import { removePageOverlap } from "@/src/page-overlap.ts";
import type { PlayerRow } from "@/src/parser.ts";

// The fault this holds: the ranking re-sorts while the walk pages through it, so page N+1
// can repeat the tail of page N and `allRows.push(...)` wrote the character twice. Measured
// on 2026-08-27 over `public/worlds/` — luvia's three snapshots carried 43, 52 and 27 of
// them, in runs of 1 to 11 rows sitting exactly on a page seam.

/** A row is only ever read here for its charId, its level and its order. */
function composeRow(charId: number, level = 100): PlayerRow {
  return [0, `player-${charId}`, charId, level, 1, 0, 0];
}

/** `count` characters from `first`, the way one page of the ranking arrives. */
function composePage(first: number, count: number, level = 100): PlayerRow[] {
  return Array.from({ length: count }, (_, index) => composeRow(first + index, level));
}

function getCharIds(rows: PlayerRow[]) {
  return rows.map((row) => row[2]);
}

describe("a walk nothing moved under", () => {
  test("pages that do not repeat come through untouched", () => {
    const pages = [composePage(1, 100), composePage(101, 100), composePage(201, 40)];
    const stitched = removePageOverlap(pages);

    expect(stitched.rows).toHaveLength(240);
    expect(stitched.overlapRows).toBe(0);
    expect(stitched.shiftedBoundaries).toBe(0);
    expect(getCharIds(stitched.rows)).toEqual(Array.from({ length: 240 }, (_, index) => index + 1));
  });

  test("one page has no seam to shift on", () => {
    const stitched = removePageOverlap([composePage(1, 100)]);

    expect(stitched.rows).toHaveLength(100);
    expect(stitched.overlapRows).toBe(0);
    expect(stitched.shiftedBoundaries).toBe(0);
  });

  // Zero is the boundary and needs a neighbour on both sides — AGENTS.md §7.5. Below one
  // page there is no walk at all, and the empty answer must be the shape, not a crash.
  test("no pages at all is an empty snapshot, not a failure", () => {
    expect(removePageOverlap([])).toEqual({ rows: [], overlapRows: 0, shiftedBoundaries: 0 });
  });

  test("an empty page is not a seam", () => {
    const stitched = removePageOverlap([composePage(1, 100), []]);

    expect(stitched.rows).toHaveLength(100);
    expect(stitched.shiftedBoundaries).toBe(0);
  });
});

describe("a walk the ranking moved under", () => {
  // The smallest real case, and the one the boundary rule asks for beside zero.
  test("a single repeated row is dropped and counted", () => {
    const pages = [composePage(1, 100), [composeRow(100), ...composePage(101, 99)]];
    const stitched = removePageOverlap(pages);

    expect(stitched.rows).toHaveLength(199);
    expect(stitched.overlapRows).toBe(1);
    expect(stitched.shiftedBoundaries).toBe(1);
    expect(getCharIds(stitched.rows)).toEqual(Array.from({ length: 199 }, (_, index) => index + 1));
  });

  // luvia 2026-08-26 at rows 31694-31705: six rows ending one page and opening the next.
  test("a run of six, the size luvia actually carried", () => {
    const pages = [composePage(1, 100), [...composePage(95, 6), ...composePage(101, 94)]];
    const stitched = removePageOverlap(pages);

    expect(stitched.rows).toHaveLength(194);
    expect(stitched.overlapRows).toBe(6);
    expect(stitched.shiftedBoundaries).toBe(1);
  });

  test("a page that repeats the previous one whole leaves nothing of itself", () => {
    const stitched = removePageOverlap([composePage(1, 100), composePage(1, 100)]);

    expect(stitched.rows).toHaveLength(100);
    expect(stitched.overlapRows).toBe(100);
    expect(stitched.shiftedBoundaries).toBe(1);
  });

  test("of three seams, two shifted and one did not", () => {
    const pages = [
      composePage(1, 100), //                              1-100
      [composeRow(100), ...composePage(101, 99)], //      100 again, then 101-199
      composePage(200, 100), //                          200-299, clean against the last
      [...composePage(298, 3), ...composePage(301, 97)], // 298-299 again, 300 new, 301-397
    ];
    const stitched = removePageOverlap(pages);

    expect(stitched.overlapRows).toBe(1 + 2);
    expect(stitched.shiftedBoundaries).toBe(2);
    expect(stitched.rows).toHaveLength(397);
    expect(new Set(getCharIds(stitched.rows)).size).toBe(stitched.rows.length);
  });

  test("a repeat inside the first page is dropped but is not a seam", () => {
    const stitched = removePageOverlap([[...composePage(1, 99), composeRow(1)]]);

    expect(stitched.rows).toHaveLength(99);
    expect(stitched.overlapRows).toBe(1);
    expect(stitched.shiftedBoundaries).toBe(0);
  });

  test("a repeat is dropped however far apart the two copies are", () => {
    const pages = [composePage(1, 100), composePage(101, 100), [composeRow(7), ...composePage(201, 99)]];
    const stitched = removePageOverlap(pages);

    expect(stitched.overlapRows).toBe(1);
    expect(getCharIds(stitched.rows).filter((charId) => charId === 7)).toHaveLength(1);
  });
});

describe("which copy survives", () => {
  // Row i is rank i+1 (§9.2), so keeping the later copy would move every row above the
  // repeat down one rank as well — the repeat's cost would spread over the whole snapshot.
  test("the first copy is kept, in its own place", () => {
    const first = composeRow(50, 200);
    const later = composeRow(50, 111);
    const pages = [[composeRow(49, 201), first], [later, composeRow(51, 110)]];
    const stitched = removePageOverlap(pages);

    expect(stitched.rows).toHaveLength(3);
    expect(stitched.rows[1]).toBe(first);
    expect(stitched.rows[1]?.[3]).toBe(200);
  });

  // The ranking is sorted, so a snapshot's levels must never rise going down it. The second
  // copies below carry a lower level than the first, which is what makes this an assertion
  // rather than a restatement: keeping them, or moving them to where the repeat arrived,
  // puts 250 above 299 and the sort breaks.
  test("levels still fall through the seam the repeat sat on", () => {
    const pages = [composePage(1, 100, 300), [...composePage(99, 2, 250), ...composePage(101, 98, 299)]];
    const levels = removePageOverlap(pages).rows.map((row) => row[3]);

    expect(levels).toHaveLength(198);
    expect(levels.every((level, index) => index === 0 || level <= levels[index - 1]!)).toBe(true);
  });
});
