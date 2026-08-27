# AGENTS.md — the entry point for an agent

The single source of rules for anyone — human or agent — working in this repository.
`CLAUDE.md` only imports this file. If a rule is not here, it is not a rule.

Rules first. A rule carries its reason only where the reason is what makes it obeyable —
usually a measurement or a trap somebody already fell into. Longer reasoning lives in the
docblock of the file it concerns, or in `docs/`. What never belongs here is a number
describing the tree or the data as it stands today — §5.

**The section numbers are addresses.** Comments across `src/`, `web/`, `tools/` and
`test/` cite them, so a number is never reused and a removed section leaves its number
unused rather than shifting its neighbours.

---

## 1. Project

MargoStat is a ranking scraper for [Margonem](https://www.margonem.pl), a browser-based MMORPG,
plus a static dashboard on GitHub Pages. It periodically fetches the player ranking of every
tracked world, writes snapshots as static JSON, and lets anyone browse and filter them with no
backend at all. **It reads and does nothing else** — no account, no game client, no automation,
one HTTP request per second against a public ranking page.

- **Live:** https://kamilgrocholski.github.io/chary/ · **Repo:**
  `git@github.com:KamilGrocholski/chary.git`. The project is **MargoStat**, the repository
  `chary`, the npm id `margostat` (lowercase — npm forbids capitals). None of the three
  disagreements is a mistake.
- **Data source:** `https://www.margonem.pl/ladder/<world>?page=N`

Bun + TypeScript throughout, one runtime dependency (`cheerio`) and one vendored library
(Chart.js). `bun build` — which ships inside Bun, so it is not a dependency — bundles the
dashboard into `public/app.js`, the one generated file there and the only one gitignored.

**Orientation.** `src/` is the scraper and the data format, terminal only; `src/lib/` is the
bottom layer both sides read and `src/shared.ts` the vocabulary of the data. `web/` is the
dashboard, built into `public/`. `public/` is what Pages serves: the markup, `vendor/`, `worlds/` — and `app.js`, which is
output. `tools/` ships nowhere. `test/` sits beside what it tests. `docs/` holds dated specs
and audits, indexed by `docs/README.md`. Why a file is the way it is lives in its own docblock;
what is in `public/` right now is `bun run data:status`, never prose (§5).

## 2. Labels

| Tag | Meaning |
|---|---|
| `[ALWAYS]` | Do it every time. No judgment call. |
| `[ASK]` | Stop and ask the user before doing it. |
| `[NEVER]` | Do not do it. Not "prefer not to". |

Untagged prose is context and does not bind.

---

## 3. ALWAYS

- **Run the gate after every change**, including a one-line edit. §6.1.
- **Prove a new test can fail.** Break what it covers, watch it go red, restore. Say in the
  commit what you broke and what lit up.
- **Run `bun run scrape:check` before a full scrape.** Margonem changed the table layout once
  and the scraper fell over on all twenty worlds while exiting with code 0. A round is over an
  hour long and overwrites nothing that can be fetched again — §9.2.
- **A claim about the ranking carries the date it was read**, negative claims included. Its
  markup and its columns are somebody else's system: dated, or a guess.
- **A measurement over the data names the material it was taken on** — the world and the
  snapshot, or the set and its date. "The snapshots" goes stale on the next round.
- **Make unknown input loud.** A cell the parser cannot read becomes a rejected row with a
  reason, never a substituted value — §9.5.
- **Write English**, except the text a player reads. The boundary is §9.8 and
  `test/language.test.ts` holds it.
- **Leave the gate green** — every commit on its own, including when one change is split
  across several.
- **Work lands on `main`, and a push to `main` publishes.** `deploy.yml` runs the gate first
  and does not publish without it.

## 4. ASK FIRST

- **Committing or pushing.** Otherwise finish a round with the changes in the working tree
  and a summary.
- **Touching anything under `public/worlds/` or `test/fixtures/`** — §9.2. Reformatting counts,
  and so does a migration, even a provably lossless one.
- **Changing the data contract** — `SNAPSHOT_SCHEMA`, the `.f.json`/`.n.json` pair, or
  `trends.json`. Every published file and every shared link is downstream of it.
- **Deleting or skipping a test**, including "it's obsolete".
- **Adding a runtime dependency.** One runtime dependency is a feature; a dashboard that
  fetches nothing from a CDN is a promise. A `devDependency` reaches no browser and is an
  ordinary judgment call.
- **Turning off a compiler flag or a guard test** to pass.
- **Adding a file nothing uses yet** — §7.1.
- **Adding or removing a world in `src/worlds.ts`.** One that leaves stops being scraped; one
  that joins starts a history that cannot be backfilled.

## 5. NEVER

- **Edit captured material to make a test pass.** If the fixture contradicts the code, the
  code or the understanding is wrong.
- **Invent data the ranking does not carry.** `0` is a measurement, so a field that could not
  be read never becomes `0`, never copies its neighbour and never borrows the previous
  snapshot's value. Unknown has a spelling of its own — §9.5.
- **Fetch anything the repository does not publish.** The dashboard reads `manifest.json`,
  `trends.json` and files under `worlds/`, all same-origin. No CDN, no analytics, no font host.
  Chart.js is vendored for this reason.
- **Comment the obvious.** §9.3.
- **Leave a number in prose that a machine could compute of the tree or the data as it
  stands** — snapshot counts, file sizes, test counts. Measure at read time:
  `bun run data:status`. A stale number reads exactly like a measured one, and the last drift
  stood for two rounds. A historical measurement is a different thing and stays: "the split cut
  `public/` from 620 MB to 118 MB" describes something that happened.
- **Put `public/worlds/` or `test/fixtures/` under an open-source licence.** The ranking
  database belongs to Margonem's publisher (terms `XIX.2` / `VII.2.m)`, plus the sui generis
  database right), and a `.n.json` holds nicknames, which are personal data. `LICENSE` is plain
  MIT and covers the code only, with not a word about the data — GitHub detects a licence by
  similarity to a template, and a note about scope would change the detected licence to
  "Other". The scope lives in `README.md`.
