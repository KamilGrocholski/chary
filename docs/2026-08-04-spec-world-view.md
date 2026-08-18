# Spec: one world view with a filterable history — 2026-08-04

After [`2026-08-04-spec-trends.md`](2026-08-04-spec-trends.md) the project has two views that
cannot do the same things. `index.html` filters exactly — level, honor, profession, activity —
but only within **a single snapshot**. `trends.html` shows **the whole history**, but global
totals only, without a single filter.

The questions this data is collected for lie exactly at the intersection: *are paladins 250+
with honor above 10 thousand becoming fewer or more numerous?* Today neither view can be asked
that, even though the data has been on disk since April.

This document settles two things at once, because they are the same thing: **can the history be
filtered on the client** (it can, with three orders of magnitude to spare over what is needed)
and **should the two views stay two** (they should not). There is no code here — per rule #4 in
[`../AGENTS.md`](../AGENTS.md).

---

## What it is to show

You choose the world and the filter **once, at the top**. Everything below answers the same
question, only at two scales of time.

```
┌─────────────────────────────────────────────┐
│ Świat: [gordion ▾]              [⎘ kopiuj]  │
│ Poziom [250]–[400]  Honor [1000]–[    ]     │
│ Online [≤ 7 dni ▾]  ☑Woj ☐Mag ☑Pal ☐Tro ... │
│                                   [Wyczyść] │
├─────────────────────────────────────────────┤
│ Pasuje: 1 749 z 79 528  (2,2%)              │
├── PRZEKRÓJ ── migawka: [04.08.2026 ▾] ──────┤
│ ▇▇▆▅▃▂▁  Level wg profesji                  │
├── HISTORIA ── 10 migawek, 109 dni ──────────┤
│ ╲___╱‾╲  Pasujących w czasie                │
│ ╲╲__╱‾╲  Aktywnych ≤7 dni                   │
│ ══════╲  Profesje                           │
│ [tabela zmian: data · odstęp · Δ · Δ/dobę]  │
└─────────────────────────────────────────────┘
```

1. **The match bar** — `Pasuje: N z M (x%)`. The denominator `M` comes from `trends.json`, so
   it appears immediately, before anything large is fetched.
2. **The cross-section** — a level × profession histogram for the chosen snapshot. This is
   today's dashboard, with no change in behaviour.
3. **The history** — today's three charts and the change table, **but computed under the
   filter**. "Population over time" becomes "matches over time", and that is the entire new
   value of this view.

The filter governs both sections at once. That is the only reason merging them is worth it —
placing them side by side alone would not be worth the risk.

---

## Can the history be filtered on the client? It can, with room to spare

Measured on real data, not estimated. Gordion, the largest world, 10 snapshots:

| | |
|---|---|
| the `.f.json` history | 9.1 MB raw / **1.86 MB gzipped** |
| rows | 813,542 |
| `JSON.parse` over all of it | 81 ms |
| conversion to typed arrays | 38 ms |
| in memory after the conversion | 7.3 MB |
| **a full filter pass over the whole history** | **2.8–7.0 ms** |

For comparison: `brutal` is 0.22 MB gzip, a whole round of 21 worlds is 1.51 MB gzip, and all
202 snapshots are 14.9 MB gzip — and that last figure is why the axis of this view is **one
world**, not "everything at once".

The number that settles it: **grinding 813 thousand rows through a full filter takes less than
one frame.** Filtering is not a problem to be solved here, just something that works. The
150 ms debounce from `public/app.js:396` stays as it is and still has enormous room to spare.

**Rejected: a precomputed multidimensional aggregate (a "cube").** The natural instinct is to
compute level × profession × activity buckets in `src/trends.ts` and ship those instead of raw
snapshots. The price is threefold and no part of it is acceptable: bucketing turns an **exact**
filter into an approximate one at the bucket edges; **honor does not fit** into a cube at any
sensible size (a range of −35 .. 1,224,565); and a file holding just a level × profession
histogram is 382 KB gzip (the variants table in the trends spec) — i.e. 40× more than
`trends.json`, to get a worse answer than 7 ms of CPU work. A cube has no argument here beyond
habit.

That also closes the last row of the trends spec's variants table for good: a level histogram
in the aggregate is no longer "too expensive" but **unnecessary** — the client computes it
exactly, for every snapshot rather than only the chosen ones.

### Why this does not contradict the trends spec

