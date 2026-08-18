# The size budget against the GitHub Pages limit

As of **2026-08-01**, after splitting the snapshots into `.f.json` / `.n.json`.
A companion to [`2026-08-01-audit.md`](2026-08-01-audit.md) (section 2), where the figures
describe the state **before** the fix.

## The arithmetic

| | |
|---|---|
| `public/` now | **118.2 MB** |
| growth per scrape round | **~13.9 MB** |
| the published-site limit on GitHub Pages | 1 GB (hard) |
| headroom | 906 MB |
| **rounds until the limit** | **~65** |
| at a pace of roughly every 12 days | **~2 years** (to around mid-2028) |

What makes up a round's growth (21 worlds, 548k players + `luvia`):

- 6.0 MB — the `.f.json` files (level/profession/honor/days), 11.5 B per player,
- 7.0 MB — the `.n.json` files (nicknames + `charId`), 13.4 B per player,
- 0.9 MB — `luvia`, added to `src/worlds.ts`.

There are no aggregates — the dashboard filters `.f.json` exactly, so they would be a dead
file, and the code that computed them was deleted for having been written on spec. When a
view spanning several snapshots at once appears, an aggregate will be computed from
`.f.json` in a dozen or so lines matched to what that view actually needs (~8 KB per
snapshot).

## How this has changed

| state | occupied | per round | rounds to the limit |
|---|---|---|---|
| before the overhaul (pretty-printed, schema v1) | 620 MB | 38.6 MB | ~10 |
| after minifying + aggregates (schema v2) | 340.6 MB | 22.7 MB | ~30 |
| **after the `.f`/`.n` split (schema v3)** | **118.2 MB** | **13.9 MB** | **~65** |

Where such a drop came from on the move to v3: the duplicated text "Mniej niż 24h temu" and
the derived ISO timestamp (v1) are gone, the rank is gone (it is reconstructible from the
row order), and so are the JSON braces repeated on every row.

## Transfer on arriving at the dashboard

Pages serves JSON with `content-encoding: gzip` (checked against the live `manifest.json`),
so what counts is the compressed size:

| world | players | `.f.json` | gzipped |
|---|---|---|---|
| gordion (largest) | 80,896 | 887 KB | **180 KB** |
| aether | 39,037 | 435 KB | **97 KB** |
| brutal (smallest) | 7,754 | 84 KB | **20 KB** |

The nicknames (`.n.json`) are not fetched at all until a player search exists.

## Git is a separate matter and is not the bottleneck

`.git` is 120 MB. The history will grow by a few dozen MB with today's changes (the old
single-file snapshots stay in it forever), then ~4 MB per round. Across 65 rounds that comes
to ~450 MB — below the point where GitHub starts raising concerns (~1 GB).

## What to do once the headroom runs out

Two years is a lot, so **we do nothing now**. When the time comes, in this order:

1. **gzip the `.n.json` files** — nicknames are half the growth and are rarely needed.
   `.n.json.gz` + `DecompressionStream` at search time → a round drops to ~8 MB.
2. **gzip the `.f.json` files too** — a round of ~3 MB, i.e. **4× more rounds**. The price
   is manual decompression in the browser instead of transparent gzip from the CDN.
3. **move the nicknames off Pages** (GitHub Releases) — only the `.f.json` files stay on
   Pages, a round is 6 MB, but CORS and an external dependency come with it.
4. **a delta against the previous snapshot** — 98.7% of players do not change between
   snapshots, so a base plus differences gives 10-20×. The most new logic and the risk of
   drift while reconstructing, which is why it is last in line.

## How to recompute this

```bash
du -sb public                              # the current size
du -cb public/worlds/*/<last-ts>.[fn].json      # the cost of one round
```

Or, more simply: add up the sizes of the files from the last scrape round.