- **Disguise the scraper as a browser.** The user agent says who is knocking:
  `Mozilla/5.0 (margostat scraper)`.

## 6. Commands

### 6.1 The gate

```bash
bun run check      # typecheck + tests — THE GATE, must pass
bun test           # tests only, while iterating
bun run typecheck  # types only
```

One command, so there is no version of "I ran the tests but not the typecheck". It does not
build: nothing under test reads `public/app.js`, so a stale bundle can neither pass nor fail it.

### 6.2 Working commands

```bash
bun run scrape:check                 # the first two pages of every world, writes nothing — ALWAYS before a scrape
bun run scrape                       # every world in src/worlds.ts, ~1 req/s
bun run scrape aether                # a single world
bun run scrape aether,tempest 2000   # chosen worlds, custom interval in ms (min. 250)
bun run rebuild                      # data maintenance: migrate old schemas + manifest + trends
bun run build                        # web/ → public/app.js (+ .map), gitignored, what Pages serves
bun run serve                        # builds, then http://localhost:3000
bun run data:status                  # what is in public/ right now — §5
```

A tool arrives with the question it answers (§7.1). `tools/data-status.ts` answers *what is
in `public/` right now?* — snapshots, rounds, the artefact against the Pages limit, what one
snapshot costs a visitor. The figures §5 keeps out of prose.

---

## 7. Workflow

### 7.1 Shape of a round

**Nothing exists before it is needed** — files, directories, modules, tools and guards
alike. A file is created in the commit that uses it; a shared module appears at the
**second** consumer; a guard appears when there is something to guard; a tool appears with
its question.

This repository has already deleted a constant and an entire module that existed "for
later": `aggregate.ts` produced fields no view read, and `NEVER_ONLINE_DAYS` survived a
format rebuild in the dashboard because nobody was holding it. If something has no consumer
today, describe the idea in `docs/` and do not commit the code.

A round: understand the problem → change the smallest thing that addresses it → run the
gate (§6.1) → report (§7.4). If you catch yourself writing a plan, the change deserves one
written down before the code. Independent tool calls go in one message.

### 7.2 Commits

Conventional Commits, English: `type(scope): effect`. The header names the **effect**, not
the activity — "the history ceiling is priced in bytes", not "change the snapshot window".

The body is the primary record of reasoning, with no length limit: numbers rather than
adjectives, what decided it (a measurement, or taste — say which), the rejected
alternatives, what you broke and what lit up (§3), and what stays open.

- `[ALWAYS]` **A scrape round is committed on its own, as `scrape: …`** — no source change
  in the same commit. A round rewrites `manifest.json` and `trends.json` and adds tens of
  megabytes; a code change hiding inside that diff is a code change nobody will ever read.

### 7.4 Reporting

End a round with: what changed, what you validated and what came back, what you did **not**
do and why. Report failures with the output, and say when a step was skipped. Nothing is
done until the gate is green.

### 7.5 What a round teaches

