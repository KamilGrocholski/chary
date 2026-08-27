# AGENTS.md — the entry point for an agent

The single source of rules for anyone — human or agent — working in this repository.
`CLAUDE.md` only imports this file. If a rule is not here, it is not a rule.

Rules first. The reasoning behind a rule lives beside it where it is short, and in the
file's own docblock, the guard that holds it or `docs/` where it is long. What never
belongs here is a number describing the tree or the data as it stands today — §5.

---

## 1. Project

MargoStat is a ranking scraper for [Margonem](https://www.margonem.pl), a browser-based
MMORPG, plus a static dashboard on GitHub Pages. It periodically fetches the player ranking
of every tracked world, writes snapshots as static JSON, and lets anyone browse and filter
them with no backend at all.

**It reads and does nothing else.** No account, no game client, no automation — one HTTP
request per second against a public ranking page.

- **Live:** https://kamilgrocholski.github.io/chary/
- **Repo:** `git@github.com:KamilGrocholski/chary.git` — the project is called **MargoStat**,
  the repository `chary`, and the npm package id `margostat` (lowercase, because npm forbids
  capitals). None of the three disagreements is a mistake.
- **Data source:** `https://www.margonem.pl/ladder/<world>?page=N`

Stack: Bun + TypeScript for the scraper, plain ES modules for the dashboard, one runtime
dependency (`cheerio`) and one vendored library (Chart.js). **There is no build step.**
`public/` is byte for byte what GitHub Pages serves, which is why the dashboard is written
in JavaScript and typechecked through `checkJs` rather than compiled — §9.3.

For what is in `public/` right now — snapshots, rounds, the artefact against the Pages
limit — run `bun run data:status`. It is not written down here, and §5 says why.

---

## 2. Boundary labels

| Tag | Meaning |
|---|---|
| `[ALWAYS]` | Do it every time. No judgment call. |
| `[ASK]` | Stop and ask the user before doing it. |
| `[NEVER]` | Do not do it. Not "prefer not to". |

| Scope | Meaning | Paths |
|---|---|---|
| `[any]` | Everywhere in the repo | — |
| `[lib]` | True in any project; knows nothing of this one | `public/lib/` |
| `[scrape]` | Fetching, parsing, the snapshot format | `src/` |
| `[dash]` | The dashboard and everything it draws | `public/*.js`, `public/index.html` |
| `[data]` | Material taken from the ranking | `public/worlds/`, `test/fixtures/` |
| `[tools]` | Runs in a terminal, never reaches a browser | `tools/` |
| `[docs]` | Specs, audits and the notes behind them | `docs/` |
| `[process]` | Commits, validation, workflow | `.github/workflows/` |

Untagged prose is context and does not bind. A test is bound by the scope of the thing it
tests. Keep this table true — a scope whose path is gone is the first sign the rules have
drifted.

---

## 3. ALWAYS

- `[ALWAYS] [any]` **Run the gate after every change**, including a one-line edit. §6.1.
- `[ALWAYS] [process]` **Prove a new test can fail.** Break what it covers, watch it go
  red, restore. Say in the commit what you broke and what lit up.
- `[ALWAYS] [scrape]` **Run `bun run scrape:check` before a full scrape.** Margonem has
  already changed the table layout once, and the scraper fell over on all twenty worlds
  while exiting with code 0. A round is over an hour long and overwrites nothing that can
  be fetched again — §9.2.
- `[ALWAYS] [any]` **A claim about the ranking carries the date it was read.** Its markup,
  its column order, what a cell says for an account nobody has used: that is somebody
  else's system, so it is dated or it is a guess. Negative claims included.
- `[ALWAYS] [any]` **A measurement over the data names the material it was taken on** — the
  world and the snapshot, or the set and its date. A figure scoped to "the snapshots" goes
  stale on the next round.
- `[ALWAYS] [any]` **Make unknown input loud.** A cell the parser cannot read becomes a
  rejected row with a reason, never a substituted value — §9.5.
- `[ALWAYS] [any]` **Write English** — code, comments, tests, docs, commits. The exception
  is the text a player reads, which is Polish. The boundary is §9.8 and
  `test/language.test.ts` holds it.
- `[ALWAYS] [process]` **Leave the gate green** — every commit on its own, including when
  one change is split across several.
- `[ALWAYS] [process]` **Work lands on `main`, and a push to `main` publishes.**
  `deploy.yml` runs the gate first and does not publish without it, so a red commit reaches
  Pages only if somebody turns that off.

---

## 4. ASK FIRST

- `[ASK] [process]` **Committing or pushing.** Otherwise finish a round with the changes in
  the working tree and a summary.
- `[ASK] [data]` **Touching anything under `public/worlds/` or `test/fixtures/`** — §9.2.
  This includes reformatting, and it includes a migration: one is `[ASK]` even when it is
  provably lossless.
- `[ASK] [any]` **Changing the data contract** — `SNAPSHOT_SCHEMA`, the shape of a
  `.f.json`/`.n.json` pair, or `trends.json`. Every published file and every shared link is
  downstream of it.
- `[ASK] [any]` **Deleting or skipping a test**, including "it's obsolete".
- `[ASK] [any]` **Adding a dependency.** One runtime dependency is a feature; a dashboard
  that fetches nothing from a CDN is a promise.
- `[ASK] [any]` **Turning off a compiler flag or a guard test** to pass.
- `[ASK] [any]` **Adding a file nothing uses yet** — §7.1.
- `[ASK] [scrape]` **Adding or removing a world in `src/worlds.ts`.** A world that leaves
  the list stops being scraped and its history stops growing; one that joins starts a
  history that cannot be backfilled.

---

## 5. NEVER

- `[NEVER] [data]` **Edit captured material to make a test pass.** If the fixture
  contradicts the code, the code or the understanding is wrong.
- `[NEVER] [any]` **Invent data the ranking does not carry.** `0` is a measurement, so a
  field that could not be read never becomes `0`, never copies its neighbour and never
  borrows the previous snapshot's value. Unknown is a value with a spelling of its own —
  §9.5.
- `[NEVER] [dash]` **Fetch anything the repository does not publish.** The dashboard reads
  `manifest.json`, `trends.json` and files under `worlds/`, all same-origin. No CDN, no
  analytics, no font host. Chart.js is vendored for this reason.
- `[NEVER] [any]` **Comment the obvious.** §9.3.
- `[NEVER] [any]` **Leave a number in prose that a machine could compute of the tree or the
  data as it stands** — snapshot counts, round counts, file sizes, test counts, line counts.
  Measure at read time: `bun run data:status`.

  ⚠️ This rule replaces a workflow rule that asked for the figures in this file to be
  refreshed by hand after every round. They were not, and a stale number here reads exactly
  like a measured one — the last drift stood for two rounds. A historical measurement is a
  different thing and stays: "the split cut `public/` from 620 MB to 118 MB" describes
  something that happened and cannot go stale.

- `[NEVER] [any]` **Put `public/worlds/` or `test/fixtures/` under an open-source licence.**
  The ranking database belongs to the publisher of Margonem (terms `XIX.2` / `VII.2.m)`
  plus the sui generis database right), and a `.n.json` holds nicknames, which are personal
  data. `LICENSE` is plain MIT and covers the code only — with not a word about the data,
  because GitHub detects a licence by similarity to a template and a note about scope would
  change the detected licence to "Other". The scope lives in `README.md`.
- `[NEVER] [scrape]` **Disguise the scraper as a browser.** The user agent says who is
  knocking: `Mozilla/5.0 (margostat scraper)`.

---

## 6. Commands

### 6.1 The gate

```bash
bun run check      # typecheck + tests — THE GATE, must pass
bun test           # tests only, while iterating
bun run typecheck  # types only
```

The gate is one command so there is no version of "I ran the tests but not the typecheck".
There is no build step to run — §1.

### 6.2 Working commands

```bash
bun run scrape:check                 # the first two pages of every world, writes nothing — ALWAYS before a scrape
bun run scrape                       # every world in src/worlds.ts, ~1 req/s
bun run scrape aether                # a single world
bun run scrape aether,tempest 2000   # chosen worlds, custom interval in ms (min. 250)
bun run rebuild                      # data maintenance: migrate old schemas + manifest + trends
bun run serve                        # http://localhost:3000 — the dashboard locally
bun run data:status                  # what is in public/ right now — §5
```

### 6.3 Tooling

A tool arrives with the question it answers (§7.1).

| Tool | Answers |
|---|---|
| `tools/data-status.ts` | *What is in `public/` right now?* Snapshots, rounds, the artefact against the Pages limit, what one snapshot costs a visitor. The figures §5 keeps out of prose. |

---

## 7. Workflow

### 7.1 Shape of a round

**Nothing exists before it is needed** — files, directories, modules, tools and guards
alike. A file is created in the commit that uses it; a directory appears with its first
file; a shared module appears at the **second** consumer; a guard appears when there is
something to guard; a tool appears with its question.

This repository has already deleted a constant and an entire module that existed "for
later": `aggregate.ts` produced fields no view read, and `NEVER_ONLINE_DAYS` survived a
format rebuild in the dashboard because nobody was holding it. If something has no consumer
today, describe the idea in `docs/` and do not commit the code.

A round: understand the problem → change the smallest thing that addresses it → run the
gate (§6.1) → report (§7.4). If you catch yourself writing a plan, the change deserves one
written down before the code.

### 7.2 Commits

Conventional Commits, English: `type(scope): effect`.

| Type | For |
|---|---|
| `feat` | Something the user can now do |
| `fix` | Behaviour that was wrong |
| `perf` | Same behaviour, measured faster or smaller |
| `refactor` | Same behaviour, different shape |
| `docs` | `AGENTS.md`, `README.md`, `docs/` |
| `test` | Tests and guards only |
| `build` | `package.json`, `tsconfig.json`, the lockfile |
| `chore` | Everything else that ships no behaviour |
| `scrape` | A round of data, and nothing else |

Scopes are the parts of the tree, not the activity: `scraper`, `parser`, `snapshot`,
`trends`, `manifest`, `dash`, `lib`, `tools`, `docs`, `ci`. A commit touching one file
takes that file's scope; one touching the whole repo takes none.

- `[ALWAYS] [process]` **A scrape round is committed on its own, as `scrape: …`** — no
  source change in the same commit. A round rewrites `manifest.json` and `trends.json` and
  adds tens of megabytes; a code change hiding inside that diff is a code change nobody
  will ever read.

**The header names the effect, not the activity** — "the history ceiling is priced in
bytes", not "change the snapshot window".

**The body is the primary record of reasoning**, with no length limit: numbers rather than
adjectives, what decided it (a measurement, or taste — say which), the rejected
alternatives, what you broke and what lit up (§3), and what stays open.

### 7.3 Parallelism and subagents

Independent tool calls go in one message. Delegate when answering means reading across many
files and you only need the conclusion; never a single-file lookup, and never a search you
have already delegated.

### 7.4 Reporting

End a round with: what changed, what you validated and what came back, what you did **not**
do and why. Report failures with the output, and say when a step was skipped. Nothing is
done until the gate is green.

### 7.5 What a round teaches

Three places, in order: **a guard**, if a machine can check it; **a rule here**, if it needs
judgment, naming the cost that produced it; **the commit message**, if it is neither. There
is no place for a file of accumulated lessons — an append-only list with no consumer is
exactly what §7.1 forbids.

Rules that arrived this way, each paid for at least once:

- `[ALWAYS] [any]` **Do not trust a hypothesis — measure.** "The chart is unreadable
  because of level 1" was false, and one command over the data on disk said so. The data is
  right there; checking costs seconds.
- `[ALWAYS] [any]` **Read back the result of a scripted edit.** A pattern that no longer
  matches does nothing and says nothing.
- `[ALWAYS] [any]` **Test the boundary from both sides, and zero is the boundary.** Zero is
  a legitimate reading of every number here — a level cannot be zero but honor can, and
  `days: 0` means "today". A test at `0` needs one at `1` beside it, and one below where the
  type allows: honor reaches −35 and `days` carries −1 for an account never used.
- `[ALWAYS] [any]` **A test compares against the truth, not against itself.** The parser is
  checked against a capture of a real ranking page and the filters against a real snapshot
  in the old schema. A test that checks a reimplementation of itself holds nothing.
- `[ALWAYS] [any]` **A rule narrowed in a docblock is a rule nobody else will read that
  way.** Where a round finds that the tree has stopped matching what a rule says, the rule
  moves — here — in the same commit.
- `[ALWAYS] [any]` **Two modules computing one answer need a guard holding them to it —
  and before the guard, ask why there are two.** `getActivityBucket` was written twice, once
  for the server folding the history and once for the browser filtering it, with a test
  holding them equal value for value. The test was right and the second copy was not: the
  rule keeping `src/` out of `public/shared.js` was what created it, and opening that one
  edge (§9.1) left one function and no need to compare anything. What survives the same
  question stays and gets its guard — `summarizeSnapshot` against `summarizeFiltered`, which
  differ in the row predicate and not in the arithmetic.

### 7.6 Working from the ranking

The ranking is somebody else's service and our only source. What it looks like, what its
columns mean, what it prints for an account nobody has used: dated claims, per §3.

- `[ALWAYS] [scrape]` **One request per second is the default, and 250 ms is the floor.**
  At 400 ms the ranking answers `429`. `robots.txt` does not forbid `/ladder` and
  Margonem's own `sitemap.xml` lists those paths, but that is not an invitation to hammer
  it.
- `[ALWAYS] [scrape]` **A retry retries one page.** It used to rewind the whole world to
  page 1 — for the largest world that is hundreds of pages, up to four times, after a
  quarter of an hour of work.
- `[ALWAYS] [scrape]` **The server's hint may lengthen a pause and never shorten it.**
  `Retry-After: 0` is a real answer, and `suggested ?? own` let it through — because
  `0 ?? x` is `0` — so four requests went out back to back (`src/retry.ts`).
- `[ALWAYS] [scrape]` **One strange row must not take down a world.** A row that cannot be
  read is rejected with a reason; only above 1% of a page do we assume the markup changed
  and abort.
- `[ALWAYS] [scrape]` **The population guard writes rather than rejects.** A snapshot whose
  population dropped more than the threshold against the previous one is written and
  flagged `suspect`. Losing a whole round hurts more than a snapshot with a warning, and
  the warning reaches the dashboard.

### 7.7 Reading the whole tree at once

An **audit** is one round that reads the whole repository and writes down what it found,
dated by the commit it read. It measures the half the gate cannot report, since a guarded
rule passes by construction: prose drifted from the tree, duplication past §7.1's second
consumer, an exported name no test names, a rule written and never guarded.

- `[ALWAYS] [process]` **Say what was not read.** *Not looked at*, *looked at and clean*
  and *a finding* are three answers.
- `[ALWAYS] [process]` **An audit carries the commit it read.**
- `[ALWAYS] [process]` **A finding names a file, and a line where there is one.**
- `[ALWAYS] [process]` **Every finding closes into one of §7.5's three places, or is
  declined with a reason.** Leaving it open is not an answer.
- `[NEVER] [process]` **Fix while auditing** — reading and fixing are separate commits.
- `[NEVER] [docs]` **Append to a closed audit.** The next one is a new file.
- `[ASK] [docs]` **Deleting an audit**, closed ones included.

Open one without being asked: when the same class of fault turns up in two rounds, and when
a round touches a layer no audit has read.

---

## 8. Structure

Reflects the tree as it is, not as it is going to be. **Update it in the same commit that
changes the tree.** Why a file is the way it is belongs in its own docblock, not here.

```
AGENTS.md          These rules. The only place they live.
CLAUDE.md          One line importing AGENTS.md.
README.md          The manual, for a human: what this is, how to run it, and what the
                   licence does and does not cover.
LICENSE            MIT — covers the code ONLY, never the data. §5.
package.json       Scripts: the gate, the scrape, the rebuild, the local server.
tsconfig.json      Strict flags standing in for a linter, and why checkJs is on.
.github/workflows/ ci.yml on a pull request; deploy.yml runs the gate and publishes
                   public/ to Pages on a push to main.

src/               The scraper and the data format. Runs in a terminal, never in a browser.
  margostat-tool-error.ts
                   Base for everything the scraper and the tools throw — §9.5.
  world-scraper.ts
                   The round itself: fetching, retry, the population guard, writing, the
                   summary. Runs on import — which is why the pure parts are not here.
  scraper-cli.ts   Reading that command line. Pure, and answers a result rather than
                   throwing: the caller is a person who mistyped a flag.
  parser.ts        The ranking HTML into rows. Pure functions, zero I/O.
  snapshot.ts      The snapshot format: the .f/.n split, migrating older schemas, the
                   population guard's arithmetic.
  manifest.ts      public/manifest.json — the snapshot index the dashboard opens with.
  trends.ts        Every world's history folded to one number per snapshot →
                   public/trends.json.
  atomic.ts        Write to a temp file, then rename. All of it or none of it.
  retry.ts         Backoff and Retry-After. Pure, because world-scraper.ts runs on import.
  rebuild-data.ts  Data maintenance CLI: migration, then the manifest, then the trends.
  worlds.ts        The worlds we track. Edited by hand — §4.
  server.ts        A local static server for previewing public/.

public/            Exactly what lands on GitHub Pages. No build step — §1.
  lib/             The bottom layer: true in any project, and published because that is
                   the only directory both sides can import from — §9.1.
    assert.js      Assertions and their failure type. Outside both error hierarchies.
    margostat-error.js
                   Base for everything the dashboard throws — §9.5.
    number.js      Every number read or written. Reading returns null, writing asserts.
    json.js        JSON both ways: the value or the SyntaxError, never a bare null.
    timestamp.js   Date.parse without the NaN.
    text-order.js  Two pieces of text in order, by code unit, deterministic.
  index.html       Markup and styles: the sticky filter bar, the snapshot, the history.
  app.js           The only module that touches the DOM. Orchestration and drawing.
  fetch-json.js    Fetching one of the documents this repo publishes, or refusing with a
                   code. The one place `fetch` is spelled.
  filters.js       Filtering and counting: matches, countByLevel, summarizeFiltered, and
                   the filter's URL state.
  history.js       One world's history: thresholds, series, typed arrays, fetching
                   snapshots against a transfer budget.
  shared.js        The vocabulary of the data: professions, the activity scale, the counter
                   shapes, time. Read by the dashboard AND by src/ — the one module that
                   crosses (§9.1). Touches no DOM and runs nothing on import.
  trends.html      A redirect to index.html that keeps the query string. Shared links.
  404.html         Pages' own.
  manifest.json    GENERATED by src/manifest.ts.
  trends.json      GENERATED by src/trends.ts.
  vendor/          Chart.js, local, no CDN — plus the full MIT text beside it, because a
                   banner in a minified build is lost on further minification.
  worlds/<world>/  <id>.f.json + <id>.n.json. Material — §9.2. NOT ours to license.

tools/             Never ships. §6.3 says what each answers.
  data-status.ts   What is in public/ right now, so §5 can keep it out of prose.

test/              A test sits beside the thing it tests.
  parser.test.ts     The parser against a capture of a real ranking page.
  snapshot.test.ts   The snapshot format, the migration, the population guard.
  dashboard.test.ts  The snapshot view: filters, the −1 sentinel, snapshot time, agreement
                     with index.html — its ids, its design tokens and the classes the view
                     writes — and smoke.
  trends.test.ts     History: the server aggregate, trends.json, history.js, and that the
                     client and the server agree number for number.
  lib.test.ts        The floor: every value JavaScript would otherwise have invented.
  scraper-cli.test.ts
                     Every argument the scraper refuses, and why each refusal exists.
  language.test.ts   The language boundary of §9.8, over comments and string literals.
  dom-smoke.ts       A DOM stub — two scenarios, run from the tests in a subprocess.
  source-text.ts     Splitting a source into comments, code and string literals.
  tools/             Guards: the rules of this file, held over the tree itself.
    source-layout.test.ts
                     §9.3, §9.4 and §9.5 read over every source: brands and codes, no `!`,
                     no cast off JSON.parse, the value-reader register, imports, file names.
    structure-block.test.ts
                     The block above against the tree it claims to describe.
    naming.test.ts   §9.4 over names. The action a name opens with, over the exported
                     surface; the synonyms and contractions it may not carry, over every
                     function; and over every declaration, that it is not named exactly
                     an action. Why the first one stops at the exports is measured there.
    cited-paths.test.ts
                     Every path this file and README.md name is a path that exists.
    commit-messages.test.ts
                     §7.2 over this history: the type, the scope, and a scrape on its own.
  fixtures/          A capture of a ranking page, and one snapshot in the old schema.

docs/              Dated specs and audits. docs/README.md indexes them.
```

---

## 9. Rules

### 9.1 Architecture

- `[ALWAYS] [lib]` **`public/lib/` is the bottom layer** and knows nothing of the ranking,
  the scraper or the document. Everything may read it; it reads nothing.

  ⚠️ It sits under `public/` for one reason: there is no build step, so the published
  directory is the only place **both** sides can import from — `src/*.ts` by path and the
  dashboard over HTTP. The alternative was one copy of `assert` and one of every value
  reader per side, and the activity scale has already shown what two copies of one answer
  cost — it was written out four times before this edge existed. A visitor downloads only what a dashboard module imports, so a reader used by the
  scraper alone costs them nothing.
- `[ALWAYS] [scrape]` **`src/` may read `public/lib/` and `public/shared.js`, and nothing
  else under `public/`.** The scraper never imports a module that draws or fetches: `app.js`
  starts the view on import, and `filters.js`/`history.js` are written against the browser's
  `fetch`. `shared.js` is none of those three — no document, no `fetch`, nothing run on
  import, and a test holds each of those — so it is the one place the vocabulary of the data
  itself can be stated once for both sides.

  ⚠️ This edge was opened after counting what its absence cost: the activity scale written
  out four times, "five buckets and six professions" spelled as an array literal nine times,
  and the profession names three times, in `parser.ts` twice over. Every one of those was a
  duplicate the rule created and a guard then had to hold. What may cross is the vocabulary
  of the ranking and of the published format; a colour, a Polish label or a date format
  travels the other way and `src/` has no business importing it.
- `[ALWAYS] [dash]` **`app.js` is the only module that touches the DOM.** `shared.js`,
  `filters.js` and `history.js` touch no document and run nothing on import — that is what
  makes them testable outside a browser, and a test holds it. `fetch` in `history.js` is
  not an exception: it is not the document interface, and the tests substitute a stub.
- `[ALWAYS] [tools]` **A tool may read `src/` and `public/` alike.** It ships nowhere, so
  the layering above does not bind it — and a report about the transfer budget is only true
  if it spends the constant the dashboard actually spends, rather than a copy of it
  (`tools/data-status.ts` imports `HISTORY_BUDGET_BYTES` from `public/history.js`).
- `[ALWAYS] [any]` **A file holds one subject, however long that subject runs.** What
  forces a split is a **second** subject — never a line count, and never a docblock that
  got long.
- `[ALWAYS] [any]` **Two spellings of one answer need a guard.** §7.5's last rule, stated
  as architecture: where the server and the browser must agree — the activity buckets, the
  filter predicate, the snapshot summary — one of them is the reference and a test compares
  the other against it over real material.

### 9.2 Data

`public/worlds/` is the ranking as it stood at a moment in time. **The ranking has no
history**, so whatever was not scraped then cannot be recovered now: this is evidence, not
test data, and neither is `test/fixtures/`.

- `[NEVER] [data]` Edit either to make anything pass.
- `[ASK] [data]` Any change at all, including reformatting and including a migration.
- `[ALWAYS] [data]` **A migration is lossless and verified row by row against the
  originals in git**, and it refuses rather than substitutes — a row it cannot read stops
  the migration (§9.5).
- `[ALWAYS] [data]` **Snapshots are discovered by reading the directory**, never from a
  hand-maintained list of names.
- `[ALWAYS] [data]` **Every write into `public/` is atomic** — a temp file and a rename,
  via `src/atomic.ts`. `Bun.write` truncates first, so a Ctrl-C mid-write leaves a
  truncated snapshot, and a truncated snapshot took down `JSON.parse` in the manifest
  build — which is both the tail of an hour-long round and the `bun run rebuild` meant to
  repair it.
- `[ALWAYS] [data]` **An empty world directory fails its own test.**

**The format — you have to understand this.** One snapshot is **two files with the same row
order**. Row *i* is rank *i+1*, so the rank is never stored and the pair reconstructs the
snapshot 1:1 without duplicating anything. Nicknames are about two thirds of the volume and
filtering has no use for them; the split cut `public/` from 620 MB to 118 MB.

`public/worlds/<world>/<id>.f.json` — everything filtering needs:

```json
{ "schema": 3, "kind": "filter", "world": "aether", "count": 39037,
  "startedAt": "2026-07-21T20:04:12.489Z",
  "level": [378, 359, ...], "profession": [4, 3, ...],
  "honor": [8749, 4715, ...], "days": [0, 0, 30, null, ...] }
```

`public/worlds/<world>/<id>.n.json` — player identity: `name`, `charId`.

**The traps:**

- `days`: `0` = "less than 24 h ago", `N` = "N days ago", **`null` = an account never
  used** — the ranking shows about 20655 days for those, a date in 1969. They fall out of
  every activity threshold.
- **`honor` can be negative.** The lowest observed is −35. No `Math.max(0, …)`.
- **A snapshot's `id` is NOT a date.** Files from before August 2026 carry local time in
  the name, newer ones UTC. Displaying a date and measuring an interval use `startedAt`
  from the manifest or the file, and nothing else. The same goes for the `timestamp` field
  **inside** the data files — that is an identifier, and it keeps its name because renaming
  it would mean rewriting every published file for cosmetics.
- **`charId` exists only from August 2026 onwards.** Older snapshots join by nickname, and
  a nickname is not stable — "the charId seam" in `docs/2026-08-01-audit-2.md`.
- **`suspect` marks a snapshot whose population dropped past the threshold** against the
  previous one. The data is written; it may be truncated. Its `reason` is Polish because
  the dashboard renders it to a player verbatim — §9.8.
- Professions: 1 Wojownik, 2 Mag, 3 Paladyn, 4 Tropiciel, 5 Tancerz ostrzy, 6 Łowca.

**`public/trends.json` — history, not a snapshot.** Every world's history folded to one
number per snapshot. Columnar: row *i* of every column is the same snapshot, the same
convention as the `.f.json`/`.n.json` pair. **The `act` buckets are disjoint** — §10 — so
"active ≤ 7 days" is the sum of the first two, and `ACTIVITY_THRESHOLDS` in `history.js` is
the only place allowed to mix the two scales. A snapshot with no `startedAt` drops out of
it, because there is nowhere to put it on a time axis, and how many dropped is reported
rather than swallowed.

`bytes` in it is the odd one out: not history but a **price** — the gzip size of that
world's newest `.f.json`, i.e. what one snapshot costs a client. One number per world, not
per snapshot, because per-snapshot sizes in the manifest measured 5835 → 7164 B gzip
(+1.3 KB on every visit for everyone) against +96 B for this.

### 9.3 Code

- **No linter, by choice — the compiler replaces it.** `strict`, `noUnusedLocals`,
  `noUnusedParameters`, `noUncheckedIndexedAccess`, `checkJs`. `[ASK]` before weakening any.
  Dead code has already survived two rebuilds here.
- **`checkJs` is on and there is no build step**, so the dashboard is typed through JSDoc
  on its exports. That is the price of `public/` being byte for byte what Pages serves;
  the alternative was a bundler and a generated artefact in git.
- **Comments say WHY, never WHAT**, and only what earns it: a decision with a rejected
  alternative, a measurement, a constraint the ranking imposes, a trap someone will
  otherwise fall into twice. Length is not the axis; what it carries is. A comment that
  only describes may never exist.
- **Unknown is loud, never zero.** A failed read returns `null` or an explicit unknown; it
  never substitutes `0` and never copies a neighbour.
- `[ALWAYS] [any]` **A literal earns a name by being spelled twice, or by deciding
  something.** Those two, and not "no magic numbers" — §7.1 has already deleted a constant
  that existed for its own sake. Spelled twice: the eight in the tooltip's edge clamp were
  four unrelated eights until they became `EDGE_GAP`. Decides something: a debounce, a
  threshold, a budget, the user agent §5 turns into a promise — somebody will go looking for
  it by name. What does not earn one is a number that configures the object it is written
  inside, once: `maxRotation: 45` says what it is, and `const MAX_ROTATION = 45` above it says
  it twice.

  ⚠️ A literal shared across a **file boundary** is a different problem and a name does not
  solve it — §9.7's colours, `:root` against `app.js`. There the answer is one address and a
  guard, because two files cannot be read together.
- `[ALWAYS] [any]` **Imports are written from the repository root.**

  ```ts
  import { parseTable } from "@/src/parser.ts";   // yes
  import { parseTable } from "./parser.ts";       // no — even a sibling
  ```

  `@/*` maps to the repository root: a path reads the same wherever it appears, and moving
  a file does not rewrite its neighbours' imports. There is no depth at which `../../` is
  acceptable. The dashboard is the one exception and it is the browser's, not ours —
  a `<script type="module">` resolves relative URLs and knows nothing of `tsconfig.json`,
  so `public/*.js` imports its siblings as `./shared.js`.

### 9.4 Naming

Follows the [naming cheatsheet][cheatsheet] by kettanaito. The binding subset plus what it
leaves open.

[cheatsheet]: https://github.com/kettanaito/naming-cheatsheet

**`[ALWAYS] [any]` A function name starts with the action it performs.**

| Action | Means |
|---|---|
| `get` | Accesses data immediately. `getSnapshotCount()` |
| `set` | Assigns a variable from one value to another. `setFilters(next)` |
| `reset` | Restores a variable to its initial state. `resetFilters()` |
| `remove` | Takes something **out of** somewhere. `removeProfession(id, filters)` |
| `delete` | Erases something from existence. `deleteLegacySnapshot(path)` |
| `compose` | Creates new data **from** existing data. `composeSnapshotUrl(world, id)` |
| `handle` | Handles an action; the usual callback name. `handleWorldChange()` |
| `parse` | Text → structure, throwing on anything unexpected. `parseTable(html, world, page)` |
| `read` | A file or a response → a value, refusing what it cannot read. `readFilterFile(path)` |
| `build` | Assembles an artefact this repo publishes. `buildWorldTrend(snapshots)` |
| `summarize` | Many rows → the few numbers a chart draws. `summarizeSnapshot(filters)` |
| `require` | A value narrowed to a type, or throws. `requireWorldName(text)` |
| `expect` | Fails a test unless something holds. A test's action and nobody else's. |

You `add` to somewhere, so its inverse is `remove`; you `create` with no destination, so
its inverse is `delete`. `parse` and `read` are not synonyms: `parse` knows a grammar and
throws, `read` takes what somebody else produced and may answer `null` (§9.5). Other verbs
are allowed where they are more precise, but `[NEVER]` a **synonym** for one in the table:
no `fetch` where `get` fits, no `update` where `set` fits.

**`[ALWAYS] [any]` A variable is never named exactly an action.** Those words are spent on
what a function does, so `const read` for a list of lines and `const pages` for a sentence
read as calls that never happen. `count` is the one exception and it is not ours: it is a
field of the snapshot format. The exported half of §9.4 was guarded from the start and the
local half was not, which is how one dry run grew all three in a single function.

**`[ALWAYS] [any]` Names follow A/HC/LC** — `prefix? + action + high context + low
context?`. `getSnapshotCountByWorld` = get + SnapshotCount + ByWorld.

**`[ALWAYS] [any]` Boolean names carry a prefix:**

| Prefix | Means |
|---|---|
| `is` | A characteristic or state of the current context. `isNeverOnline` |
| `has` | The context possesses a value or state. `hasCharIds` |
| `should` | A positive conditional coupled with an action. `shouldRefetchHistory` |
| `min` / `max` | A boundary. `maxDays` |
| `prev` / `next` | A state transition. `prevSnapshot`, `nextSnapshot` |

- **S-I-D — short, intuitive, descriptive**, all three.
- **Reflect the expected result.** `isDisabled`, not `isEnabled` used negated.
- **No contractions.** `button`, not `btn`. Abbreviate only where the ranking does, and say
  so in a comment.
- **Do not duplicate the context a name already sits in.**
- **Singular is one thing, plural is a collection.**
- **Files are kebab-case and name their contents, not their category.** `utils`, `helpers`,
  `common`, `misc` and `index` `[NEVER]` get created here.
- **Types name the thing, not its shape.** `SnapshotSummary`, not `SnapshotData`.

### 9.5 Errors and assertions

The heart of this repository's second rewrite. Two rules decide everything below:
**nothing produces a value nobody wrote**, and **a failure is either something a caller can
act on — an error with a code — or a broken invariant, which is an assertion.**

**`[ALWAYS] [any]` Every error we throw belongs to a branded hierarchy.** `[NEVER]` a bare
`new Error(...)`, `[NEVER]` `extends Error` outside a base file. The brand goes in `name`,
where a console shows it first.

| Base | Where | Runs | `name` looks like |
|---|---|---|---|
| `MargoStatError` — `public/lib/margostat-error.js` | the dashboard | a player's browser | `MargoStat/…` |
| `MargoStatToolError` — `src/margostat-tool-error.ts` | the scraper and the tools | a terminal | `MargoStatTool/…` |

Deliberately disjoint, so a `catch` on one side cannot swallow the other believing it
caught its own. Both bases are **abstract**: every kind of failure gets a named subclass
and a `code`, so callers never match on message text.

- `[ALWAYS] [any]` **Catch narrowly — exactly the error you expect.** One exception, and it
  is a place: **at the boundary with somebody else's program.** In this repository that is
  the `fetch` against the ranking, the `fetch` in the dashboard, and `JSON.parse` over a
  file somebody else's process may have truncated. **Away from such a boundary a broad
  catch is a bug** — `getLatestSnapshotCount` swallowed everything down to a typo of ours and
  answered `null`, which reads as "a world with no history".
- `[ALWAYS] [any]` **Pass the original in `cause` when wrapping.**
- `[ALWAYS] [dash]` **An expected failure in the dashboard is DATA**, not an exception that
  propagates: it becomes something the view can draw — §9.6. In `src/` and `tools/`,
  throwing loudly is the correct behaviour, because the caller is a person at a terminal.
- `[ALWAYS] [scrape]` **A rejected row is data too.** The parser collects rejections with
  reasons and the caller decides on the threshold; that is why one strange row cannot take
  down a world and why a changed table layout still can.

**Assertions are a different category.** An error class and a `code` exist so a failure can
be recognised and handled; a broken invariant cannot be, so it gets neither.
`public/lib/assert.js` sits outside both hierarchies: `AssertionFailure`, no `code`, its
own root. Where it broke comes from the stack, and what broke from a message naming the
invariant.

- `[ALWAYS] [any]` `assert` / `assertDefined` for what must never happen. `[NEVER]` for a
  failure you know can occur — that is an error class.
- `[ALWAYS] [any]` The message names the **invariant**, not the condition.
- `[NEVER] [any]` **`!` in `src/`, `tools/` or `public/`.** Use `assertDefined` — but first
  ask whether the type can be made precise; an assert over a type that could have been
  exact is covering for a loose type. Tests keep `!`.

**Reading a value: who produced it, and can anyone act on the failure.**

| Where the value came from | Mechanism | Why |
|---|---|---|
| **Inside** — our own regex or invariant guarantees it | `assert` / `assertDefined` | Nobody can handle it; a break means the program is wrong. |
| **Outside, in `src/` or `tools/`** — a snapshot file, a ranking page | a branded subclass with a `code`, thrown | A terminal command refuses bad material loudly. |
| **Outside, in the dashboard** — a fetched file, a URL parameter | **data**: `null` → an explicit unknown → something drawn | An exception here blanks the page. |
| A default that makes the number look right | **never** | `0` is a measurement. |

`[NEVER] [any]` **a cast off `JSON.parse`** — parsed text wearing a type is external data
nobody checked, and `JSON.parse(…) as FilterFile` is how a truncated file became a snapshot
with `undefined` columns.

**One way to read a value, and it lives in `public/lib/`.** `Number("")` is `0`,
`Number(" 5 ")` is `5`, `Number("0x10")` is `16`, `parseInt("12abc")` is `12`,
`Date.parse("nope")` is `NaN` and `NaN > limit` is `false`, `JSON.parse` throws and hands
back `any` — each produces a value nobody wrote. The first is the expensive one here:
`0` is a perfectly good honor reading, so a cell that arrived empty would be
indistinguishable from one that arrived as zero.

**`[ALWAYS] [any]` A construct belongs to a primitive in `public/lib/` if it has more than
one spelling in JavaScript, or can answer with a value nobody wrote.**

| Owner | Owns | Reading gives |
|---|---|---|
| `public/lib/number.js` | `Number()`, `parseInt`, `parseFloat`, unary `+`, `typeof … === "number"`, `String()` on a number | `getIntegerFromText`, `getFiniteNumberFromText`, `getIntegerFromValue`, `getFiniteNumberFromValue`. Writing asserts: `composeIntegerText` |
| `public/lib/json.js` | `JSON.parse` and its `try`/`catch`, `JSON.stringify` | `getValueFromJsonText` → the value **or** the `SyntaxError`; `composeJsonText` refuses a value with no JSON |
| `public/lib/timestamp.js` | `Date.parse`, `new Date(text)` | `getMillisecondsFromIsoText` → a number or `null`, never `NaN` |
| `public/lib/text-order.js` | `localeCompare` | `getTextOrder`, by code unit, deterministic — a sort that decides which snapshot is newest must not depend on a locale |

Look in `public/lib/` first; if it is not there and meets the criterion, add it there rather
than at the call site, even for one caller. **Reading returns `null` and throws nothing** —
the caller picks assert, error or unknown, and only the caller knows which. **Writing
asserts**, because the number is ours by then. A new primitive lands with its row here and
in §8.

Held by `test/tools/source-layout.test.ts`: no unbranded error, none outside the base
files, each subclass extending the base of its side, no `!` outside tests, no cast off
`JSON.parse`, and every construct in the register above spelled only by its owner — in
tests too.

### 9.6 The dashboard

- **The panel of controls says what it controls.** The world picker and the match counter
  live in the sticky bar and there is exactly one copy of each, so there is nothing to keep
  in sync. It was 961 px from the filter to the first history chart — more than a screen —
  so a control and the thing it controls were never visible at once.
- **The filter fields are an absolutely positioned drawer in that bar.** It opens where the
  user is looking, takes no space in the layout, so opening and closing does not move the
  page, and its initial state lives in the markup rather than in JS after some `fetch`es.
- `[ALWAYS] [dash]` **A number that might be wrong must never look like a number that is
  right.**
- `[NEVER] [dash]` **Interrupt.** No `alert`, `confirm`, `prompt`, modal, stolen focus.
- `[NEVER] [dash]` **Vanish.** A failure never blanks the page; only the part that failed is
  replaced, in place, by a short marker.
- `[NEVER] [dash]` **Swallow silently.** Every caught failure produces a visible mark and
  exactly one branded console entry — once, not per render.
- `[ALWAYS] [dash]` **Put the warning where the consequence is**, next to the figure it
  concerns, not in a global banner. A `suspect` snapshot marks its own point.
- `[ALWAYS] [dash]` **Keep "unknown" and "zero" apart on screen**, not only in the data.
  Zero happened and measured nothing; unknown could not be read.
- `[ALWAYS] [dash]` **A snapshot that did not load gets no point.** No interpolation, no
  substituting the unfiltered number from the aggregate. A hole makes a longer interval,
  and `perDay` divides by real elapsed time, so it stays honest.
- `[ALWAYS] [dash]` **The time axis comes from the aggregate, never from what was fetched.**
  Ticks, `scales.x.min/max` and the tooltips are built from that world's `trends.json`
  entry on both paths, so filtering can take points away but never the period the chart
  describes. The gap the budget leaves stays empty and is named, with the button that
  fetches the rest.

Two severities are enough, and a third is `[ASK]`:

| Severity | Means | Shown as |
|---|---|---|
| **Suspect** | The numbers drew, but the material may be short | A mark next to the affected figure; detail on demand |
| **Undrawn** | A section could not be rendered at all | That section replaced in place; everything else unaffected |

**The two paths to one set of charts.** At the default filter the history is drawn from
`trends.json` alone and no snapshot is fetched — that is why whoever does not filter does
not pay for the largest world's whole history. Once the filter moves, the view fetches that
one world's `.f.json` files, as many of the newest as fit a **transfer budget in bytes**,
and computes the history itself, exactly, with no bucketing.

`summarizeFiltered` in `filters.js` returns exactly the shape of a `trends.json` row, which
is why the drawing cannot tell the two paths apart. Under the default filter the two must
produce number for number what `summarizeSnapshot` in `src/trends.ts` produces, over every
snapshot on disk — §9.1's last rule, and a test holds it.

- `[ALWAYS] [dash]` **The budget is in bytes, never in snapshots.** A count priced the
  largest world (177 KB a snapshot) like the smallest (20 KB), so it trimmed the cheapest
  world of the twenty-one — saving 19 KB — and left the expensive one untouched.
  `docs/2026-08-26-spec-history-budget.md`.
- `[ALWAYS] [dash]` **`null` in `days` becomes `−1`** once a snapshot is converted to typed
  arrays, which cannot hold `null`. `−1 > maxDays` is **false**, so the `isNeverOnline`
  check comes **before** the threshold — otherwise accounts never used fall into every
  activity threshold. One place: `shared.js`.
- `[ALWAYS] [dash]` **The denominator of a share is the unfiltered population**, not the
  filtered set — that one would sum to 100%.
- `[ALWAYS] [dash]` **An activity filter eats thresholds wider than itself.** At "≤ 3 days"
  the "≤ 7 days" threshold counts the same players as the matches chart, and three lines on
  top of each other look like confirmation of something. `usableThresholds` removes them.
- `[ALWAYS] [dash]` **Fetching starts only from behind the debounce, and only once per
  world.** `loadHistory` holds a `world → Promise` map; calling it from the `input` handler
  pulled the same set of files once per keystroke. A test counts fetches per URL.
- `[ALWAYS] [dash]` **Read a `<select>`'s value before replacing its `innerHTML`.** The
  browser picks the first option even when the previous value is still on the list. The DOM
  stub used to be gentler than a browser and that is what hid it.

### 9.7 Design system

- `[ALWAYS] [dash]` **Tokens, not literals — and the rule does not stop at the stylesheet.**
  A raw hex in a CSS rule is a bug, and a raw hex in `app.js` is the same bug one file to the
  left. It was measured: 13 tokens in `:root` against 24 colour literals in `app.js`, every
  one of them an exact copy of a token's value, so changing `--muted` repainted the page and
  left every chart, tooltip and legend on the old grey with nothing to say so.

  Two ways down from `:root`, and neither is a second copy: markup this repo writes keeps
  `var(--token)` in its `style="…"`, and Chart.js — which takes a concrete colour and nothing
  else — is handed `getThemeTokens()`, read once from the document. A token that does not
  resolve is an **assertion**, not a fallback: the stylesheet ships in the same commit, so an
  empty string there is our bug, and §9.5 forbids painting with a value nobody wrote.

  One value is deliberately written twice — `<meta name="theme-color">` cannot hold a `var()`
  — and a test holds it equal to `--bg`. The series palette in `shared.js` is exempt on
  purpose: those six are a vocabulary of their own, and a module that may not touch the
  document (§9.1) could not read them from it anyway.
- **Two border tokens, and the split is load-bearing.** The borders of controls and cards
  need 3:1 (WCAG 2.2 SC 1.4.11); dividers inside a table do not. One shared value measured
  1.48:1 and a form field was indistinguishable from the card behind it.
- **Contrast is checked, not eyeballed.**
- **Colour never carries meaning alone** — it accompanies a label or a number.
- **Nothing is clipped that a keyboard can reach.** `overflow: hidden` left the filter chips
  a measured 0 px between 721 and 1100 px — three chips invisible, their close buttons with
  them. They scroll instead.

### 9.8 Language

**Write English.** Two exceptions, and the line between them is what somebody is reading.

| Stays Polish | Where |
|---|---|
| The text a player reads | `public/index.html` body copy, `aria-label`s, placeholders, `<title>`, `<meta description>`, `lang="pl"`, `trends.html`, `404.html` |
| UI strings built in JS | chart titles, chips, table headings, status and error copy in `app.js`; `PROFESSION_NAMES` in `shared.js`; `activityLabel`/`filterChips` in `filters.js`; `ACTIVITY_THRESHOLDS[].label` in `history.js`; `toLocaleString("pl-PL")` |
| Keys that match scraped material | `PROFESSION_BY_NAME`, `PROFESSION_BY_LETTER` and the `ł → l` folding in `parser.ts`; the captured page in `test/fixtures/` |
| `suspect.reason` | written by `snapshot.ts` into every flagged `.f.json` and rendered verbatim by the dashboard — server-side code composing a sentence for a player |
| The assertions pinning all of the above | the Polish expected values in `test/dashboard.test.ts` |

**Identifiers around a Polish string stay English**, and a Polish sentence never carries our
vocabulary: a player is told what the data cannot show, not why our reader could not read
it. A branded error's `code` and message are English even where the sentence drawn from it
is Polish — the code is ours, the sentence is theirs.

Everything else — every comment, every test name, every line a terminal prints, every word
in `docs/` — is English. Guarded by `test/language.test.ts`, which holds the list of files
allowed to speak Polish **in both directions**: a file that stops speaking it drops off the
list rather than guarding nothing.

The Polish query parameters `prog` and `udzial`, and the `liczba`/`udzial` option values
behind them, are a deliberate exception on a different axis: they are the contract of links
people have already shared, which is the entire reason `trends.html` still exists. A URL is
not code style. `[NEVER]` rename them.

### 9.9 The Pages budget

GitHub Pages caps a published artefact at 1 GB, and every round adds to `public/`. Two
budgets, and they are different things:

| Budget | Against | Spent by |
|---|---|---|
| **The artefact** | 1 GB, hard, imposed by Pages | Every snapshot ever scraped |
| **The transfer** | 2 MiB, ours, per filtered history | The `.f.json` files one filtered world fetches |

- `[ALWAYS] [any]` **Both are measured, never estimated in prose** — `bun run data:status`,
  and §5.
- `[ALWAYS] [dash]` **The transfer budget is spent in `bytes` from `trends.json`**, which is
  a gzip measurement. A raw size times a constant ratio will not do: the ratio is 4.18 for
  one world and 4.85 for another, so a constant misjudges one of them by 15%.
- `[ASK] [any]` **Before anything that changes what a round costs** — a new field in a
  `.f.json`, a new world, a change of interval. `docs/2026-08-01-size-budget.md` works out
  how many rounds are left.

---

## 10. Glossary

| Term | Meaning |
|---|---|
| **world** | One Margonem game world, e.g. `aether`. The unit everything is scoped to. A name goes into a URL **and** into a file path, so it is validated against `[a-z0-9-]` before either. |
| **round** | One pass over every world in `src/worlds.ts`. Run by hand, hence the uneven 3-17 day intervals. |
| **snapshot** | One world's whole ranking at one moment, written as a `.f.json` / `.n.json` pair. |
| **id** | A snapshot's identifier and the stem of its filenames. ⚠️ **Not a date** — §9.2. |
| **`startedAt`** | When the scrape of that world began, ISO 8601 UTC. The only trustworthy time in the system. |
| **filter file** | `<id>.f.json` — level, profession, honor, days. Everything filtering needs, and the only file the dashboard ever fetches per snapshot. |
| **names file** | `<id>.n.json` — nickname and `charId`. Personal data. Nothing reads it today. |
| **days** | How long ago a player was last online. `0` = under 24 h, `N` = N days, `null` = never used, `−1` = the same thing after conversion to a typed array. |
| **bucket** | One of five **disjoint** activity classes: `<24h`, `1-7`, `8-30`, `>30`, never. What `trends.json` stores. |
| **threshold** | A **cumulative** activity cut: "≤ 7 days" is buckets 0 and 1 together. ⚠️ Two scales, one subject — confusing them understates a chart by the whole `<24h` bucket. Only `ACTIVITY_THRESHOLDS` may cross between them. |
| **suspect** | A snapshot whose population dropped past the threshold against the previous one. Written, flagged, drawn — never discarded. |
| **aggregate** | `public/trends.json` — every world's history folded to one number per snapshot. The default history path. |
| **share** | A count as a percentage of the **unfiltered** population of that snapshot. |
| **transfer budget** | The ceiling on what a filtered history may fetch, in bytes — §9.9. |
| **schema** | The version of the written format, `SNAPSHOT_SCHEMA`. Changing it is `[ASK]` and reaches every published file. |

---

## What to read next

| File | What for |
|---|---|
| [`docs/2026-08-01-audit.md`](docs/2026-08-01-audit.md) | Audit #1: is the data real (it is — verified against the live ranking), what was broken, what was deleted, what is missing. |
| [`docs/2026-08-01-audit-2.md`](docs/2026-08-01-audit-2.md) | Audit #2 after the fixes: what held up, what was corrected, the debt ahead, and **the charId seam**. |
| [`docs/2026-08-01-size-budget.md`](docs/2026-08-01-size-budget.md) | How many rounds are left before the 1 GB Pages limit, and what to do when they run out. |
| [`docs/2026-08-04-spec-trends.md`](docs/2026-08-04-spec-trends.md) | The spec for one world's history: what to show, the shape of `trends.json`, the traps in the "last online" metric. |
| [`docs/2026-08-04-spec-world-view.md`](docs/2026-08-04-spec-world-view.md) | Merging the two pages into one view and filtering the whole history on the client: the measurements, lazy fetching, the traps. |
| [`docs/2026-08-04-audit-3.md`](docs/2026-08-04-audit-3.md) | Audit #3: eight bugs the tests did not catch, a DOM stub gentler than a browser, `Retry-After: 0`, a non-atomic write. |
| [`docs/2026-08-04-spec-filter-bar.md`](docs/2026-08-04-spec-filter-bar.md) | The pinned filter bar: page geometry measured in a browser, the variants, and the traps of `position: sticky` in this markup. |
| [`docs/2026-08-05-audit-ui-ux.md`](docs/2026-08-05-audit-ui-ux.md) | Audit #4, the first about the interface: border contrast, chips squeezed to 0 px, focus lost on Escape. The measuring method and three hypotheses disproved. |
| [`docs/2026-08-26-spec-history-budget.md`](docs/2026-08-26-spec-history-budget.md) | Pricing the history ceiling in bytes instead of snapshots, and why the time axis belongs to the aggregate. |
| [`docs/2026-08-27-spec-rewrite.md`](docs/2026-08-27-spec-rewrite.md) | This rewrite: what changed, the four latent faults that fell out of it, what the published `public/lib/` costs, and the two guards that were wrong before they were right. |
| [`README.md`](README.md) | The manual, for a human. |

New notes go to `docs/`, named `YYYY-MM-DD-<topic>.md`, and are added to the table in
[`docs/README.md`](docs/README.md) as well as to this one.
