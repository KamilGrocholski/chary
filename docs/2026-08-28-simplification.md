# 2026-08-28 — The rules are cut to what each one paid for

Read at `3c0179d`. This note records what came out of `AGENTS.md` and out of `test/tools/`,
so that a rule removed here can be found again by whoever wonders why it is gone.

## What prompted it

A count over the tree, excluding `public/worlds/` and `public/vendor/`:

| | lines |
|---|---|
| `src/` + `public/*.js` + `tools/` — the program | ~4 100 |
| `test/` — behaviour tests | ~2 550 |
| `test/tools/` — guards policing `AGENTS.md` itself | 1 031 |
| `AGENTS.md` | 974 |

The rulebook and the machinery enforcing it came to 2 005 lines against a 4 100-line
program. Nothing in the gate could report that, because a guarded rule passes by
construction — §7.7's own point, turned on the guards.

## The four guards that went

| File | Lines | Why |
|---|---|---|
| `test/tools/naming.test.ts` | 315 | A closed list of allowed verbs, which every new function had to be defended into. It enforced a style guide and caught no defect. §9.4 keeps the rules; nothing holds them now, and that is the trade. |
| `test/tools/structure-block.test.ts` | 103 | Held §8's hand-written tree block true against the tree. The block existed because something held it true; both are gone, and §1 carries five lines of orientation instead. |
| `test/tools/cited-paths.test.ts` | 67 | Checked that every path named in `AGENTS.md` and `README.md` exists. Most of the prose it guarded is what this round removed. |
| `test/tools/commit-messages.test.ts` | 150 | Judged the git history from inside a test run. It is why **both** workflows carried `fetch-depth: 0` + `filter: blob:none` and six lines of comment explaining that a grafted shallow commit reports its whole tree as added. A test that needs the CI checkout reconfigured to be runnable is a test paying rent. |

Kept, because they hold behaviour rather than prose:

- `test/tools/source-layout.test.ts` (347) — no bare `new Error`, no `!` outside tests, no
  cast off `JSON.parse`, every value-reading construct spelled only by its owner. Each has a
  recorded bug behind it.
- `test/tools/type-agreement.test.ts` (49) — the manifest entry the scraper writes against
  the one the dashboard reads. A real cross-boundary contract.

## `AGENTS.md`: 974 → 642

Not the ~350 that was estimated before the document was read line by line. The arithmetic
of what could not go:

| Section | Lines | Why it stays |
|---|---|---|
| §9.2 Data | 69 | The format and its traps: `days` `0`/`N`/`null`/`−1`, negative honor, `count` is a floor, an `id` is not a date, the charId seam, `suspect`, `overlapRows`. Unrecoverable if lost — the ranking has no history. |
| §9.5 Errors and assertions | 70 | Two hierarchies, the assert-versus-error split, the reading-a-value table, the value-reader register. Half of it is guarded, and the guard needs the register to be readable. |
| §9.6 The dashboard | 56 | Fourteen rules, no guard for most of them. |
| §7.6 Working from the ranking | 37 | Every bullet is a request pattern that was wrong once against somebody else's server. |

That is 232 lines of material with a price already paid. Cutting further would have meant
cutting those, so the target moved rather than the content.

**What came out**, roughly 330 lines:

- **§2's scope table** (`[lib]`, `[scrape]`, `[dash]`, `[data]`, `[tools]`, `[docs]`,
  `[process]`, `[any]`) and every scope tag on every rule. It was a second vocabulary for
  directories that already have names, and it had to be kept true as a table of its own.
- **§8, the structure block** — 60 lines describing the tree, plus the guard holding it.
  Prose describing a directory is the first thing to go stale; the tree is its own reference.
- **§9.4's naming tables** — the thirteen-row action table, the boolean-prefix table, the
  A/HC/LC formula, the foreign-interface list. Down to five bullets. The verb table now lives
  nowhere, which is the point: it lived in two places, and the copy in the guard was the one
  a round actually had to satisfy.
- **§7.2's scope list and type table**, **§7.3** (parallelism and subagents), **§7.7's**
  procedure — down to the parts that decide something.