Three places, in order: **a guard**, if a machine can check it; **a rule here**, if it needs
judgment, naming the cost that produced it; **the commit message**, if it is neither. There is
no place for a file of accumulated lessons.

Rules that arrived this way, each paid for at least once:

- **Do not trust a hypothesis — measure.** "The chart is unreadable because of level 1" was
  false, and one command over the data on disk said so.
- **Read back the result of a scripted edit.** A pattern that no longer matches does nothing
  and says nothing.
- **Test the boundary from both sides, and zero is the boundary.** A level cannot be zero but
  honor can, and `days: 0` means "today". A test at `0` needs one at `1` beside it, and one
  below where the type allows: honor reaches −35 and `days` carries −1.
- **Two sides of an assertion that can agree by arithmetic are not being compared.**
  `expect(tableRows).toBe(chartPoints)` passed for months over a table missing its oldest
  snapshot in every world — the header plus n−1 change rows also comes to n. Assert the
  **contents** of the boundary row, not only how many there are.
- **A test compares against the truth, not against itself** — the parser against a capture of a
  real ranking page, the filters against a real snapshot in the old schema.
- **Before writing a guard that two modules agree, ask why there are two.**
  `getActivityBucket` was written twice with a test holding them equal value for value. The
  test was right and the second copy was not: the rule keeping `src/` out of the shared vocabulary
  created it, and opening that edge (§9.1) left one function and nothing to compare.

### 7.6 Working from the ranking

The ranking is somebody else's service and our only source. What it looks like, what its
columns mean, what it prints for an account nobody has used: dated claims, per §3.

- `[ALWAYS]` **One request per second is the default, and 250 ms is the floor.** At 400 ms
  the ranking answers `429`. `robots.txt` does not forbid `/ladder` and Margonem's own
  `sitemap.xml` lists those paths, but that is not an invitation to hammer it.
- `[ALWAYS]` **A retry retries one page.** It used to rewind the whole world to page 1 — for
  the largest world that is hundreds of pages, up to four times, after a quarter of an hour
  of work.
- `[ALWAYS]` **The server's hint may lengthen a pause and never shorten it.**
  `Retry-After: 0` is a real answer, and `suggested ?? own` let it through — because
  `0 ?? x` is `0` — so four requests went out back to back (`src/retry.ts`).
- `[ALWAYS]` **One strange row must not take down a world.** A row that cannot be read is
  rejected with a reason; only above 1% of a page do we assume the markup changed and abort.
- `[ALWAYS]` **The pages of a walk are stitched, never concatenated.** `?page=N` is an offset
  into a live list, not an address in a fixed one, and a round spends 6-13 minutes per world.
  A character inserted above the current page pushes the tail of it onto the next one; a
  character leaving pulls characters past unseen. `removePageOverlap`
  (`src/page-overlap.ts`) drops a `charId` already fetched and keeps the first copy, because
  row *i* is rank *i+1*. Measured on 2026-08-27: 150 rows across the published snapshots
  were fetched twice, 122 of them luvia's — the world that takes ~5500 new characters a
  round against ~350 for aether.
- `[ALWAYS]` **A snapshot's `count` is a floor, not a population.** The repeats can be
  removed; the characters the list shifted past leave nothing on the page to find them by.
  One luvia snapshot double-counted 52 rows and missed at least 20 characters at the same
  time. `[NEVER]` present it as an exact population, and `[NEVER]` estimate the difference.
- `[ALWAYS]` **The "#" column is an offset, not a rank.** It reads `(page − 1) · 100 + i + 1`
  and is contiguous by construction — probed 2026-08-27, luvia page 2 prints 101..200 and
  page 3 prints 201..300 — so it says the same thing whether or not the page repeats
  characters. A sequence check over it passes on every snapshot, including the broken ones.
  Identity is `charId` and nothing else.
- `[ALWAYS]` **The population guard writes rather than rejects.** A snapshot whose population
  dropped more than the threshold against the previous one is written and flagged `suspect`.
  Losing a whole round hurts more than a snapshot with a warning, and the warning reaches the
  dashboard.

### 7.7 Audits

An **audit** is one round that reads the whole repository and writes down what it found. It
measures the half the gate cannot report, since a guarded rule passes by construction.

- `[ALWAYS]` An audit **carries the commit it read**, says **what was not read** (*not looked
  at*, *looked at and clean* and *a finding* are three answers), and **names a file and a line**
  per finding.
- `[ALWAYS]` **Every finding closes into one of §7.5's three places, or is declined with a
  reason.** Leaving it open is not an answer.
- `[NEVER]` **Fix while auditing**, and `[NEVER]` **append to a closed audit** — the next one is
  a new file. `[ASK]` before deleting one.

