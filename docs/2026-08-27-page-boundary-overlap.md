# The walk reads a ranking that moves under it

**Read at commit `eb35390`, over `public/worlds/` as it stood on 2026-08-27** — 244
snapshots, 21 worlds. Every figure below is a measurement over that material; run
`bun run data:status` for what is there now.

The question that started it was not this one. Luvia's population looked wrong.

---

## 1. Luvia's growth is real

| snapshot | rows | `pages` | walk |
|---|---|---|---|
| `2026-08-04T10-45-20` | 39087 | 391 | 8 min 23 s |
| `2026-08-16T10-38-10` | 43366 | 434 | 10 min 19 s |
| `2026-08-26T12-22-35` | 46743 | 468 | 10 min 08 s |

+4279 and +3377, against every other world drifting by a few hundred a round. It is not an
artefact. Joining the snapshots on `charId`:

| world | round | joined | left | net |
|---|---|---|---|---|
| luvia | 08-04 → 08-16 | 5539 | 1269 | +4270 |
| luvia | 08-16 → 08-26 | 4790 | 1388 | +3402 |
| aether | 08-04 → 08-16 | 336 | 427 | −91 |
| aether | 08-16 → 08-26 | 354 | 352 | +2 |
| gordion | 08-04 → 08-16 | 362 | 1006 | −644 |
| gordion | 08-16 → 08-26 | 368 | 829 | −461 |

The level distribution says the same thing: across the three snapshots the 11-50 band went
13515 → 15329 → 16927 and 51-100 went 14233 → 16246 → 17654, while ≤10 held at 5387 → 5137
→ 5035. A young world filling up, not a broken parse. It has three snapshots because it
entered `src/worlds.ts` in the 2026-08-04 round.

**Nothing was wrong with the numbers.** Checking them found something else.

---

## 2. The walk fetches some characters twice

Counting `charId`s against rows, over all 244 snapshots:

| world | snapshot | rows | repeated |
|---|---|---|---|
| luvia | `2026-08-16T10-38-10` | 43366 | 52 |
| luvia | `2026-08-04T10-45-20` | 39087 | 43 |
| luvia | `2026-08-26T12-22-35` | 46743 | 27 |
| gordion | `2026-05-28T00-06-06` | 81460 | 3 |
| classic | `2026-07-21T22-21-14` | 32396 | 2 |
| tempest | `2026-08-26T12-57-35` | 19057 | 2 |
| *(21 more, one row each)* | | | 21 |

27 of 244 snapshots carry at least one. Repo-wide: **150 repeated rows in 6 760 201**
(0.0022%), and **luvia is 122 of the 150** — one world in twenty-one, with three snapshots
out of 244.

Every repeated pair is identical in `level`, `honor` and `days`, and the pairs sit in runs.
Their positions, in `2026-08-26T12-22-35`:

```
first  second  run   first%100   second%100
31694   31700    6       94→99        0→5
31998   32000    2       98→99        0→1
42889   42900   11       89→99        0→10
44598   44600    2       98→99        0→1
45399   45400    1          99           0
45995   46000    5       95→99        0→4
```

Every run ends one page and opens the next. That is the whole mechanism: a round walks a
world at ~1 req/s for 6-13 minutes, `?page=N` is an offset into a live list, and the list
re-sorts between requests.

- A character is **inserted above** rank 100·N → everyone below shifts **down** → page N+1
  repeats the tail of page N.
- A character **leaves above** rank 100·N → everyone below shifts **up** → the characters
  between the two pages are never fetched at all.

Luvia takes ~5500 new characters a round against ~350 for aether or gordion. That is why
one world holds four fifths of the repeats.

---

## 3. The other direction is real, and leaves no trace

A character the list shifted past is simply absent. Nothing on the page says so.

It can be caught after the fact, across three snapshots: a `charId` present in *i−1* and
*i+1* but missing from *i* did not leave and come back.