The trends spec computed that the aggregate is **~1,700× less transfer** than raw `.f.json`,
and that is still true. This spec does not reverse it; it adds a second path alongside:

| path | what it fetches | when |
|---|---|---|
| **default** | `manifest.json` + `trends.json` + one snapshot | always — the same as today |
| **exact** | one world's `.f.json` history | only after the filter is moved |

`trends.json` remains the only source for an unfiltered visit, and the denominator of the match
bar. Whoever only glances at the population chart pays 9 KB — exactly as today. The 1,700×
argument concerns the default path and stands; the exact path is a knowing purchase of
0.2-1.9 MB, made on an explicit user action and for one world only.

### Effect on the GitHub Pages limit: none

This view **adds not a single byte to the published data** — it reads files that are already
there, fetched one at a time today. The budget in
[`2026-08-01-size-budget.md`](2026-08-01-size-budget.md) does not move: `public/` is
**142.6 MB** out of a hard 1 GB limit, a round adds ~13.6 MB, and there is headroom for
**~63 rounds ≈ 2 years**.

The only new cost is **transfer**, not space. Against a soft limit of 100 GB/month on Pages and
a worst case of 1.86 MB per filtering visit, that comes to ~54 thousand such visits per month.
For this project that is not a constraint.

---

## The data layer

The core is one sentence: **the client builds an object of exactly the same shape as a
`trends.json` row, only filtered.**

```
summarizeFiltered(snapshot, filter) -> { total, act[5], byProf[6] }
```

That is what lets `activeCounts`, `shareSeries`, `changeRows`, `summarize` and the whole
`renderCharts` from `public/trends.js` work **without a single change** — they simply receive
different numbers. There is no new drawing code at all.