Open one unasked when the same class of fault turns up in two rounds, or when a round touches a
layer no audit has read.

## 8. Structure

*Removed on 2026-08-28. A hand-written tree block is the first prose to go stale, and the
guard that kept it true cost more than the block was worth — `docs/2026-08-28-simplification.md`.
§1 carries a short orientation instead; the tree itself is the reference.*

---

## 9. Rules

### 9.1 Architecture

- `[ALWAYS]` **`src/lib/` is the bottom layer** and knows nothing of the ranking, the scraper or
  the document. Everything may read it; it reads nothing. `src/shared.ts` sits just above it: the
  vocabulary of the data, stated once for the scraper and the dashboard alike.

  ⚠️ `src/shared.ts` crossing to the browser was opened after counting what its absence cost: the
  activity scale written out four times, the bucket and profession counts as an array literal nine
  times, the profession names three. What may cross is the vocabulary of the ranking and of the
  published format — a colour, a Polish label or a date format travels the other way and `src/`
  has no business importing it.
- `[ALWAYS]` **`src/` never imports `web/`.** The dependency runs one way: `web/` reads `src/lib/`
  and `src/shared.ts`, and nothing in `src/` reads the dashboard. `web/app.ts` starts the view on
  import and `web/fetch-json.ts` is written against the browser's `fetch`, so an import the other
  way would start a view inside a scrape.
- `[ALWAYS]` **`web/app.ts` is the only module that touches the DOM.** `src/shared.ts`,
  `web/filters.ts` and `web/history.ts` touch no document and run nothing on import — that is what
  makes them testable outside a browser, and a test holds it. `fetch` in `web/history.ts` is not
  an exception: it is not the document interface, and the tests substitute a stub.
- `[ALWAYS]` **A tool may read anything.** It ships nowhere — and a report about what the
  dashboard costs is only true if it reads the same material the dashboard reads.
- `[ALWAYS]` **`public/app.js` is output, never a source.** It is gitignored and rebuilt; a rule
  or a test read over it would be read over a transformation of what it means to hold.
- `[ALWAYS]` **A file holds one subject, however long that subject runs.** What forces a split
  is a **second** subject — never a line count, and never a docblock that got long.
- `[ALWAYS]` **Two spellings of one answer need a guard.** Where the server and the browser must
  agree — the activity buckets, the filter predicate, the snapshot summary — one is the
  reference and a test compares the other against it over real material.

### 9.2 Data

`public/worlds/` is the ranking as it stood at a moment in time. **The ranking has no
history**, so whatever was not scraped then cannot be recovered now: this is evidence, not
test data, and neither is `test/fixtures/`.

- `[NEVER]` Edit either to make anything pass.
- `[ASK]` Any change at all, including reformatting and including a migration.
- `[ALWAYS]` **A migration is lossless and verified row by row against the originals in
  git**, and it refuses rather than substitutes — a row it cannot read stops the migration.
- `[ALWAYS]` **Snapshots are discovered by reading the directory**, never from a
  hand-maintained list of names.
- `[ALWAYS]` **Every write into `public/` is atomic** — a temp file and a rename, via
  `src/atomic.ts`. `Bun.write` truncates first, so a Ctrl-C mid-write leaves a truncated
  snapshot, and a truncated snapshot took down `JSON.parse` in the manifest build — which is
  both the tail of an hour-long round and the `bun run rebuild` meant to repair it.
- `[ALWAYS]` **An empty world directory fails its own test.**

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
- **`count` is what the walk collected, not what the world holds** — a floor. Before 08.2026
  a character could land in a snapshot twice, and in any snapshot a character can be missed
  entirely. `overlapRows` says how many repeats were dropped on the way in; it is absent, not
  `0`, on everything written before anything counted. §7.6 and
  `docs/2026-08-27-page-boundary-overlap.md`.
- **A snapshot's `id` is NOT a date.** Files from before August 2026 carry local time in the
  name, newer ones UTC. Displaying a date and measuring an interval use `startedAt` from the
  manifest or the file, and nothing else. The same goes for the `timestamp` field **inside**
  the data files — that is an identifier, and it keeps its name because renaming it would
  mean rewriting every published file for cosmetics.
- **`charId` exists only from August 2026 onwards.** Older snapshots join by nickname, and a
  nickname is not stable — "the charId seam" in `docs/2026-08-01-audit-2.md`.
- **`suspect` marks a snapshot whose population dropped past the threshold** against the
  previous one. The data is written; it may be truncated. Its `reason` is Polish because the
  dashboard renders it to a player verbatim — §9.8.
