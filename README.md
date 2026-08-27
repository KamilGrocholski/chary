# MargoStat

Player statistics for [Margonem](https://www.margonem.pl) — a scraper for the world rankings plus an interactive dashboard hosted on **GitHub Pages**.

**🔗 Live: https://kamilgrocholski.github.io/chary/**

The scraper periodically fetches the player rankings of every tracked world, writes snapshots to static JSON files, and a lightweight dashboard (no backend, just HTML + Chart.js) lets you browse and filter them.

> **Working on this with an AI agent?** Start with [`AGENTS.md`](AGENTS.md) — one file with
> the whole map of the project, the data format, the traps and the reasoning behind decisions.

---

## How it works

```
margonem.pl/ladder  ──scrape──►  public/worlds/<world>/<ts>.f.json   (level/profession/honor/days)
                                 public/worlds/<world>/<ts>.n.json   (nicknames + charId)
                                          │
                          ┌───────────────┴───────────────┐
                          ▼                               ▼
                  public/manifest.json            public/trends.json
                          │                               │
                          └───────────────┬───────────────┘
                                          ▼
                              The world view (index.html)
                         a snapshot in cross-section + history
                            over time, under the same filter
```

- **The scraper** (`src/world-scraper.ts`) — walks the ranking pages of each world and writes a snapshot.
- **The parser** (`src/parser.ts`) — pure logic for parsing the ranking HTML, covered by tests against a real page.
- **The snapshot split** (`src/snapshot.ts`) — writing to two files sharing one row order.
- **The manifest** (`public/manifest.json`) — an index of snapshots per world, linking to both files.
- **The trends** (`src/trends.ts` → `public/trends.json`) — each world's folded history, one number per snapshot.
- **The world view** (`public/index.html` + `web/`) — a bar pinned to the top (the world, the match counter, chips for the active filters, section anchors), the filter fields below it (level, honor, profession, last activity), and below that two sections: **the cross-section** of the chosen snapshot (the level distribution by profession) and **the history** of every snapshot (population, activity, professions, a change table). The filter governs both.
- **The logic** (`web/filters.ts`, `web/history.ts`, `src/shared.ts`) — filtering, counting and building the series, with no DOM, tested without a browser.

The whole of `public/` is static — there is no application server, which makes it a perfect fit for Pages. `web/` is bundled into `public/app.js` by `bun run build`; that one file is generated and gitignored, everything else in `public/` is committed.

### Where the view gets its data

**The cross-section** — always from a single `.f.json`, so every filter is exact, honor and "last online" included (any day threshold, not just the presets). The file holds four arrays of numbers, one per column, so it is small: 97 KB gzipped for aether, 180 KB for the largest world, `gordion`.

**The history** has two paths, and that is the heart of this view:

| when | from | how much |
|---|---|---|
| the default filter | `public/trends.json` | **9 KB gzip for the whole history of every world** |
| a filter set | that one world's `.f.json` | 0.2-1.9 MB gzip, pulled in the background after the first filter move |

Whoever does not filter does not pay a byte for the precision. Whoever does filter gets an answer computed from the raw rows — a pass over gordion's whole history (813 thousand rows) takes **2.8-7 ms**, so no precomputed aggregate would be worth it. The points appear on the chart as they are fetched; a snapshot not yet loaded **gets no point** rather than an invented one.

`trends.json` holds one number per snapshot: the population, five disjoint activity buckets and the breakdown by profession. It rebuilds itself after every scrape round and on `bun run rebuild`.

The nicknames and `charId`s live separately in `.n.json` and are not fetched at all — filtering does not need them, and they are ~half a snapshot's volume. They will be fetched by a future player search and progression view.

> **A caveat about the "last online" metric.** The scrape is run by hand, once at 4 a.m., once at 9 p.m., on different weekdays — and one round takes ~2 h. Against a population moving by 0.6%, the "< 24h" threshold swings by ~15%. For judging a trend, the "≤ 7 days" and "≤ 30 days" thresholds are more reliable; the view shows all three and gives each snapshot's UTC hour. Details: [`docs/2026-08-04-spec-trends.md`](docs/2026-08-04-spec-trends.md).

## Requirements

- [Bun](https://bun.sh)

```bash
bun install
```

## Scraping

The list of tracked worlds is in `src/worlds.ts` — edit it by hand to add or remove a world.

```bash
# Check whether the parser copes with the current markup (fetches the first two pages, writes nothing)
bun run scrape:check

# Every world from src/worlds.ts
bun run scrape

# Chosen worlds (comma-separated, no spaces)
bun run scrape aether,tempest,classic

# With a custom interval between requests (ms, 1000 by default, 250 minimum)
bun run scrape aether 2000
```

The data lands in `public/worlds/<world>/<timestamp>.f.json` and `.n.json`, and `public/manifest.json` updates automatically.

> **Before launching a full scrape, run `bun run scrape:check`.** Margonem can change the ranking table's layout — a dry run detects that in under a minute instead of after an hour of fetching. It reads two pages of each world, not one, because pagination — the `page` parameter surviving a redirect — is only exercised above page 1.

### Logs

By default only the `WARN`, `ERROR` and `FATAL` levels are logged. The log file: `logs/scraper.log`.

```bash
LOG_LEVEL=INFO  bun run scrape   # + the start and end of each world
LOG_LEVEL=DEBUG bun run scrape   # + every page
```

### Resilience

- Retrying is **per page** (3 attempts, exponential backoff 5 s → 10 s → 20 s, honouring `Retry-After`) — a failed page does not rewind a whole world to the start.
- Individual faulty rows are skipped and counted (`skippedRows` in the snapshot). Only crossing 1% of the rows on a page aborts the world — that is a signal the markup has changed.
- A world that could not be fetched does not abort the whole run, but the process exits with **code 1** and prints a summary.

## The snapshot format

The current schema (`schema: 3`) is two files sharing **one row order** — row *i* corresponds to rank *i+1*, so the rank is never stored anywhere, and the two files together reconstruct the snapshot 1:1 without duplicating anything.

`<ts>.f.json` — columnar, everything filtering needs:

```json
{ "kind": "filter", "count": 39037,
  "level": [378, 359, ...], "profession": [4, 3, ...],
  "honor": [8749, 4715, ...], "days": [0, 0, 30, null, ...] }
```

`<ts>.n.json` — the player's identity:

```json
{ "kind": "names", "count": 39037,
  "name": ["essobe", ...], "charId": [729, ...] }
```

- `days` — `0` for "Mniej niż 24h temu", `N` for "N dni temu", `null` for an account that has never been online (the ranking then shows ~20655 days, i.e. a date in 1969).
- `honor` — can be **negative** (the lowest observed: −35), which is why the honor filter fields have no lower bound.
- `charId` — the stable character ID from the profile link, immune to nickname changes. Absent from snapshots migrated from the pre-August-2026 format.

Older snapshots (one file per snapshot, with the text "Mniej niż 24h temu" and a derived ISO date) were migrated losslessly — `bun run rebuild` handles both old schemas, should one still turn up.

## Data maintenance

```bash
bun run rebuild                # migrates old snapshots into an .f/.n pair, rebuilds the manifest and trends.json
bun run rebuild --keep-legacy  # leaves the original files in place after migrating
```

Safe to run repeatedly.

## Front-end dependencies

Chart.js is vendored in `public/vendor/chart.umd.min.js` (version **4.4.7**), so the page does not depend on a CDN loaded without SRI and works offline. To update:

```bash
curl -sL https://cdn.jsdelivr.net/npm/chart.js@<version>/dist/chart.umd.min.js -o public/vendor/chart.umd.min.js
```

After swapping it, update the version number here and in the comment in `public/index.html`.

## Tests

```bash
bun run check   # typecheck + tests — the gate, and what CI runs
bun test        # the parser (against a real ranking page in test/fixtures) + all the view logic
bun run typecheck
```

The gate does not build — nothing under test reads `public/app.js`, so a stale bundle can
neither pass nor fail it.

## Building the dashboard

```bash
bun run build   # web/*.ts → public/app.js + public/app.js.map
```

`bun build` ships inside Bun, so this adds no dependency. `public/app.js` is gitignored and
rebuilt: by `bun run serve` locally, and by `deploy.yml` before the Pages artefact is uploaded.

## Local preview

```bash
bun run serve   # builds, then serves
# http://localhost:3000
```

## Deploying (GitHub Pages)

The site deploys itself — pushing the data to `main` is enough:

```bash
git add public/
git commit -m "scrape $(date +%Y-%m-%d)"
git push
```

The [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) workflow runs the gate, builds `public/app.js` and uploads the `public/` directory as an artifact and publishes it to GitHub Pages. It can also be run by hand from the **Actions** tab (`workflow_dispatch`).

> **A caveat about size.** A published site on GitHub Pages has a hard 1 GB limit, and every round adds to `public/`. Run `bun run data:status` for where the artefact stands today — the figure is measured rather than written down here, because a written one goes stale on the next round. The calculation and what to do once the headroom runs out: [`docs/2026-08-01-size-budget.md`](docs/2026-08-01-size-budget.md).

## Project structure

```
src/
  world-scraper.ts   # the ranking scraper (fetch, retry, writing)
  parser.ts          # parsing the ranking HTML (pure functions)
  snapshot.ts        # the snapshot format: the .f/.n split and migrating old ones
  manifest.ts        # rebuilding public/manifest.json
  trends.ts          # a world's history aggregate → public/trends.json
  rebuild-data.ts    # maintenance: migration + manifest + trends
  worlds.ts          # the list of tracked worlds
  server.ts          # a local static server for previewing
  scraper-cli.ts     # reading the scraper's arguments (pure, so it can be tested)
  margostat-tool-error.ts  # the base every terminal-side error extends
  shared.ts          # the vocabulary of the data, read by the scraper AND the dashboard
  lib/               # the bottom layer: assert, and the only way to read a value
web/                 # the dashboard, bundled into public/app.js — never shipped as-is
  app.ts             # the wiring: page state, when to redraw, what to fetch
  dom.ts             # every lookup in the document, and the :root tokens
  controls.ts        # the filter bar: reading and writing the form, chips, drawer
  charts.ts          # the Chart.js instances and the time axis they share
  panels.ts          # the text panels: match line, distribution, summary, table
  format.ts          # numbers and failures as a Polish-speaking reader sees them
  filters.ts         # filtering, counting, the filter state in the URL (no DOM)
  history.ts         # a world's history: thresholds, series, fetching snapshots (no DOM)
  fetch-json.ts      # the one place `fetch` is spelled; refuses with a code
  margostat-error.ts # the base every browser-side error extends
tools/
  data-status.ts     # what is in public/ right now — `bun run data:status`
test/
  parser.test.ts     # parser tests against a capture of a real page
  snapshot.test.ts   # the snapshot format and migration from the old schemas
  dashboard.test.ts  # the cross-section: filters compared against pre-migration data
  trends.test.ts     # the history: the aggregate against .f.json, the client computing what the server does
  language.test.ts   # the language boundary: English everywhere except what a player reads
  lib.test.ts        # the value readers: everything JavaScript would otherwise invent
  scraper-cli.test.ts  # every argument the scraper refuses
  dom-smoke.ts       # the view against a real DOM (happy-dom), two scenarios, in a subprocess
  source-text.ts     # splitting a source into comments, code and string literals
  tools/             # guards: the rules in AGENTS.md held over the tree itself
public/              # what lands on GitHub Pages
  index.html         # the whole world view (markup + styles)
  app.js             # GENERATED from web/ by `bun run build`; gitignored
  vendor/            # Chart.js 4.4.7 (local, no CDN)
  trends.html        # a redirect to index.html (old links)
  manifest.json      # the snapshot index
  trends.json        # the folded history of every world
  worlds/            # snapshots per world: <ts>.f.json + <ts>.n.json
docs/                # audits and notes
.github/workflows/
  deploy.yml         # the GitHub Pages deploy
  ci.yml             # typecheck + tests
AGENTS.md            # the entry point for an AI agent
CLAUDE.md            # a pointer to AGENTS.md
LICENSE              # MIT — the code only
```

## Stack

Bun · TypeScript · Cheerio (HTML parsing) · Chart.js (charts) · GitHub Pages (hosting)

## Licence

**The code is under [MIT](LICENSE). The data is not, and cannot be** — you can only license
what you have rights to, and the ranking database belongs to the publisher of Margonem.

| What | On what terms |
|---|---|
| `src/`, `web/`, `test/*.ts`, `public/*.html`, `docs/` | MIT — [`LICENSE`](LICENSE) |
| `public/worlds/`, `manifest.json`, `trends.json`, `test/fixtures/` | **not open source** |
| `public/vendor/` (Chart.js 4.4.7) | MIT — [`public/vendor/LICENSE.chartjs`](public/vendor/LICENSE.chartjs) |

Forking gets you the code. **The right to redistribute the data does not travel with the
fork** — the ranking data is subject to Margonem's terms of service (`XIX.2` limits use to
personal purposes, `VII.2.k)` forbids commercial use) and to the sui generis database right.
The scraper honours `robots.txt`, 1 req/s and a self-identifying User-Agent; the `/ladder`
paths are listed in Margonem's own `sitemap.xml`. Nicknames are personal data — **to have
one removed from the snapshots, write to mikololo26@gmail.com.**

This project is not affiliated with or authorised by the publisher of Margonem.
