# Spec: one world's trends over time — 2026-08-04

The project has been collecting snapshots since 2026-04-17 — today **202 snapshots from 21
worlds, 11 rounds, 109 days** — and there is not one view that shows that history. This is
item 3 on the list of ideas in [`2026-08-01-audit-2.md`](2026-08-01-audit-2.md) and the main
charge of audit #1: "despite 9 snapshots over time there is no comparison over time at all —
which is what the snapshots are collected for".

The scope of v1 is deliberately narrow: **one world, many dates**. Global totals and
comparisons between worlds are not here — the reasons are in "What v1 deliberately does not
have". This document is also the event the deleted `src/aggregate.ts` (commit `3811cea`) was
waiting for: an aggregate returns only once a view spanning several snapshots exists, and in
the shape that view actually needs. There is no code here — per rule #4 in
[`../AGENTS.md`](../AGENTS.md).

---

## What it is to show

You pick a world and get its history. Three charts and one table, all from a single file and
all about that one world.

1. **Population over time** — a line, with the real `startedAt` on the X axis. It answers "is
   this world emptying out". The data already shows it: `fobos` 25,037 → 23,719 (**−5.3%**) in
   109 days, `hutena` −3.2%, against `classic` +0.6%.
2. **Active players over time** — the same axis, a threshold switch `<24h / ≤7 days /
   ≤30 days` (**≤7 days** by default, the reason is in the traps) plus *count / share of the
   population*. The share matters more here than the count: a world can be losing players and
   growing denser at the same time.
3. **Professions over time** — six lines from `byProf`, with a *count / share* switch. It
   answers "is the distribution of professions drifting", which a single snapshot cannot show.
4. **A table of changes between consecutive snapshots** — the date, the interval in days, the
   population, the absolute delta and **the delta per day**. The intervals run 3-17 days, so
   without dividing by time "−120 players" on two rows means two different things. This is the
   first consumer of `daysBetween` (`public/app.js:218`), which is exported and tested today
   but unused.

---

## Where the data comes from — `public/trends.json`

One file for the whole history, columnar per world. Repeated object keys are half the volume,
and Chart.js takes arrays anyway.

```json
{ "schema": 1, "builtAt": "2026-08-04T…",
  "worlds": { "aether": {
    "id":        ["2026-04-17T16-41-43", …, "2026-08-04T09-28-31"],
    "startedAt": ["2026-04-17T14:41:43.303Z", …, "2026-08-04T09:28:31.682Z"],
    "total":     [39849, 39648, 39521, 39454, 39445, 39435, 39287, 38976, 39037, 38909],
    "act":       [[3253, …, 5139], [4390, …, 3128], [3310, …, 3238],
                  [28858, …, 27264], [38, 51, 55, 71, 98, 112, 116, 122, 139, 140]],
    "byProf":    [[10824, …], [8771, …], [6484, …], [4957, …], [3457, …], [5356, …]],
    "suspect":   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } } }
```

`act` is ordered `[<24h, ≤7 days, ≤30 days, >30 days, never]` — the buckets are **disjoint**,
as in `activityBucket` (`public/app.js:64`), so "active ≤7 days" is the sum of the first two.
`byProf` is ordered by profession 1-6. Row *i* of every column is the same snapshot — exactly
the same convention as the `.f.json`/`.n.json` pair.

The structure is narrowed by the view's scope, but it does not close the road ahead: global
totals and comparisons between worlds are computed from this same file, with nothing
regenerated.

**One file, not a file per world.** The whole thing is 23.9 KB raw / **9.0 KB gzipped**; a
slice for one world is ~0.6 KB gzip, but 21 separate files weigh 11.9 KB together, because
each pays its own compression header. At 9 KB for the full set, switching worlds is to be
instant, with no further fetch.

## Is that too much data? No, and by three orders of magnitude

If the view fetched `.f.json` for every date, one gordion's history alone would be 1.8 MB
gzipped and 800 thousand rows to parse on every visit; the whole thing is **64.0 MB raw /
14.9 MB gzipped** and 5,579,205 records. The aggregate is 9.0 KB for all 202 snapshots — one
fetch, **~1,700× less transfer**, ~121 B per snapshot.

The variants considered (all 202 snapshots, `JSON.stringify` without indentation):

| variant | raw | gzip |
|---|---|---|
| `total` + activity [5] only | 13.4 KB | 4.9 KB |
| **chosen: + professions [6], `id`, `suspect`** | **23.9 KB** | **9.0 KB** |
| + level quantiles (p50/p90/p99/max) | 22.3 KB | 8.6 KB |
| + activity × profession [30] | 42.1 KB | 17.5 KB |
| + a full level × profession histogram | 1,655 KB | 382 KB |

Against the budget in [`2026-08-01-size-budget.md`](2026-08-01-size-budget.md): `public/` is
137 MB out of a 1 GB limit, a scrape round adds ~13.9 MB, and there is headroom for ~65 rounds.
`trends.json` adds **~2.5 KB per round** (21 × 121 B) and would be ~190 KB once the entire
headroom is used up. That is 0.02% of a round's growth. Size is not an argument on either side
of this decision.

The last row of the table is why a level histogram over time is not here: 43× larger, it forces
a file-per-world split and answers a different question.

## What builds it

A new `src/trends.ts`, a pure function over the `FilterFile` type from `src/snapshot.ts` — the
shape of the deleted `buildAggregate` (`git show 3811cea^:src/aggregate.ts`), but without
`levels` and without `HONOR_BUCKETS`, which this view does not read. Called from
`src/rebuild_data.ts` and at the end of a scrape round alongside `rebuildManifest()`
(`src/world_scraper.ts`).