- Professions: 1 Wojownik, 2 Mag, 3 Paladyn, 4 Tropiciel, 5 Tancerz ostrzy, 6 Łowca.

**`public/trends.json` — history, not a snapshot.** Every world's history folded to one
number per snapshot. Columnar: row *i* of every column is the same snapshot, the same
convention as the `.f.json`/`.n.json` pair. **The `act` buckets are disjoint** — §10 — so
"active ≤ 7 days" is the sum of the first two, and `ACTIVITY_THRESHOLDS` in `web/history.ts` is
the only place allowed to mix the two scales. A snapshot with no `startedAt` drops out of it,
because there is nowhere to put it on a time axis, and how many dropped is reported rather
than swallowed.

`bytes` in it is the odd one out: not history but a **price** — the gzip size of that world's
newest `.f.json`, i.e. what one snapshot costs a client. One number per world, not per
snapshot, because per-snapshot sizes in the manifest measured 5835 → 7164 B gzip (+1.3 KB on
every visit for everyone) against +96 B for this.

### 9.3 Code

- **No linter, by choice — the compiler replaces it.** `strict`, `noUnusedLocals`,
  `noUnusedParameters`, `noUncheckedIndexedAccess`. `[ASK]` before weakening any.
  Dead code has already survived two rebuilds here.
- **Comments say WHY, never WHAT**, and only what earns it: a decision with a rejected
  alternative, a measurement, a constraint the ranking imposes, a trap someone will otherwise
  fall into twice. Length is not the axis; what it carries is.
