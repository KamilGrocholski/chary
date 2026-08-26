# AGENTS.md — the entry point for an AI agent

Read this first. If you still do not know where to look for something after finishing this
file, that is a bug in this document — add what is missing instead of leaving the next
person with the same question.

---

## What this is

A ranking scraper for [Margonem](https://www.margonem.pl) plus a static dashboard on
GitHub Pages. It periodically fetches the player rankings of every tracked world, writes
snapshots to static JSON files, and lets you browse and filter them with no backend at all.

- **Live:** https://kamilgrocholski.github.io/chary/
- **Repo:** `git@github.com:KamilGrocholski/chary.git` — note that the repository is called
  `chary` even though the package and the project are `margostat`. That is not a mistake.
- **Data source:** `https://www.margonem.pl/ladder/<world>/players?page=N`
- **State:** 244 snapshots from 21 worlds, **12 rounds** since 2026-04-17, ~593k players per
  round, `public/` 173 MB. Two worlds are off that grid: `brutal` has a 13th snapshot from a
  single-world scrape on 2026-08-01, and `luvia` joined in the 10th round, so it has 3.

---

## Language

**Write English** — code, comments, tests, docs, commit messages. Two exceptions, and the
line between them is what somebody is reading:

| Stays Polish | Where |
|---|---|
| The text a player reads | `public/index.html` body copy, `aria-label`s, placeholders, `<title>`, `<meta description>`, `lang="pl"`, `trends.html`, `404.html` |
| UI strings built in JS | chart titles, chips, table headings, status and error copy in `app.js`; `PROF` in `shared.js`; `activityLabel`/`filterChips` in `filters.js`; `ACTIVITY_THRESHOLDS[].label` in `history.js`; `toLocaleString("pl-PL")` |
| Keys that match scraped material | `PROFESSION_BY_NAME`, `PROFESSION_BY_LETTER` and the `ł → l` folding in `parser.ts`; the captured page in `test/fixtures/` |
| `suspect.reason` | written by `snapshot.ts` into every flagged `.f.json` and rendered verbatim by the dashboard — server-side code producing a sentence for a player |
| The assertions that pin all of the above | the Polish expected values in `test/dashboard.test.ts` |

**Identifiers around a Polish string stay English**, and a Polish sentence never carries
our vocabulary: a player is told what the data cannot show, not why our reader could not
read it. Everything else — every comment, every test name, every line the terminal prints,
every word in `docs/` — is English. Guarded by `test/language.test.ts`.

The Polish query parameters `prog` and `udzial`, and the `liczba`/`udzial` option values
behind them, are a deliberate exception on a different axis: they are the contract of links
people have already shared, which is the entire reason `trends.html` still exists. A URL is
not code style. Do not rename them.

---

## Where things live

```
src/
  world_scraper.ts   scraper CLI: fetching, retry, the guard, writing, the summary
  parser.ts          parsing the ranking HTML — pure functions, zero I/O
  snapshot.ts        snapshot format: the .f/.n split, migrating old ones, the population guard
  manifest.ts        building public/manifest.json
  atomic.ts          write to a temp file + rename — all of it or none of it
  retry.ts           backoff and Retry-After — pure, because world_scraper.ts runs on import
  trends.ts          per-world history aggregate → public/trends.json
  rebuild_data.ts    data maintenance CLI (migration + manifest + trends)
  worlds.ts          the list of tracked worlds — edited by hand
  server.ts          local static server for previewing
public/              exactly what lands on GitHub Pages
  index.html         markup and styles: sticky filter bar + snapshot + history
  app.js             the only module that touches the DOM — orchestration and drawing
  filters.js         filtering and counting: matches, countByLevel, summarizeFiltered, URL state
  history.js         world history: thresholds, series, typed arrays, fetching snapshots
  shared.js          constants, time, activity bucketing — the shared vocabulary
  vendor/            Chart.js 4.4.7 locally, no CDN + LICENSE.chartjs
  trends.html        redirect to index.html, preserving the query string
  manifest.json      the snapshot index
  trends.json        the folded history of every world + what a snapshot costs (29 KB, 11 KB gz)
  worlds/<world>/    <id>.f.json + <id>.n.json
test/
  parser.test.ts     the parser against a capture of a real ranking page
  snapshot.test.ts   snapshot format, migration, the population guard
  dashboard.test.ts  the snapshot view: filters, the −1 sentinel, snapshot time, agreement with index.html, smoke
  trends.test.ts     history: the server aggregate, trends.json, history.js, client == server
  language.test.ts   the language boundary above, over comments and string literals
  dom_smoke.ts       a DOM stub — two scenarios, run from the tests in a subprocess
  source-text.ts     splitting a source into comments, code and string literals
  fixtures/          a capture of a ranking page + a sample snapshot in the old schema
docs/                audits and notes
.github/workflows/   deploy.yml (check + publish), ci.yml (pull requests)
AGENTS.md            this file — the instructions for an agent
CLAUDE.md            a pointer to AGENTS.md (Claude Code)
LICENSE              MIT — covers the code ONLY, not the data
```

The code is ~4.4k lines including the tests. You can read all of it, and it is **worth**
doing before a larger change — faster than guessing.

---

## How to use it

```bash
bun install

bun run scrape:check   # ALWAYS before a full scrape — checks the parser on page 1 of every world
bun run scrape         # every world from src/worlds.ts (~1.6 h at 1 req/s)
bun run scrape aether  # a single world
bun run scrape aether,tempest 2000   # chosen worlds, custom interval in ms (min. 250)

bun run serve          # http://localhost:3000 — the dashboard locally
bun test               # 188 tests
bun run typecheck
bun run rebuild        # data maintenance: migrate old schemas + manifest + trends
```

Deploying happens by itself after a push to `main`, but only once typecheck and the tests
pass.

---

## The data format — you have to understand this

One snapshot is **two files with the same row order**. Row *i* corresponds to rank *i+1*,
so the rank is never stored anywhere, and the two files together reconstruct the snapshot
1:1 without duplicating anything.

`public/worlds/<world>/<id>.f.json` — everything filtering needs:

```json
{ "schema": 3, "kind": "filter", "world": "aether", "count": 39037,
  "startedAt": "2026-07-21T20:04:12.489Z",
  "level": [378, 359, ...], "profession": [4, 3, ...],
  "honor": [8749, 4715, ...], "days": [0, 0, 30, null, ...] }
```

`public/worlds/<world>/<id>.n.json` — player identity:

```json
{ "schema": 3, "kind": "names", "count": 39037,
  "name": ["essobe", ...], "charId": [729, ...] }
```

**The traps you have to watch for:**

- `days`: `0` = "less than 24 h ago", `N` = "N days ago", **`null` = an account never
  used** (the ranking then shows ~20655 days, a date in 1969). Accounts with `null` fall
  out of every activity threshold.
- `honor` **can be negative** (the lowest observed is −35). No `Math.max(0, …)`.
- **A snapshot's `id` (the stem of the filename) is NOT a date.** Files from before August
  2026 carry local time in the name, newer ones UTC. Displaying a date and measuring the
  interval between snapshots use `startedAt` from the manifest or the file, and nothing
  else. The same goes for the `timestamp` field **inside** the data files — that is an
  identifier, not a timestamp.
- `charId` exists only in snapshots from August 2026 onwards. Older ones are joined by
  nickname, and a nickname **is not stable** — see "the charId seam" in audit #2.
- `suspect` in `.f.json` marks a snapshot whose population dropped by more than 5% against
  the previous one. The data is written, but it may be truncated.
- Professions: 1 Wojownik, 2 Mag, 3 Paladyn, 4 Tropiciel, 5 Tancerz ostrzy, 6 Łowca.

The level, profession, honor and activity filters are computed **exactly**, always, from
a single `.f.json` (20-180 KB gzipped). Nicknames are not fetched at all until a player
search exists.

### `public/trends.json` — history, not a snapshot

The folded history of every world, one number per snapshot instead of hundreds of thousands
of rows: 28 KB raw, **11 KB gzipped for all 244 snapshots**. This is the **default** history
path — as long as the filter is at its defaults, the view draws its charts from this file
alone and fetches no snapshot at all.

```json
{ "schema": 2, "builtAt": "...", "worlds": { "aether": {
  "id": [...], "startedAt": [...], "total": [39849, ...],
  "act": [[<24h], [1-7 days], [8-30 days], [>30 days], [never]],
  "byProf": [[wojownik], ..., [łowca]], "suspect": [0, ...], "bytes": 98543 } } }
```

Columnar: row *i* of every column is the same snapshot — the same convention as the
`.f.json`/`.n.json` pair. **The `act` buckets are disjoint**, so "active ≤7 days" is the
sum of the first two; `ACTIVITY_THRESHOLDS` in `history.js` does that summing and is the
only place allowed to mix the two scales. Rebuilt in full by `bun run rebuild` and at the
end of every scrape round; a snapshot without `startedAt` drops out of it, because there is
nowhere to put it on the time axis.

`bytes` is the odd one out — not history but a price: the gzip size of that world's **newest**
`.f.json`, i.e. what one snapshot costs the client. The transfer budget below spends it. One
number per world rather than one per snapshot, because per-snapshot sizes in the manifest
measured +1.3 KB gzip on every visit against +96 B for this.

The full reasoning behind its shape and the traps in the "last online" metric:
[`docs/2026-08-04-spec-trends.md`](docs/2026-08-04-spec-trends.md).

### History under a filter — the second path to the same charts

Once the filter stops being the default one, the aggregate is no longer enough:
`trends.json` knows only global totals. The view then fetches the `.f.json` files of
**that one world** — as many of the newest as fit into a **2 MiB transfer budget**, so
0.2-2.0 MB gzipped — converts them to typed arrays and computes the history itself: exactly,
with no bucketing.

The heart of it is `summarizeFiltered` from `filters.js`: it returns
`{ total, act[5], byProf[6] }`, which is **exactly the shape of a `trends.json` row**. That
is why `activeCounts`, `changeRows`, `summarize` and all the drawing cannot tell the two
paths apart and have no separate code for them. Under the default filter both must produce
number-for-number what `summarizeSnapshot` from `src/trends.ts` produces — a test checks
that across all 244 snapshots (~1.5 s).

The traps on this path:

- **`null` in `days` becomes `−1`** — typed arrays cannot hold `null`. `−1 > maxDays` is
  **false**, so the `isNeverOnline` check has to come **before** the threshold, otherwise
  never-used accounts fall into every activity threshold. One place: `shared.js`.
- **A snapshot that did not load gets no point.** No interpolation, no substituting the
  unfiltered number from the aggregate — a hole makes a longer interval, and `perDay`
  divides by real elapsed time, so it stays honest.
- **The denominator of "share" is the unfiltered population**, not the filtered set (that
  one would sum to 100%).
- **The activity filter eats thresholds wider than itself** — at "≤ 3 days" the "≤ 7 days"
  threshold counts the same players as the matches chart. `usableThresholds` removes them.
- Memory holds at most **two worlds**, and the fetch is capped by a **transfer budget**, not
  by a number of snapshots: `HISTORY_BUDGET_BYTES` (2 MiB) against `trends.json`'s per-world
  `bytes`. Today it trims gordion alone — 11 of 12 snapshots — and nothing else, because
  gordion costs 177 KB a snapshot against brutal's 20 KB. A count did the opposite: it
  trimmed brutal, the cheapest world of the 21, and left gordion alone.
  [`docs/2026-08-26-spec-history-budget.md`](docs/2026-08-26-spec-history-budget.md).
- **The time axis comes from the aggregate, never from what was fetched.** `tickValues`,
  `scales.x.min/max` and the tooltips are built from the world's `trends.json` entry on both
  paths, so filtering can take points away but never the period the chart describes. The gap
  the budget leaves stays empty — nothing is interpolated into it — and `#budgetNote` names
  it, with the button that fetches the rest.
- **Fetching starts only from behind the debounce, and only once per world.**
  `loadHistory` holds a `world → Promise` map; calling it from the `input` handler pulled
  the same set of files once per keystroke. A test counts fetches per URL.
- **Replacing the `innerHTML` of a `<select>` clears the selection** — the browser picks
  the first option even when the previous value is still on the list. The value has to be
  read **before** the replacement. The DOM stub now does the same; it used to be gentler
  and that is what hid this bug.

Measurements, the transfer budget and why the views were merged:
[`docs/2026-08-04-spec-world-view.md`](docs/2026-08-04-spec-world-view.md).
Eight bugs that 165 tests did not catch:
[`docs/2026-08-04-audit-3.md`](docs/2026-08-04-audit-3.md).

---

## Why this way and not another

Decisions that look odd until you know the reason:

| Decision | Reason |
|---|---|
| A snapshot in two files | Nicknames are ~2/3 of the volume and filtering has no use for them. The split cut `public/` from 620 MB to 118 MB. |
| `trends.json` computes only what the view draws | The previous aggregate module was deleted for having fields with no consumer. This one has population, activity and professions — no level distribution (a 43× larger file) and no honor, neither of which the history view reads. |
| Trends in their own file, not in the manifest | The manifest is fetched on every visit, and the history may never be drawn without a filter. 11 KB added for everyone is a cost with nothing behind it. |
| One view instead of two pages | A snapshot and its history under the same filter is the one question that could not be answered before. The duplicated CSS and the second URL state went away with it. `trends.html` became a redirect so shared links keep working. |
| World picker and match counter in the sticky bar | It was 961 px from the filter to the first history chart — more than a screen, so a control and the thing it controls were never visible at once. The bar holds the **only copy** of both, so there is nothing to keep in sync. |
| The filter fields as a `position: absolute` drawer in the bar | It opens where the user is looking — a panel at the top of the document was off-screen after scrolling, so the "Filtry" button did nothing. It takes no space in the layout, so opening and closing **does not move the page**, and the initial state lives in the markup (`hidden`), not in JS after some `fetch`es. |
| Two border variables: `--border` and `--border-strong` | The borders of controls and cards need 3:1 (WCAG 2.2 SC 1.4.11); dividers inside a table do not. One shared value gave 1.48:1 and a form field was indistinguishable from the card behind it. |
| Chips scroll rather than get clipped | `overflow: hidden` at 800 px left them a measured **0 px** — three chips entirely invisible, their close buttons with them. Scrolling keeps them reachable by keyboard too. |
| History fetched lazily, only after the filter moves | The default filter is served by `trends.json` for 11 KB. Whoever does not filter does not pay for gordion's 2.2 MB. |
| The ceiling on a filtered history in bytes, not in snapshots | A count priced gordion (177 KB a snapshot) like brutal (20 KB), so it trimmed brutal — saving 19 KB — and left gordion untouched. It fired on brutal's one-off scrape from 2026-08-01 rather than on the size of anything. |
| The size of a snapshot in `trends.json`, one number per world | Per-snapshot sizes in the manifest measured **5835 → 7164 B gzip**, i.e. +1.3 KB on every visit for everyone; the per-world field cost +96 B. Raw size × a constant ratio will not do: the ratio is 4.18 for brutal and 4.85 for gordion. |
| The history counter counts against every snapshot, not against the plan | `11 z 12 migawek · limit transferu 2,0 MB` keeps the ceiling and a failed fetch apart. Counting against the plan would report a trimmed history as the complete set — which is what the old window did. |
| Filtering on the client instead of a precomputed cube | A pass over 813k rows is 2.8-7 ms — bucketing would cost accuracy and would not cover honor at all (−35 .. 1.2M). |
| The logic in `filters.js`/`history.js`, not in `app.js` | `app.js` starts the view immediately on import, so a module sewn to it cannot be tested outside a browser. A test holds this. |
| Chart.js vendored | A CDN without SRI is a dependency nobody controls; locally it also works offline. |
| Retry per page | It used to rewind the whole world to page 1 — for gordion (797 pages) up to 4× after ~13 min. |
| Faulty rows skipped | One strange row must not take down an entire world; we abort only above 1% of a page. |
| The guard writes rather than rejects | Losing a whole run hurts more than a snapshot with a warning. |
| `noUnusedLocals` on | Dead code has already survived two rebuilds here. |
| The licence split: MIT for the code, a separate notice for the data | You can only license what you have rights to. The ranking database is Margonem's and nicknames are personal data — putting `public/worlds/` under MIT would be claiming rights we do not have, and inviting others to do what `VII.2.k)` forbids. |
| The full Chart.js licence text next to the file, despite the banner in the minified build | MIT requires the notice in every copy, and banners are lost on further minification. |
| `LICENSE` is plain MIT with not a word about the data | GitHub detects a licence by similarity to a template (~98% threshold) — a note about scope would change the detected licence to "Other". The scope lives in `README.md`. |

Full reasoning and history: the audits below.

---

## What to read next

| File | What for |
|---|---|
| [`docs/2026-08-01-audit.md`](docs/2026-08-01-audit.md) | Audit #1: is the data real (it is — verified against the live ranking), what was broken, what was deleted, what is missing. |
| [`docs/2026-08-01-audit-2.md`](docs/2026-08-01-audit-2.md) | Audit #2 after the fixes: what held up, what was corrected, **the debt ahead and a list of ideas**. |
| [`docs/2026-08-01-size-budget.md`](docs/2026-08-01-size-budget.md) | How many scrape rounds are left before the 1 GB Pages limit (~65 ≈ 2 years) and what to do when they run out. |
| [`docs/2026-08-04-spec-trends.md`](docs/2026-08-04-spec-trends.md) | The spec for one world's trends over time: what to show, `trends.json` (**9.0 KB gzip for the whole history**), the traps in the "last online" metric. |
| [`docs/2026-08-04-spec-world-view.md`](docs/2026-08-04-spec-world-view.md) | The spec for merging `index.html` and `trends.html` into one view per world, filtering **the whole history** on the client: measurements (**7 ms over 813k rows**), lazy fetching, the traps and the snapshot-window threshold. |
| [`docs/2026-08-04-audit-3.md`](docs/2026-08-04-audit-3.md) | Audit #3: **eight bugs that 165 tests did not catch**, a DOM stub gentler than a browser, `Retry-After: 0`, a non-atomic write, CLI validation — plus debt and ideas. |
| [`docs/2026-08-04-spec-filter-bar.md`](docs/2026-08-04-spec-filter-bar.md) | The spec for the pinned filter bar: page geometry (**2806 px**, the filter 961 px from the first history chart, **87% of the screen on a phone**), the variants, the research and the traps of `position: sticky` in this markup. |
| [`docs/2026-08-05-audit-ui-ux.md`](docs/2026-08-05-audit-ui-ux.md) | Audit #4, the first one about the **interface**: border contrast (it was **1.48:1** against a 3:1 threshold), chips squeezed to **0 px** between 721 and 1100 px, focus lost on Escape and on the close button, geometry measured in a browser. The measuring method, the debt and three hypotheses disproved. |
| [`docs/2026-08-26-spec-history-budget.md`](docs/2026-08-26-spec-history-budget.md) | The ceiling on a filtered history in **bytes instead of snapshots**: a count priced gordion (**177 KB** a snapshot) like brutal (**20 KB**) and trimmed the wrong one. The budget, where the size comes from, why the axis belongs to the aggregate, and how many rounds each world has before it meets the ceiling. |
| [`README.md`](README.md) | The manual, for a human. |

---

## How we work in this repo

1. **English everywhere except what a player reads.** The rule and its exceptions are in
   "Language" above; `test/language.test.ts` holds it. Commit messages are English too —
   Conventional Commits, `type(scope): effect`, and the header names the effect rather than
   the activity.
2. **Do not trust a hypothesis — measure.** During audit #2, "the chart is unreadable
   because of level 1" turned out to be false after a single command. The data is on disk;
   checking costs seconds.
3. **Run `bun run scrape:check` before a full scrape.** Margonem has already changed the
   table layout once, and the scraper fell over on all 20 worlds while exiting with code 0.
4. **Do not write code on spec.** This project has already deleted a constant and an entire
   module that existed "for later". If something has no consumer today, describe the idea
   in `docs/` and do not commit the code.
5. **Respect the service.** 1 req/s is the default interval; at 400 ms the ranking answers
   `429`. `robots.txt` does not forbid `/ladder` (and Margonem's own `sitemap.xml` lists
   those paths), but that is not an invitation to hammer it. Do not disguise the UA as a
   browser — `Mozilla/5.0 (margostat scraper)` says plainly who is knocking.
6. **The data in `public/worlds/` cannot be reproduced.** The ranking has no history —
   whatever we did not scrape back then cannot be recovered today. Make format migrations
   lossless and verify them row by row against the originals in git.
7. **Tests compare against the truth, not against themselves.** The parser is checked
   against a capture of a real page, the filters against a sample of a real snapshot in the
   old schema. Keep that arrangement — a test that checks a reimplementation of itself
   holds nothing.
8. **Notes and audits go to `docs/`**, named `YYYY-MM-DD-<topic>.md`, and are added to the
   table in [`docs/README.md`](docs/README.md) as well as to "What to read next" above.
9. **The code is ours, the data is not.** The MIT licence in `LICENSE` covers the code
   only. The ranking database belongs to the publisher of Margonem (terms `XIX.2`/`VII.2.m)`
   plus the sui generis database right), and `.n.json` contains nicknames, which are
   personal data. Never put `public/worlds/` or `test/fixtures/` under an open-source
   licence, never label them `CC-BY`/`ODbL`, and never invite commercial use in the README
   — that would be claiming rights we do not have. If you change which fields get
   published, weigh what personal data goes with them.
10. **After a scrape round, refresh the numbers in this file.** Every round makes the
    "State" line, the `trends.json` sizes and the per-world history figures wrong by one
    round, and a stale number here is read as a measured one — the last drift went unnoticed
    for two rounds. Each is one command:
    ```bash
    ls public/worlds/*/*.f.json | wc -l    # snapshots
    du -sh public                          # the Pages artifact against the 1 GB limit
    gzip -c public/trends.json | wc -c     # what every visitor downloads
    ```
    The number of rounds is the longest history — the largest `worlds.<w>.id.length` in
    `trends.json`. The tests read their figures from `public/` and so move with the data on
    their own; this file does not.

---

## What is deliberately not here

- **A player search and single-character progression** — even though the data is sitting
  ready: an `.n.json` accompanies every snapshot and nobody reads it today. Note that this
  analysis is cut across by "the `charId` seam" from audit #2 — population trends are not,
  because they count people rather than following individuals.
- **Global totals and comparisons between worlds** — `trends.json` has all the data for it,
  but a total falls apart on a changing set of worlds (`luvia` exists only in the last
  round and is 41.3% online), and a comparison needs normalisation, because gordion
  flattens brutal. Deliberately deferred — see the trends spec.
- **Downsampling the old end of a history** — one point a month past six months, which would
  let a filtered gordion reach further back than the 11 snapshots its budget buys. The
  aggregate already holds every point, so it would cost nothing to store; nothing needs it
  yet. See the history-budget spec.
- **An automated scrape (cron)** — it is run by hand, hence the uneven 3-17 day intervals.
- **37 legacy/private worlds** — the ranking exposes ~57 in total; we track 21.
- **Typechecking `public/*.js`** — `checkJs` produces dozens of DOM typing errors rather
  than real bugs, and would need JSDoc annotations. The reason is recorded in
  `tsconfig.json`.