A full scan of 202 files with the bucket counting takes **0.9 s** under Bun — a separate pass
from the manifest's, even though `rebuildManifest()` parses the same 64 MB to lift out
`startedAt` (`src/manifest.ts:31-80`). The saving would be worth 0.9 s against a round lasting
~1.6 h, and the price would be sewing the two modules together so that the trends cannot be
rebuilt without the manifest, or the other way round. The file is rebuilt in full: cheaper
than keeping an incremental update consistent.

A snapshot without `startedAt` is skipped — there is nowhere to put it on the time axis — and
`bun run rebuild` prints how many dropped out. Losing data silently is not allowed.

## Where the view lives

A separate page, `public/trends.html` + `public/trends.js`, with a link in both pages' headers:
zero risk of regression for the working dashboard, its own URL state, its own test file. The
price is duplicated CSS between the pages.

The shared pieces (`PROF`, `PROF_COLORS`, `activityBucket`, `capitalize`, `formatSnapshotDate`,
`daysBetween`) move out of `app.js` into a new `public/shared.js`. It has to be a separate
module rather than an import from `app.js`: `app.js` starts `setupDashboard()` as soon as it
loads, so borrowing one function from it would break trends.html on a missing
`#profCheckboxes`. A test holds this. `index.html` gets only a link in its header; the rest of
the dashboard is unchanged.

Chart.js is already vendored locally and the `line` type is enough for all three charts, but
**the X axis cannot be a time scale** — that needs a date adapter we do not vendor, and adding
a second front-end dependency for three charts does not pay. Instead: a linear scale in epoch
milliseconds, with ticks placed exactly at the snapshots, so 3-17 day intervals come out
proportional and we format the labels ourselves.

---

## Traps

**"Online <24h" measures the hour of the scrape, not the game.** The rounds started at 04Z,
06Z, 09Z, 10Z, 14Z, 15Z, 20Z and 21Z, on different weekdays, and one round lasts ~1.9 h, so
even worlds within the same round are sampled at different times. The effect across 20 stable
worlds over 10 rounds:

| metric | variability (CV) |
|---|---|
| population | **0.6%** |
| active ≤30 days | 3.4% |
| active ≤7 days | 8.1% |
| online <24h | **14.7%** |

The resolution: show all three thresholds, default to ≤7 days, put the snapshot's UTC hour in
the tooltip, and one sentence of warning above the chart. Hiding <24h would be hiding data.

**The intervals between snapshots are uneven — 3-17 days.** The X axis has to be continuous
time from `startedAt`, never a snapshot index, and every delta between neighbouring points has
to be divided by `daysBetween`, otherwise it compares three days' growth against seventeen
days' growth.

**A snapshot's `id` is not a date.** In the example above `2026-04-17T16-41-43` corresponds to
`2026-04-17T14:41:43.303Z` — files from before August 2026 carry local time in the name, newer
ones UTC. At the seam between the formats the chart would carry a 2 h error. The only source
of time is `startedAt`.

**Not every world has the same number of points.** `brutal` has 11 snapshots (an extra shot on
2026-08-01), the rest have 10, `luvia` has 1. A one-world view has to cope with a
single-point series: one point is a valid state, not an error — show the point and a message
saying it is too early for a trend.

**`suspect` has to be visible on the chart.** There are 0 such snapshots today, but the guard
writes a truncated round instead of rejecting it, and a population drop of over 5% is
indistinguishable on a chart from a real drop. A `suspect` point is to be drawn with a hollow
marker.

**`days === null` is an account never used, not an inactive one.** Its own "never" bucket, and
never in the denominator of "active". In aether it grows 38 → 140 over 109 days, so it is a
signal about new registrations in its own right.

**The `charId` seam does not concern this view.** Aggregates count a population; they do not
follow individuals. The problem from audit #2 ("a nickname is not stable, only snapshots from
August 2026 onwards have `charId`") weighs on the player-progression idea, not on this spec.

---

## Pros and cons

**For:** the whole history in one 9.0 KB fetch, so switching world and threshold is instant;
the data is already there and nothing has to be re-scraped; the working dashboard stays
untouched; `daysBetween` finally gets a consumer; the format does not close the road to
comparative views.

**Against:** a new artefact to maintain in two places (scrape and rebuild); a format frozen at
`schema: 1`, whose extension requires regeneration (cheap — 0.9 s); duplicated CSS between
`index.html` and `trends.html`; and the most important thing — **10-11 points on a time axis
are too few for conclusions about seasonality**. The view will show a population trend
credibly, and will mostly document the swings in activity rather than explain them.

## What v1 deliberately does not have

**Global totals and comparisons between worlds.** Not for lack of data — `trends.json` has all
of it — but because both require decisions this view does not need. A global total falls apart
on a changing set of worlds: `luvia` exists only in the last round and is 41.3% online (16,134
of 39,087), so dropping it into a total produces a jump of 16 thousand out of nothing — the
intersection of worlds has to be chosen deliberately, with joiners drawn separately. A
comparison between worlds, in turn, needs normalisation, because gordion (79,528) flattens
brutal (7,751) into a line near zero. Both belong to their own round of work, once the
one-world view has proved itself.

Beyond that: a level histogram over time (382 KB gzip, a file per world), a single player's
progression (`.n.json` + the `charId` seam), the top N changes between snapshots, honor in the
aggregate.