- **Unknown is loud, never zero.** A failed read returns `null` or an explicit unknown.
- `[ALWAYS]` **A literal earns a name by being spelled twice, or by deciding something** — and
  not by "no magic numbers". `maxRotation: 45` says what it is; `const MAX_ROTATION = 45` above
  it says it twice. ⚠️ A literal shared across a **file boundary** is a different problem that a
  name does not solve (§9.7's colours, `:root` against `web/app.ts`): there the answer is one
  address and a guard, because two files cannot be read together.
- `[ALWAYS]` **Imports are written from the repository root** — `@/src/parser.ts`, never
  `./parser.ts`, at no depth. `@/*` maps to the repository root, so a path reads the same
  wherever it appears and moving a file does not rewrite its neighbours' imports. There is no
  exception left — the dashboard was one, because a `<script type="module">` resolves relative
  URLs and knows nothing of `tsconfig.json`, and `bun build` resolving the graph removed it.

### 9.4 Naming

- `[ALWAYS]` **A function name starts with the action it performs**, and the rule binds every
  function, not only the exported ones. An accessor named like a value reads like a value:
  `baseTrend()` and `currentSnapshot()` in `web/app.ts` were calls that looked like fields. A
  variable is never named exactly an action, for the same reason — `const read` for a list of
  lines read as a call that never happens.
- `[ALWAYS]` **Booleans carry a prefix that says what they answer** — `is`, `has`, `should`,
  `min`/`max`, `prev`/`next` — and reflect the expected result: `isDisabled`, not `isEnabled`
  used negated.
- `[ALWAYS]` **No contractions, and that includes a single letter.** `button`, not `btn`;
  `row`, not `r`. Abbreviate only where the ranking does, and say so in a comment. `$` for a
  loaded Cheerio document and `_` for a parameter nobody reads are that library's spelling
  and the language's, not ours.
- `[ALWAYS]` **Files are kebab-case and name their contents, not their category.** `utils`,
  `helpers`, `common`, `misc` and `index` `[NEVER]` get created here. Types name the thing,
  not its shape: `SnapshotSummary`, not `SnapshotData`.
- Short, intuitive, descriptive — all three. Do not duplicate the context a name already sits
  in. Singular is one thing, plural is a collection.

A name that belongs to somebody else's interface is exempt: `fetch` as Bun's server handler,
the DOM methods a stub has to answer to, `set` in a property descriptor, `byProf` as a column
of `trends.json`.

### 9.5 Errors and assertions

Two rules decide everything below: **nothing produces a value nobody wrote**, and **a failure is
either something a caller can act on — an error with a code — or a broken invariant, which is an
assertion.**

**`[ALWAYS]` Every error we throw belongs to a branded hierarchy.** `[NEVER]` a bare
`new Error(...)`, `[NEVER]` `extends Error` outside a base file. The brand goes in `name`, where
a console shows it first.

| Base | Where | `name` looks like |
|---|---|---|
| `MargoStatError` — `web/margostat-error.ts` | the dashboard, a player's browser | `MargoStat/…` |
| `MargoStatToolError` — `src/margostat-tool-error.ts` | the scraper and the tools, a terminal | `MargoStatTool/…` |

Deliberately disjoint, so a `catch` on one side cannot swallow the other believing it caught its
own. Both bases are **abstract**: every kind of failure gets a named subclass and a `code`, so
callers never match on message text.

- `[ALWAYS]` **Catch narrowly — exactly the error you expect.** One exception, and it is a place:
  **the boundary with somebody else's program** — the `fetch` against the ranking, the `fetch` in
  the dashboard, `JSON.parse` over a file another process may have truncated. Away from such a
  boundary a broad catch is a bug: `getLatestSnapshotCount` swallowed everything down to a typo
  of ours and answered `null`, which reads as "a world with no history".
- `[ALWAYS]` **Pass the original in `cause` when wrapping.**
- `[ALWAYS]` **An expected failure in the dashboard is DATA**, not an exception that propagates:
  it becomes something the view can draw — §9.6. In `src/` and `tools/` throwing loudly is
  correct, because the caller is a person at a terminal. **A rejected row is data too**: the
  parser collects rejections with reasons and the caller decides on the threshold, which is why
  one strange row cannot take down a world and why a changed table layout still can.

**Assertions are a different category.** A `code` exists so a failure can be recognised and
handled; a broken invariant cannot be, so it gets neither a code nor a hierarchy —
`src/lib/assert.ts` holds `AssertionFailure` outside both.

- `[ALWAYS]` `assert` / `assertDefined` for what must never happen, never for a failure you know
  can occur — that is an error class. The message names the **invariant**, not the condition.
- `[NEVER]` **`!` in `src/`, `web/` or `tools/`.** Use `assertDefined` — but first ask whether
  the type can be made precise; an assert over a type that could have been exact is covering for
  a loose type. Tests keep `!`.

**Reading a value: who produced it, and can anyone act on the failure.**

| Where the value came from | Mechanism | Why |
|---|---|---|
| **Inside** — our own regex or invariant guarantees it | `assert` / `assertDefined` | Nobody can handle it; a break means the program is wrong. |
| **Outside, in `src/` or `tools/`** — a snapshot file, a ranking page | a branded subclass with a `code`, thrown | A terminal command refuses bad material loudly. |
| **Outside, in the dashboard** — a fetched file, a URL parameter | **data**: `null` → an explicit unknown → something drawn | An exception here blanks the page. |
| A default that makes the number look right | **never** | `0` is a measurement. |

`[NEVER]` **a cast off `JSON.parse`** — parsed text wearing a type is external data nobody
checked, and `JSON.parse(…) as FilterFile` is how a truncated file became a snapshot with
`undefined` columns.

**`[ALWAYS]` A construct belongs to a primitive in `src/lib/` if it has more than one spelling
in JavaScript, or can answer with a value nobody wrote.** `Number("")` is `0` and `0` is a
perfectly good honor reading, so a cell that arrived empty must not be indistinguishable from one
that arrived as zero. Each owner's docblock lists what its construct invents.

| Owner | Owns | Reading gives |
|---|---|---|
| `src/lib/number.ts` | `Number()`, `parseInt`, `parseFloat`, unary `+`, `typeof … === "number"`, `String()` on a number | `getIntegerFromText`, `getFiniteNumberFromText`, `getIntegerFromValue`, `getFiniteNumberFromValue`; writing asserts, via `composeIntegerText` |
| `src/lib/json.ts` | `JSON.parse` and its `try`/`catch`, `JSON.stringify` | `getValueFromJsonText` → the value **or** the `SyntaxError`; `composeJsonText` refuses a value with no JSON |
| `src/lib/timestamp.ts` | `Date.parse`, `new Date(text)` | `getMillisecondsFromIsoText` → a number or `null`, never `NaN` |
| `src/lib/text-order.ts` | `localeCompare` | `getTextOrder`, by code unit — a sort deciding which snapshot is newest must not depend on a locale |

`src/lib/byte-size.ts` is in the same directory on a different ticket: the one place `1024` and its
powers are written. Look in `src/lib/` first; if a construct is not there and meets the
criterion, add it there rather than at the call site, even for one caller. **Reading returns
`null` and throws nothing** — only the caller knows whether that is an assert, an error or an
unknown. **Writing asserts**, because the number is ours by then. A new primitive lands with its
row above. `test/tools/source-layout.test.ts` holds all of §9.5 that a machine can hold.

### 9.6 The dashboard

- **The panel of controls says what it controls**, in one copy, in the sticky bar: it was 961 px
  from the filter to the first chart, so the two were never visible at once. The filter fields
  are an absolutely positioned drawer in that bar, so opening it does not move the page.
- `[ALWAYS]` **A number that might be wrong must never look like a number that is right.**
- `[NEVER]` **Interrupt.** No `alert`, `confirm`, `prompt`, modal, stolen focus.
- `[NEVER]` **Vanish.** A failure never blanks the page; only the part that failed is replaced,
  in place, by a short marker.
- `[NEVER]` **Swallow silently.** Every caught failure produces a visible mark and exactly one
  branded console entry — once, not per render.
- `[ALWAYS]` **Put the warning where the consequence is**, next to the figure it concerns, not
  in a global banner. A `suspect` snapshot marks its own point.
- `[ALWAYS]` **Keep "unknown" and "zero" apart on screen**, not only in the data. Zero happened
  and measured nothing; unknown could not be read.
- `[ALWAYS]` **A snapshot that did not load gets no point.** No interpolation, no substituting
  the unfiltered number from the aggregate. A hole makes a longer interval, and `perDay` divides
  by real elapsed time, so it stays honest.
- `[ALWAYS]` **The time axis comes from the aggregate, never from what was fetched.** Ticks,
  `scales.x.min/max` and the tooltips are built from that world's `trends.json` entry on both
  paths, so filtering can take points away but never the period the chart describes.

Two severities are enough and a third is `[ASK]`: **suspect** — the numbers drew but the material
may be short, marked next to the affected figure; **undrawn** — a section could not be rendered
and is replaced in place, everything else unaffected.

**The two paths to one set of charts.** At the default filter the history is drawn from
`trends.json` alone and no snapshot is fetched, so whoever does not filter pays nothing for the
largest world's history. Once the filter moves, the view fetches **every** `.f.json` of that one
world and computes the history exactly. `summarizeFiltered` in `web/filters.ts` returns the shape of
a `trends.json` row, which is why the drawing cannot tell the paths apart — and under the default
filter it must produce number for number what `summarizeSnapshot` in `src/trends.ts` does, over
every snapshot on disk. §9.1's last rule, and a test holds it.

- `[ALWAYS]` **A filtered history reaches every snapshot, and says what that costs while it is
  being spent.** No ceiling, no button — measured 2026-08-28, the most expensive world's whole
  history is 2.1 MB gzipped. What is left of "transfer is bought knowingly" is the price in the
  status line, carrying a `~` because `bytes` prices the newest snapshot and older ones are
  smaller. ⚠️ Whatever comes back when a history outgrows a browser is **not** a count of
  snapshots — that is what the removed ceiling counted, and it trimmed the cheapest of the
  twenty-one worlds. `docs/2026-08-28-history-without-a-budget.md`.
- `[ALWAYS]` **`null` in `days` becomes `−1`** once a snapshot is converted to typed arrays,
  which cannot hold `null`. `−1 > maxDays` is **false**, so the `isNeverOnline` check comes
  **before** the threshold — otherwise accounts never used fall into every activity threshold.
  One place: `src/shared.ts`.
- `[ALWAYS]` **The denominator of a share is the unfiltered population**, not the filtered set —
  that one would sum to 100%.
- `[ALWAYS]` **An activity filter eats thresholds wider than itself.** At "≤ 3 days" the
  "≤ 7 days" threshold counts the same players as the matches chart, and three lines on top of
  each other look like confirmation of something. `usableThresholds` removes them.
- `[ALWAYS]` **Fetching starts only from behind the debounce, and only once per world.**
  `loadHistory` holds a `world → Promise` map; calling it from the `input` handler pulled the
  same set of files once per keystroke. A test counts fetches per URL.
- `[ALWAYS]` **Read a `<select>`'s value before replacing its `innerHTML`.** The browser picks
  the first option even when the previous value is still on the list. It stayed hidden while the
  view was tested against a hand-written DOM stub gentler than a browser — which is why
  `test/dom-smoke.ts` now runs against `happy-dom` and stubs only what is not a document.

### 9.7 Design system

- `[ALWAYS]` **Tokens, not literals — and the rule does not stop at the stylesheet.** A raw
  hex in a CSS rule is a bug, and a raw hex in `web/app.ts` is the same bug one file to the left.
  It was measured: 13 tokens in `:root` against 24 colour literals in `web/app.ts`, every one an
  exact copy of a token's value, so changing `--muted` repainted the page and left every
  chart, tooltip and legend on the old grey with nothing to say so.

  Two ways down from `:root`, neither a second copy: markup this repo writes keeps
  `var(--token)` in its `style="…"`, and Chart.js — which takes a concrete colour — is handed
  `getThemeTokens()`, read once from the document. A token that does not resolve is an
  **assertion**, not a fallback. Two exemptions: `<meta name="theme-color">` cannot hold a
  `var()`, so a test holds it equal to `--bg`; and the series palette in `src/shared.ts` is a
  vocabulary of its own, in a module that may not touch the document at all.
- **Two border tokens, and the split is load-bearing.** The borders of controls and cards need
  3:1 (WCAG 2.2 SC 1.4.11); dividers inside a table do not. One shared value measured 1.48:1
  and a form field was indistinguishable from the card behind it.
- **Contrast is checked, not eyeballed**, and **colour never carries meaning alone** — it
  accompanies a label or a number.
- **Nothing is clipped that a keyboard can reach.** `overflow: hidden` left the filter chips a
  measured 0 px between 721 and 1100 px — three chips invisible, their close buttons with
  them. They scroll instead.

### 9.8 Language

**Write English.** Two exceptions, and the line between them is what somebody is reading.

| Stays Polish | Where |
|---|---|
| The text a player reads | `public/index.html` body copy, `aria-label`s, placeholders, `<title>`, `<meta description>`, `lang="pl"`, `trends.html`, `404.html` |
| UI strings built in JS | chart titles, chips, table headings, status and error copy in `web/app.ts`; `PROFESSION_NAMES` in `src/shared.ts`; `activityLabel`/`filterChips` in `web/filters.ts`; `ACTIVITY_THRESHOLDS[].label` in `web/history.ts`; `toLocaleString("pl-PL")` |
| Keys that match scraped material | `PROFESSION_NAMES` in `src/shared.ts`, which `parser.ts` folds through `ł → l` to read a heading, and `PROFESSION_BY_LETTER` in `parser.ts` — the ranking's own letter code; the captured page in `test/fixtures/`; the "N dni temu" pattern in `parser.ts` |
| `suspect.reason` | written by `snapshot.ts` into every flagged `.f.json` and rendered verbatim by the dashboard |
| The assertions pinning all of the above | the Polish expected values in `test/dashboard.test.ts` |

**Identifiers around a Polish string stay English**, and a Polish sentence never carries our
vocabulary: a player is told what the data cannot show, not why our reader could not read it. A
branded error's `code` and message are English even where the sentence drawn from it is Polish.

`test/language.test.ts` holds the list of files allowed to speak Polish **in both directions**:
a file that stops speaking it drops off the list rather than guarding nothing.

`prog` and `udzial` in the query string, and the `liczba`/`udzial` values behind them, are a
deliberate exception on a different axis — they are the contract of links people have already
shared, which is the entire reason `trends.html` exists. `[NEVER]` rename them.

### 9.9 The Pages budget, and the price of a filtered history

GitHub Pages caps a published artefact at 1 GB, and every round adds to `public/`. One is a
**budget** — a ceiling somebody enforces — and one is a **price**, which is watched rather than
enforced:

| | Against | Spent by |
|---|---|---|
| **The artefact** — a budget | 1 GB, hard, imposed by Pages | Every snapshot ever scraped |
| **The transfer** — a price | Nothing; it is reported, not capped | Every `.f.json` of the one world a visitor filtered |

- `[ALWAYS]` **Both are measured, never estimated in prose** — `bun run data:status`, and §5.
- `[ALWAYS]` **Both are measured in gzip, over the files themselves.** A raw size times a
  constant ratio will not do: the ratio is 4.18 for one world and 4.85 for another, so a
  constant misjudges one of them by 15%. `bytes` in `trends.json` is that measurement for one
  snapshot; a whole history is the sum of its files, not that figure multiplied out.
- `[ASK]` **Before anything that changes what a round costs** — a new field in a `.f.json`, a
  new world, a change of interval. `docs/2026-08-01-size-budget.md` works out how many rounds
  are left.

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
| **price of a history** | What one filtered world costs a visitor over the wire, in gzipped bytes — measured, not capped. §9.9. |
| **schema** | The version of the written format, `SNAPSHOT_SCHEMA`. Changing it is `[ASK]` and reaches every published file. |

---

Dated specs and audits live in `docs/`, indexed by [`docs/README.md`](docs/README.md) — read
that index before a round that touches a layer you have not worked in. New notes are named
`YYYY-MM-DD-<topic>.md` and added to it. [`README.md`](README.md) is the manual, for a human.