That it really is the same shape has been measured, not assumed: computing
`{total, act, byProf}` straight from the raw `.f.json` for **all 202 snapshots** and comparing
against the published `trends.json` gave **0 discrepancies**. That is a ready-made test and has
to remain one — the default filter computed on the client must give number for number what
`src/trends.ts` computed on the server. The test then compares two independent implementations
against the same raw data, rather than a reimplementation of itself (rule #7).

One pass, not two. Today's `countByLevel` and `countByActivity` (`public/app.js:78` and `:94`)
walk the array separately; across a history that is 2N passes instead of N.
`summarizeFiltered` computes `total`, `act` and `byProf` in one `for`. The level histogram stays
separate, because only the chosen snapshot needs it.

**Typed arrays, not `number[]`.** The ranges measured across all 5,579,205 rows:

| column | range | type | B/row |
|---|---|---|---|
| `level` | 1 .. 500 | `Int16Array` | 2 |
| `profession` | 1 .. 6 | `Uint8Array` | 1 |
| `honor` | **−35 .. 1,224,565** | `Int32Array` | 4 |
| `days` | 0 .. 6598, plus 11,095 `null` | `Int32Array`, `null` → **−1** | 4 |

11 B/row in total, i.e. **8.9 MB for the whole of gordion**, against several times that
overhead with plain JS arrays. The conversion happens once, right after the fetch, and the
parsed JSON goes straight to the garbage collector — file by file, so that the memory peak is
one file rather than ten.

`days` in 32 bits, even though the measured maximum (6598) fits into 16 with room to spare: an
overflow would wrap to a **negative** number, i.e. silently turn a player from years ago into
an account never used. Two bytes per row is a cheap price for ruling out a whole class of bug.

The cache is held **in memory, per world**. Not in `sessionStorage`: 9 MB does not fit in the
quota anyway, and serialising back to a string would cost more than re-fetching from the HTTP
cache.

## The fetching strategy: lazy, on the first filter move

Arriving at the page costs **exactly what it costs today**: `manifest.json`, `trends.json` and
one snapshot for the cross-section. The history draws immediately from the aggregate.

The first change to any filter starts fetching the rest of that world's snapshots in the
background. The history charts fill in point by point, with visible progress. Whoever does not
filter pays nothing — the same logic by which the trends spec justified moving `trends.json`
out of the manifest ("9 KB added for everyone is a cost with nothing behind it").

**Rejected: fetching in the background right after arrival.** The filters would work with no
wait, but every visit to gordion would cost 1.86 MB, including somebody who came to look at one
histogram.
**Rejected: a "compute exactly (1.9 MB)" button.** The most honest option with regard to
transfer, but a filter that does not move the charts until you click a second thing is simply
broken.

---

## What changes in the code

- **`public/shared.js`** takes over the filter core from `app.js`: `emptyFilters`,
  `ACTIVITY_BOUNDS`, `activityLabel`, `visibleActivityBuckets`, `filtersToParams`,
  `filtersFromParams`, the currently private `matches` (`public/app.js:61`) and the new
  `summarizeFiltered`. That module's contract is unchanged — no DOM, nothing started on
  import — and a test still holds it (`test/trends.test.ts:386-394`).
- **A history loader**, a new module. It takes a world's snapshot list from the manifest,
  fetches them with limited concurrency, converts them to typed arrays, caches them per world
  and reports progress. It has to be pure, so it can be tested without a browser.
- **`public/index.html` + `public/app.js`** become the merged view; the history section moves
  over from `trends.js`. Reused without rewriting: `countByLevel`, `totalsFromCounts`,
  `renderChart`, `renderTooltip` on the cross-section side, and `activeCounts`, `changeRows`,
  `summarize`, `pointStyle`, `chartOptions` on the history side.
- **`public/trends.html`** stays as a redirect preserving the query string. The two pages'
  parameter sets do not collide —
  `minLevel/maxLevel/minHonor/maxHonor/maxDays/prof/world/date` against `world/prog/udzial` —
  so one page reads both and **every link shared so far keeps working**.
- **Tests**: `test/dashboard.test.ts` and `test/trends.test.ts` divide along the new boundary,
  and `test/dom_smoke.ts` gets the new arrangement of controls.

The duplicated CSS between `index.html` and `trends.html` disappears — a drawback written
explicitly into the trends spec's "Against" section.

---

## Traps

**The `−1` sentinel for `days === null` is a bug waiting to happen, and one that inverts the
meaning of the data.** After conversion to an `Int16Array` `null` has to become something, and
the condition `days > maxDays` is **false** for `−1` — so a naive filter would let accounts
never used into every activity threshold, the exact opposite of what `public/app.js:71` does
today. The `days < 0` check has to come first, not be added afterwards.

**The activity filter eats the activity chart.** Once the user sets "online ≤ 7 days", the
"active ≤ 7 days" series on the history chart equals the "matches" series by definition, and the
"≤ 30 days" threshold does too — because nobody past the filter's threshold enters the set. That
is not a data error but the same question asked twice. The view has to name it: with a `maxDays`
filter active, thresholds above it are dead and are to be disabled or explained, never drawn as
three lines on top of each other that look like confirmation of something.

**Two activity scales meet in one file.** `ACTIVITY_BOUNDS` in `app.js` is **disjoint**,
`ACTIVITY_THRESHOLDS` in `trends.js` is **cumulative**. Today a file boundary separates them;
after the merge they will sit side by side in one module. `AGENTS.md` warns against confusing
them outright, because it costs the whole "< 24h" bucket — which field governs which chart has
to be named, and left in a comment rather than in the author's memory.

**"Share" needs an explicit denominator.** Under a filter, a profession's share can mean two
things: a part of the **filtered** set (which sums to 100% and says nothing, because the
professions are a filter too) or a part of the **world's population** in that snapshot. The
second one. The denominator stays `total` from `trends.json`, the same one that stands in the
match bar.

**Progressive filling must not lie.** While the history is loading, the filtered series is drawn
**from the loaded snapshots alone**. An unloaded snapshot means no point — never interpolation
and never a substituted unfiltered value from `trends.json`, because the chart would then show a
jump that is not in the data.

**Zero matches is a result, not a failure.** A narrow filter will give 0 in some snapshots. The
history chart is to draw a zero there, not a hole and not an error message — a hole suggests a
missing snapshot, which is something that genuinely happens in this data and has to stay
distinguishable.

**`honor` can be negative** — the measured minimum is −35 across 5,579,205 rows. No
`Math.max(0, …)` when building the fields or validating a range.

**`suspect` has to survive the merge in both forms.** A hollow marker on the history charts and
a warning bar above the cross-section are two different mechanisms for the same flag, and after
a merge it is easy to lose one of them.

**Intervals of 3-17 days, and an `id` that is not a date** — both traps from the trends spec
apply unchanged. Every delta divided by `daysBetween`, and `startedAt` as the only source of
time.

Tests this change will overturn and that **have to stay rather than disappear**:
`test/trends.test.ts:317-322` currently requires the history view to fetch `trends.json` only —
it is to permit `manifest.json` and `worlds/…/*.f.json` paths while still holding the absence of
external dependencies. `test/dom_smoke.ts` builds its nodes with a regex over `id="…"` and
assumes the first listener on `#worldSelect` is `render`; every `el("…")` has to stay a literal,
otherwise the consistency test against the HTML stops holding anything.

Incidentally, found while reading the code for this document: `#popChart` never responds to
"share" mode (`public/trends.js:222-235`), even though under a filter the matches' share of the
population is a sensible metric; the `> 30 days` and `never` buckets are in `trends.json` but no
chart shows them, even though the trends spec treats aether's 38 → 140 growth as a signal;
`entryAt` (`public/trends.js:186-191`) is O(n) and allocates `snapshotEntries` on every call,
twice per tooltip; date formatting sits in `trends.js` in three places.

---

## Growth over time and a safety threshold

The history grows linearly: **~185 KB gzip per additional gordion snapshot**. Today 1.86 MB, but
it will not stay today's.

| snapshots | gordion's history (gzip) | rows | filter pass |
|---|---|---|---|
| 10 (today) | 1.86 MB | 0.81M | 2.8-7.0 ms |
| **16 (in ~6 rounds, ~2.5 months)** | **3.0 MB** | 1.3M | ~11 ms |
| 73 (once the Pages headroom is used up) | 13.5 MB | 5.9M | ~51 ms |

The constraint is **transfer, not the CPU** — even an extreme 5.9M rows fits inside the 150 ms
debounce with enormous room to spare (the figures for 16 and 73 snapshots are extrapolations of
a measured 8.6 ns/row, not measurements).

The resolution: **a default window — the last N snapshots** (`HISTORY_WINDOW = 12`) and an
"N of M snapshots" counter always visible, since it doubles as the fetch progress bar. Trimming
the range without saying so reads as a complete set of data and is worse than not having the
feature.

The 3 MB threshold falls in about six rounds, so the window is not a "for later" thing in the
sense of rule #4 — it is needed in the same implementation as everything else. There is **no**
"load the whole history" button: the longest history today is 11 snapshots, so the window cuts
nothing, and a control that never renders is exactly the dead code this project has already
deleted a module and a constant for. It arrives with the first world that exceeds the window.

Interaction with the budget's rescue plan: step 2 in
[`2026-08-01-size-budget.md`](2026-08-01-size-budget.md) is gzipping `.f.json` in the repo with
manual decompression through `DecompressionStream`. The two do not conflict — the budget already
assumes decompression in the browser, and the history loader is the only place that would then
have to change.

---

## Pros and cons

**For:** the question this data is collected for becomes askable — the filter works across the
whole history, exactly, without bucketing; it adds not a byte to the 1 GB on Pages; an
unfiltered visit costs what it costs today; the duplicated CSS and the second URL state
disappear; the history charts need no new drawing code, because they receive the same shape of
data as today; old links keep working.

**Against:** this is **rewriting both working views at once** — the largest risk of regression
this project has taken on, spanning two test files and the DOM stub, while the previous round
deliberately chose a separate page precisely to avoid touching the dashboard. Beyond that:
1.86 MB is a real cost on a slow connection, lazy or not; the "last N snapshots" window adds
state that has to be shown and tested; complicating the filter panel also hits somebody who came
for the histogram alone. And the most important thing — **a filter does not fix the sample**.
There are still 10-11 points on a time axis at uneven 3-17 day intervals, so "paladins 250+ fell
by 4%" remains an observation from ten measurements, not a trend. The view will allow a sharper
question to be asked, but it will not add statistical power the data does not have.

## What is deliberately not here

**Global totals and comparisons between worlds** — the justification from the trends spec stands
in full (`luvia` exists in one round and overturns a total, gordion flattens brutal without
normalisation), and client-side filtering changes nothing about it: at 14.9 MB gzip for the full
set of snapshots, filtering many worlds at once exactly is out of a browser's reach anyway. The
axis of this view is one world, and that is not temporary.

**A level histogram over time** as a separate chart — the data is there (the client has the full
set of snapshots), but a single level × time heat map is a different question and a different
round of work.

**A player search and a single character's progression** — still blocked by the `charId` seam
from [`2026-08-01-audit-2.md`](2026-08-01-audit-2.md), and `.n.json` still has no consumer. This
spec does not provide one.

**Extending `trends.json`** — it stays at `schema: 1`. Everything the view needs beyond the
aggregate it computes itself from `.f.json`, exactly and under the filter.
