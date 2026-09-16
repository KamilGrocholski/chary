# The view opens on a filter

2026-09-16, the same round as [`2026-09-16-redesign-rail.md`](2026-09-16-redesign-rail.md), a
separate subject. "Ostatnio online (maks. dni)" now starts at **30** instead of at everybody.
Two things follow that are not obvious from the diff, and this note exists for whoever meets
either of them later.

## A link shared before today means something else now

`maxDays` absent from the query string used to mean "no limit". It now means the default, so
the unfiltered state needed a spelling of its own: `maxDays=all`, which
`composeFiltersParams` writes on every link from now on.

⚠️ **Every link shared before this carries no `maxDays`, so it now opens on 30 days rather
than on everybody.** Nothing can be done about that from here — the old links do not say what
they meant, because at the time there was nothing to say. `test/dashboard.test.ts` holds the
round trip in both directions so the new spelling cannot quietly go the same way.

## Every first visit now fetches that world's whole history

`isDefaultFilters` is unchanged and still means *the filter rejects nothing, so the 9 KB
aggregate is an exact answer*. A 30-day default rejects, so it cannot use that path: the view
opens by fetching every `.f.json` of the selected world.

Priced from `bytes` in `trends.json` on 2026-09-16, gzip, per world's whole history:

| | |
|---|---|
| gordion, the worst | 15 × 177 KB = **2.59 MB** |
| aether, the default world | 15 × 97 KB = **1.42 MB** |
| the median world | **1.01 MB** |
| brutal, the cheapest | **0.31 MB** |

That was a deliberate trade, not an oversight: `docs/2026-08-28-history-without-a-budget.md`
removed the transfer ceiling after measuring exactly these numbers, and the fetch is
progressive — the chart fills in snapshot by snapshot and `#historyStatus` prices what is
still coming while it comes.

**Why the aggregate cannot serve it anyway.** "≤ 30 dni" with nothing else set is exactly
`act[0] + act[1] + act[2]`, which `trends.json` already holds, so the population line and the
activity line could have been free. `byProf` could not: it is per profession and not crossed
with activity, so "Profesje w czasie" under a 30-day filter has no answer in the aggregate.
Serving two of the three charts from it and the third from files would mean two accuracies on
one screen with nothing saying which is which — §9.6.

## Two consequences visible on a first visit

- **"Resetuj filtry" no longer returns to the complete aggregate.** It gives what a fresh
  visit gives, which is the 30-day filter; anything else would be a second meaning of
  "default". The way back to the complete history — the one that includes a snapshot whose
  file cannot be fetched — is clearing the activity field, and a test holds that path.
- **`#thresholdNote` now shows by default.** At a 30-day filter the "≤ 30 dni" threshold would
  count exactly the players the matches chart already draws, so `usableThresholds` removes it
  and the note says why. Correct, but it has stopped being a signal: it is on screen for
  everybody, every time, rather than when somebody has narrowed something.