- **The reasoning essays** in §9.1, §9.3, §9.6 and §9.7 that restate a measurement already
  written down in `docs/` — the 961 px between filter and chart
  (`2026-08-05-audit-ui-ux.md`), the removed transfer ceiling
  (`2026-08-26-spec-history-budget.md`, `2026-08-28-history-without-a-budget.md`), the
  `Number("")` litany (`public/lib/number.js`'s own docblock).

**What did not change:** every `[ALWAYS]`/`[ASK]`/`[NEVER]` that names a fault this
repository has actually had. The three labels stay. No rule was weakened to make a section
shorter; a rule either survived intact or was removed with its reason recorded above.

## The section numbers did not move

`§9.5`, `§9.2` and their neighbours are cited 97 times across `src/`, `public/`, `tools/`,
`test/`, `README.md` and `docs/`. Renumbering would have rewritten ~50 files' comments to
say the same thing, so a removed section leaves its number unused instead. §8 keeps its
heading and a line saying where it went.

## The build step

`bun build` ships inside Bun, so this added **no dependency**. `public/worlds/` is 173 MB,
which rules out any `dist/`-copy design — and it needed none: only the module graph under
the dashboard's entry point is built, and it lands back in `public/` as one gitignored file.

```
public/lib/*.js        →  src/lib/*.ts        the bottom layer, now shared by path
public/shared.js       →  src/shared.ts       the vocabulary of the data
public/*.js            →  web/*.ts            the dashboard
public/app.js                                 GENERATED, gitignored
```

What it removed, beyond the syntax:

- **115 JSDoc type tags** in the dashboard, and every `/** @type {X} */ (…)` cast with them.
  `checkJs` and `allowJs` are gone from `tsconfig.json`; there is nothing left for them to
  check.
- **§9.1's edge case.** `public/lib/` sat under the published directory for exactly one
  reason — with no build step it was the only place both `src/*.ts` and a browser could
  import from. That paragraph is gone; `src/lib/` is simply the bottom layer.
- **§9.3's exception.** `public/*.js` had to import siblings as `./shared.js`, because a
  `<script type="module">` resolves relative URLs and knows nothing of `tsconfig.json`. Every
  import in the tree is now `@/…`, at every depth, with no exception — and the guard that
  used to hold the exception was deleted rather than kept guarding nothing.

`deploy.yml` gained `bun install` + `bun run build` before the Pages upload. The gate does
**not** build: nothing under test reads `public/app.js`, so a stale bundle can neither pass
nor fail it, and `test/dom-smoke.ts` imports `web/app.ts` rather than the bundle.

## `happy-dom` instead of the hand-written stub

`test/dom-smoke.ts` went from **472 to 405 lines** — not to zero, and the estimate that said
otherwise was wrong about what the file held. Roughly 130 lines of it were a DOM: a node
factory, an `innerHTML` setter imitating what a `<select>` does to its own value, a
`:root`-token regex standing in for the cascade, a hand-assembled `globalThis`. Those are
gone. What stays is everything that is **not** a document and still has to be stubbed: the
network (~110 lines of fetch counting, an injected failure, a one-snapshot world), Chart.js
(which wants a canvas and paints pixels nothing here reads), and the extraction of the
result the assertions compare against.

The fidelity is the return, not the line count:

- The `<select>` trap §9.6 records is now caught by the browser's own behaviour rather than
  by a stub written to imitate it. Verified by breaking the read order in
  `fillThresholdSelect` and watching "the chosen threshold survives a rebuild of the option
  list" go red.
- A chip's close button is now **clicked**. The old stub had no event delegation, so that
  test called a listener by hand with a fabricated `{ target: { dataset: { clear } } }` —
  it held the handler, not the wiring.
- `app.ts` carried a comment saying the bar's listeners had to be registered **last**,
  because the stub called `handlers[0]`. Real events do not care; the comment is gone.
- The theme comes through a real cascade, so `getThemeTokens`'s assertion is held against
  what a browser would compute rather than against a regular expression over the stylesheet.

## The view is a layer, not one closure

`public/app.js` was 1412 lines, 1290 of them inside a single `startView()` closure holding
~50 nested functions and eight pieces of mutable state. It is now seven files:

| File | Lines | Holds |
|---|---|---|
| `web/app.ts` | 448 | the wiring: `manifest`, `trends`, what is in flight, when to redraw, what to fetch |
| `web/charts.ts` | 401 | the Chart.js instances and the time axis — the four variables that outlive a render |
| `web/controls.ts` | 264 | the form: reading it, writing it, the chips, the drawer, the threshold picker |
| `web/panels.ts` | 221 | the text panels, one node each |
| `web/dom.ts` | 88 | every lookup in the document, and the `:root` tokens |
| `web/format.ts` | 52 | numbers and failures as a Polish-speaking reader sees them |
| `web/margostat-error.ts` | 35 | the base every browser-side error extends |

Three couplings were cut rather than carried across:

- `renderHistoryCharts` read the threshold off a `<select>`. The picker owns that choice, so
  the board is handed the key.
- `renderHistoryStatus` read the in-flight `progress` out of the closure. It is a parameter.
- `clearHistoryCharts` also emptied the change table. The board clears charts; `app.ts` has
  a `clearHistory()` that clears both, because all three of its callers wanted both and one
  that had cleared only the charts would leave the previous world's table standing.

§9.1's DOM rule moved with the code: "`app.js` is the only module that touches the DOM"
became "`web/` is the view layer", with `format.ts` and `fetch-json.ts` named as the two
inside it that must reach for neither — held by a new test, proved to fail by making
`format.ts` read `document.title`.

The tests that scan the view for ids, tokens and classes now read all seven files rather
than `app.ts` alone. Read over the wiring only, each of those rules would have been held
over nothing that draws.

## Where the estimates were wrong

Two of the four figures in the plan were guesses made before the material was read, and both
were optimistic. `AGENTS.md` reached 651 lines, not ~350: §9.2, §9.5, §9.6 and §7.6 are 232
lines of traps and error rules that each cost something once, and hitting the number meant
cutting those. `test/dom-smoke.ts` reached 405 lines, not 0: most of it was never a DOM. The
target moved rather than the content, both times.

## What this round did not touch

`public/worlds/`, `test/fixtures/`, `SNAPSHOT_SCHEMA`, the `.f.json`/`.n.json` pair,
`trends.json` and every published URL — unchanged, and `git status` over the data was
checked empty at each step. Chart.js is still vendored: bundling it from npm would change
the runtime-dependency promise in `README.md`, and that is a separate `[ASK]`.