| world | snapshot | rows | vanished and returned |
|---|---|---|---|
| luvia | `2026-08-16T10-38-10` | 43314 | **20** |
| aether | `2026-08-16T09-14-26` | 38818 | 0 |
| gordion | `2026-08-16T09-52-02` | 78884 | 0 |
| classic | `2026-08-16T…` | 32287 | 0 |
| brutal | `2026-08-04`, `2026-08-16` | 7751, 7678 | 0 |

Twenty is a floor — it can only see characters that came back. So the same snapshot both
double-counted 52 rows and missed at least 20 characters, and `count` was the sum of the
two errors with nothing to say either had happened: `skippedRows: 0`, no `suspect`, and the
round printed `✓ luvia: 43366 players, 434 pages — written`.

---

## 4. The `#` column is not a rank

The first design for the fix was to check that the ranks the ranking prints run
1, 2, 3, …, N — a repeat would be an overlap and a jump would be a gap, both exact, and
`parseTable` already reads the column into `PlayerRow[0]`.

**It does not work.** Probed against luvia on 2026-08-27, two requests a second apart:

```
page 2   rows 100   # runs 101..200   contiguous: true
page 3   rows 100   # runs 201..300   contiguous: true
```

The column is the row's offset — `(page − 1) · 100 + i + 1` — not a stored position. It
prints the same thing whether or not the page repeats characters, so a sequence check over
it would have found nothing while reporting that everything was fine. That is worse than no
check.

`charId` is the ranking's own identity for a character, and it cannot honestly appear twice
in one ranking. The fix keys on that instead, and `parseTable` already rejects a row whose
profile link carries no `#char_`.

**Consequence for gaps: they stay invisible.** There is no way, from the pages a walk got
back, to know what it stepped over. `count` is a floor.

---

## 5. What was done

- `src/page-overlap.ts` — `removePageOverlap` stitches the walk's pages, dropping a
  character already seen and keeping the **first** copy, because row *i* is rank *i+1* and
  dropping the earlier copy would move every row above the repeat as well. It reports
  `overlapRows` and `shiftedBoundaries`, the page seams at which the list was caught moving.
- `src/world-scraper.ts` — the walk keeps its pages apart instead of concatenating them,
  stitches once, and measures the population guard against the **stitched** count. The
  per-world line and the round summary say what was dropped.
- `src/snapshot.ts` — `overlapRows` joins `skippedRows` in the snapshot's metadata.
  Additive and optional, so `SNAPSHOT_SCHEMA` stays at 3 and every published file stays
  valid. Absent is not zero: a snapshot written before this counted anything says nothing
  about how many repeats it had.
- `tools/data-status.ts` — reports it, and says how many snapshots predate the count.

### Not done, on purpose

- **The 244 published snapshots were left alone.** §9.2 makes `public/worlds/` evidence and
  any change to it `[ASK]`; the distortion is 0.0022% repo-wide, and this note is the record
  instead. The fix applies from the next round on, which puts a seam in the data at
  2026-08-27: before it, `count` is rows walked; after it, characters seen.
- **Gaps are not re-fetched.** A re-request lands on a list that has moved again, and it
  lengthens a round that is already an hour.
- **The dashboard does not draw `overlapRows`.** The field is in the file so that a later
  round can, and `data-status` is what reads it today.

---

## 6. What it teaches

Two things, and both are in `AGENTS.md` now rather than here.

**A paginated read of a live list is not a snapshot of it.** The scraper was written as if
`?page=N` addressed a fixed thing. It addresses an offset, and everything that makes a
snapshot a snapshot — that each character appears once, that rank *i* means something —
depends on the list holding still for the length of the walk. It does not. §7.6 says so now.

**A check over a field that is contiguous by construction is worse than no check.** The
rank sequence would have passed on every snapshot including luvia's, and it would have been
reported as a verification. One probe of two pages was what separated a fix from a
comforting lie — and the probe cost two requests.
