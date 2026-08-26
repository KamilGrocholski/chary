# The ceiling on a filtered history: bytes, not snapshots

The history view has two paths to the same charts. Without a filter it draws
`public/trends.json` — the folded aggregate, 11 KB gzip, complete for every world. With a
filter it has to compute from the raw `.f.json` files of that one world, which is where the
transfer goes, so that path carries a ceiling.

Until this round the ceiling was `HISTORY_WINDOW = 12` — a count of snapshots. This
document is why that unit was wrong, what replaced it, and what the replacement does as the
history grows.

---

## What the data said

Measured over `public/worlds/*/`, gzip, on 2026-08-26 (12 rounds, 244 snapshots):

| world | one snapshot | whole history | snapshots |
|---|---|---|---|
| gordion | **177 KB** | **2166 KB** | 12 |
| aether | 96 KB | 1178 KB | 12 |
| majuna | 86 KB | 1031 KB | 12 |
| … | | | |
| berufs | 38 KB | 459 KB | 12 |
| **brutal** | **20 KB** | **258 KB** | **13** |
| luvia | 66 KB | 176 KB | 3 |

**A count of snapshots prices gordion and brutal the same.** They differ by 8.8×.

Three things followed from that, and all three were visible in the live data:

1. **The ceiling cut the wrong world.** The only world over the window was brutal — the
   cheapest of the 21 — so the trim saved 19 KB. gordion, the one world the ceiling exists
   for, sat at exactly 12 and was untouched.
2. **It fired on an accident, not on growth.** brutal has 13 snapshots because a
   single-world scrape ran on 2026-08-01; no other world has that date. The rounds are 12.
   A ceiling that trips on a manual test run is measuring the wrong thing.
3. **One world had two different time axes.** The unfiltered path drew all 13 points from
   the aggregate (from 17 Apr), the filtered path drew the window's 12 (from 30 Apr). Typing
   a level moved the left edge of the chart, and nothing said so.

gordion's own data was checked at the same time and is sound: `count` agrees with both
files in all 12 snapshots, the ranking tail is present (last level = 1), no 1969 sentinel
leaks in as a number, no profession outside 1-6, population falling smoothly 82922 → 78424.
The problem was never the data.

---

## The decision

**The ceiling is a transfer budget: `HISTORY_BUDGET_BYTES` = 2 MiB per world.** The view
fetches the newest snapshots that fit, never fewer than two. 2 MiB is the worst case
[`2026-08-04-spec-world-view.md`](2026-08-04-spec-world-view.md) already weighed and
accepted (gordion, 1.86 MB at the time); the change is the unit, not the appetite.

What that does today:

| world | fits | has | trimmed |
|---|---|---|---|
| gordion | 11 | 12 | **yes — 1 snapshot, 177 KB** |
| aether | 21 | 12 | no |
| brutal | 102 | 13 | no |

One world is trimmed, and it is the one where trimming is the difference between 1.9 MB and
2.1 MB. Nineteen worlds get their whole history under a filter, brutal included — its 13
snapshots cost less than a quarter of what gordion charges for two.

### Where the number comes from

`trends.json` carries one `bytes` per world: the gzip size of that world's **newest**
`.f.json`, measured by `rebuildTrends` with `Bun.gzipSync`. Schema bumped 1 → 2.

- **Rejected: a size per snapshot in `manifest.json`.** Measured: 5835 → 7164 B gzip, i.e.
  **+1.3 KB on every visit for everyone**, whether they filter or not. That is the same cost
  that got the trends split out of the manifest in the first place. The per-world field cost
  **+96 B** (`trends.json` 11054 → 11150 B gzip).
- **Rejected: the raw size times a constant ratio**, which would need no compression pass at
  all. The ratio is 4.18 for brutal and 4.85 for gordion — a constant misjudges one of them
  by ~15%, and the number it misjudges is the one deciding what to download.
