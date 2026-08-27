# 2026-08-27 — the rewrite: rules a machine can hold

What changed in this round, what it cost, and what was deliberately not done. Written for
somebody reading the diff later and wondering why a whole layer appeared under `public/`.

## Why

`AGENTS.md` was 360 lines of good narrative and nothing held any of it. Two symptoms, both
measured rather than suspected:

- The "State" line asked to be refreshed by hand after every round, and was not: it read
  **12 rounds** while the longest history on disk was **13**. A stale number in a document
  reads exactly like a measured one.
- One rule in the whole repository had a guard behind it (`test/language.test.ts`). Every
  other rule was a sentence somebody had to remember.

The code had the same shape from the other side. `world_scraper.ts` carried three private
error classes with a `readonly type` field apiece — three hierarchies of one, none catchable
by base. `public/app.js` threw `new Error("HTTP 404 dla …")` and the view read that message
back with a regular expression to choose which Polish sentence to show, so rewording an
English string would have silently changed what a player saw. `normalizeLegacyRows` — the
migration of data that **cannot be fetched again** — read every column through `Number()`,
which answers `0` for an empty cell and `NaN` for a missing one, and `NaN` reaches a written
file as `null`. The dashboard was not typechecked at all.

## What was done

**`AGENTS.md` rewritten** in the shape MargoMeter uses: `[ALWAYS]`/`[ASK]`/`[NEVER]` with
scopes, a structure block, a glossary, and — the load-bearing change — a rule that no number
describing the tree or the data as it stands may live in prose. Those figures moved into
`tools/data-status.ts`, which measures them on demand.

**A floor, in `public/lib/`.** `assert.js` (and `AssertionFailure`, deliberately outside both
error hierarchies, deliberately without a `code`), plus one reader per construct that has
more than one spelling in JavaScript or can answer with a value nobody wrote: `number.js`,
`json.js`, `timestamp.js`, `text-order.js`. Reading answers `null` and throws nothing —
only the caller knows whether the right response is an assertion, a thrown error or a mark
on the screen. Writing asserts, because by then the number is ours.

**Two disjoint error hierarchies**, `MargoStatError` for the browser and
`MargoStatToolError` for the terminal, both abstract, every failure a named subclass with a
`code`. `describeFailure` in the dashboard now switches on the code; the English message is
no longer load-bearing.

**Every call site moved onto the floor**, and four latent faults fell out of doing it:

| Where | What it did | What it does now |
|---|---|---|
| `parser.ts` | `replace(/[^\d-]/g, "")` read `"1-2"` as `12` and `"--5"` as `−5` | a reader that names what it strips (spaces, the profession letter) and refuses the rest |
| `snapshot.ts` | `latestSnapshotCount` caught everything, including our own typo, and answered `null` — which reads as "a world with no history" and disarms the population guard | the catch narrowed to "no directory yet"; an unreadable file says so |
| `retry.ts` | `Number(header)` accepted `" 5 "`, `"0x10"`, `"1e3"` — three spellings `Retry-After` does not have | `getIntegerFromText`, which is what RFC 9110's delay-seconds actually is |
| `world-scraper.ts` | `--drop-threshold=0x1` passed; `scrape aether 1000abc` ran at 1000 ms | both read through the floor; the argument reading moved to `scraper-cli.ts`, which is pure and now has 35 tests where it had none |

**The dashboard typechecked.** `checkJs` and `noUncheckedIndexedAccess` on, 287 errors
worked through, no build step added: the types are JSDoc, so `public/` is still byte for
byte what Pages serves. `noUncheckedIndexedAccess` is what removed the three `!` in
`trends.ts`, each of which stood over a real invariant that is now stated as one.

**Guards, in `test/tools/`.** `source-layout` (brands and codes, no bare `new Error`, no `!`
outside tests, no cast off `JSON.parse`, the value-reader register, imports, file names),
`structure-block`, `cited-paths`, `commit-messages`. Every one of them was broken on purpose
and watched go red before being kept.

## What it cost

**A published bottom layer.** `public/lib/` sits inside the directory that ships, because
without a build step it is the only place both `src/*.ts` and the browser can import from.
The alternative was one copy of `assert` and one of every reader per side, and this
repository has already paid for two copies of one answer once (`activityBucket`, which needs
a test holding the server's and the browser's versions together). A visitor downloads only
what a dashboard module imports, so a reader used by the scraper alone costs them nothing.

**Two guards were wrong first, and both failures are recorded in their own comments.** The
source-layout guard blanked template literals whole, so `new Date(` inside a log line went
uncounted; then it blanked quoted strings by pattern and swallowed its own test titles. The
import check read paths off the *blanked* source, so it matched nothing at all and passed
green over a deliberately planted `./manifest.ts`. Both are now scanned properly, and both
carry a count assertion so "found nothing" can no longer pass for "nothing is wrong".

**The DOM stub had to grow.** It answered `{ ok, status, json }` with no `text()` — narrower
than the browser it stands for — so the day the view began reading a body as text before
parsing it, 25 assertions failed against code a browser runs correctly. Audit #3 recorded
the same class of fault in the other direction (a stub *gentler* than a browser); this is the
first time it has been narrower.

## Verified

- `bun run check` green: typecheck with `checkJs` clean, 332 tests.
- `bun run rebuild` run twice against the real `public/worlds/`: `manifest.json` byte for
  byte identical, `trends.json` identical but for `builtAt`. **Nothing under
  `public/worlds/` was written.**
- Every new guard broken on purpose and watched fail, then restored.

## Deliberately not done

- **`tools/mutation-sweep.ts`** — the plan named it. Nothing needs it yet: every guard added
  here was proved to fail by hand, and a tool that automates a thing done four times is code
  written on spec (§7.1). The idea is here; the code is not.
- **Typing the vendored Chart.js.** It arrives minified with no type information, so the
  hole is named once, as `ChartInstance` in `app.js`, rather than spread as an implicit
  `any` through every chart.
- **An audit.** This round rewrote the rules; reading the tree against them is a separate
  round, and §7.7 says reading and fixing are separate commits.
