# The filtered history has no ceiling — 2026-08-28

Read at `eb35390`, with the page-boundary-overlap round still uncommitted in the tree, on
the data in `public/` as it stood that day: 21 worlds, 244 snapshots, 12 per world except
brutal (13) and luvia (3).

Two days earlier, `2026-08-26-spec-history-budget.md` replaced a snapshot-count ceiling with
a byte one — `HISTORY_BUDGET_BYTES = 2 MiB` per filtered world, and a button offering the
rest. This note removes the ceiling entirely. The spec it supersedes was not wrong about
what it fixed; it was wrong about needing to exist.

## What the history actually costs

Measured with `gzip -c` over every `.f.json`, not multiplied out of `bytes` in
`trends.json` — that field prices one snapshot, and the older ones are smaller because the
populations grew.

| World | Snapshots | One snapshot | Whole history |
|---|---|---|---|
| gordion | 12 | 177 KB | **2.1 MB** |
| aether | 12 | 96 KB | 1.1 MB |
| *median world* | 12 | ~73 KB | ~0.88 MB |
| brutal | 13 | 20 KB | 0.25 MB |
| luvia | 3 | 66 KB | 0.17 MB |

The whole tree of `.f.json`, every world at once, is about 17 MB gzipped — and no visitor
ever fetches that, because a filtered history is one world.

## What the ceiling was buying

`floor(2 MiB / bytes)` against those figures trims **one world by one snapshot**: gordion,
11 of 12. Twenty of the twenty-one fit whole and always did.

For that single point it held:

- `HISTORY_BUDGET_BYTES`, `HISTORY_WINDOW`, `getWindowedEntries`, `getBudgetedEntries` in
  `public/history.js`;
- `lifted`, `getPlannedEntries`, `getDrawableEntries`, `renderBudgetNote` and a click
  handler in `public/app.js`, plus a recursive re-entry into `ensureHistory` for the case
  where the plan grew mid-pass;
- `#budgetNote`, `#budgetNoteText`, `#loadRestBtn` and three CSS rules written only for the
  button that lived inside a `.note`;
- a `held / of / reach` table in `tools/data-status.ts`, and the constant imported across
  the `tools/` → `public/` edge to build it;
- two `describe` blocks in `test/trends.test.ts`, and in `test/dom-smoke.ts` a price stubbed
  onto brutal purely so that a cut would happen at all — no real world was expensive enough
  to trigger the path inside the suite. The stub survives, now pricing the status line
  instead; the `describe` blocks tested functions that no longer exist.

Memory was never the constraint either: gordion's whole history in typed arrays is ~10 MB
at 11 B per row, and `MAX_CACHED_WORLDS = 2` caps a tab at two worlds.

## What replaced it

Nothing, on the fetching side: `getDatedEntries()` in `app.js` is the plan, and it is every
snapshot the aggregate and the manifest both know. The intersection is still load-bearing —
a snapshot the aggregate knows and the manifest does not has no URL, and counting it as
expected would leave "Historia jest niepełna" standing forever.

On the reporting side, the price moved into the status line. While a pass is running it
reads:

```
wczytywanie dokładnych danych… 4 z 12 migawek · ~1,4 MB
```

The figure prices what is **still coming** — `(available − loaded) × bytes` — not the whole
set. Snapshots already in memory from an earlier filter cost nothing to draw again, and
counting them would overstate the transfer every time after the first.

The `~` is not decoration either: `bytes` is the gzip size of the newest snapshot, used for
all of them, and the older ones are smaller because the populations grew. On aether the
whole history comes to 12 × 98.5 KB = 1.15 MB against 1.156 MB actually on disk. Close, and
§9.6 still forbids a number that might be wrong from looking like one that is right. A world
whose `bytes` is 0 — an aggregate built before the field existed, which is a real state
given separate cache lifetimes on Pages — gets no figure at all rather than "0 KB" (§9.5).

This is the whole of what is left of "transfer is bought knowingly", and it is enough: the
decision that was being protected is one a visitor makes by moving a filter, and 0.9 MB is
not a decision worth a dialog.

## What the guard is now

`test/dashboard.test.ts`, via the `dom-smoke.ts` scenario: brutal, priced by the stub at
300 KB a snapshot, is filtered and **every** one of its snapshots is fetched. One answers
503 and gets no point, which is the only reason the counter is short.

The non-vacuity is asserted beside it: `300 KB × 13 > 2 MiB`, so under the ceiling that was
removed only 6 would have been fetched. Put any budget back and the counter reads 6 instead
of 12, and the test is red. Proved by breaking it — trimming `getDatedEntries` to the last
six turned `"12 z 13 migawek · 1 nie wczytano"` into `"5 z 6 migawek · 1 nie wczytano"`, and
took the fetch-count guard down with it.

## When to come back to this

The price grows one snapshot per round. Watch it with `bun run data:status`, which now
measures the whole-history gzip per world and prints the worst case.

At roughly 50 snapshots a world, gordion reaches ~9 MB gzipped and ~42 MB of typed arrays —
and that is the point where a filtered history stops being something to hand over without
asking. **The answer then is sampling the history, not truncating it**: every third snapshot
across the whole period keeps the shape of the trend and the period it describes, where
"the newest N" silently shortens the period and produces a chart indistinguishable from a
world with less history. That is the same fault the 2026-08-26 spec was already fighting,
one level up.

What must **not** come back is a ceiling counted in snapshots. That priced a 177 KB world
like a 20 KB one and trimmed the cheapest of the twenty-one.