- **Only the newest file is compressed** — 21 of them per rebuild instead of 244. Within one
  world the sizes barely move (gordion 177-185 KB across its 12), and what the budget needs
  is the price of the *next* snapshot, which is exactly what the newest one is.

### The axis belongs to the aggregate, not to the fetch

`tickValues`, the tooltips and `scales.x.min/max` all come from the world's entry in
`trends.json`, on **both** paths. The filtered series then simply starts where the fetched
data starts, and the part the budget left out stays visibly empty.

Nothing is drawn in that gap — no interpolation, no substituting the unfiltered number from
the aggregate. It is the same rule that already governs a snapshot that failed to load, and
for the same reason: a line drawn across a hole is a claim nobody measured.

The summary line follows: "Zmiana od pierwszej migawki" becomes "Zmiana od 30.04" whenever
the drawn range is shorter than the axis. The number counted from June must not be labelled
with April.

### Buying the rest

`#budgetNote` names what was left out and what it costs, and carries the button that fetches
it: *Dociągnij resztę historii (+177 KB)*. The lift is per world and survives switching
worlds and back.

This is the "load the whole history" control that
[`2026-08-04-spec-world-view.md`](2026-08-04-spec-world-view.md) deliberately did not build,
on the grounds that nothing exceeded the window yet and a control that never renders is dead
code. With the ceiling in bytes it has a consumer on the day it ships: gordion.

---

## Traps

- **`bytes` can be missing.** `trends.json` and `history.js` are separate files on Pages with
  separate cache lifetimes, so a fresh script meeting an aggregate built before this change
  is a real state. `budgetedEntries` falls back to `HISTORY_WINDOW` there — a count is a poor
  ceiling but "no ceiling" would hand somebody gordion's whole history unasked. That is the
  only reason the constant still exists.
- **Two snapshots minimum, even when they do not fit.** One point is not a trend, and the
  snapshot view above already answers "how many are there now".
- **The plan can grow mid-fetch.** `loadHistory` hands a second caller the pass already in
  flight, and that pass was planned smaller — so pressing the button during a load would hide
  the note and fetch nothing. `ensureHistory` re-runs itself when the plan grew while it was
  waiting. It compares *lengths*, not "is anything still missing": a snapshot that failed
  stays missing, so the latter would never terminate.
- **What is drawn is the plan ∪ what is already in memory.** Otherwise lifting the budget and
  then touching a filter would take the extra points away again.
- **The counter counts against every dated snapshot**, never against the plan:
  `11 z 12 migawek · limit transferu 2,0 MB`. Counting against the plan would report a
  trimmed history as a complete one — which is exactly what the old window did.

---

## Growth

The budget slides rather than accumulates: gordion keeps its newest 11 snapshots for good,
so its filtered chart covers ~5 months of an ever-longer axis, while the unfiltered chart
keeps covering everything. Rounds remaining before a world first meets the ceiling, at the
current one-round-per-~10-days pace:

| world | fits | rounds away |
|---|---|---|
| gordion | 11 | **0 — trimmed now** |
| aether | 21 | 9 |
| majuna | 23 | 11 |
| berufs | 54 | 42 |
| brutal | 102 | 89 |

Worlds do not grow evenly: a snapshot's size follows its population, and gordion's is
falling (82922 → 78424 since June), so `bytes` is re-measured on every rebuild rather than
being written down once.

When gordion's 11 snapshots stop being enough history to read a trend from, the answer is
not a bigger budget — it is downsampling the old end (one point a month past six months),
which costs nothing to store because the aggregate already holds every point. Not built:
nothing needs it yet.

---

## What this does not change

- The unfiltered path. Whoever does not filter still pays 11 KB and sees every point.
- The exactness of the filtered numbers. Nothing is bucketed or approximated; the only thing
  the budget decides is *how many* snapshots are counted exactly.
- `public/worlds/` and the 1 GB Pages limit — see
  [`2026-08-01-size-budget.md`](2026-08-01-size-budget.md). This is about what one visitor
  downloads, not about what the repository stores.
