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

## What this round does not fix

`public/app.js` is 1412 lines, of which 1290 are one `startView()` closure — untouched here,
and the largest remaining thing in the tree. `test/dom-smoke.ts` is 472 lines of hand-rolled
DOM stub, which §9.6 already records as having hidden a real bug by being gentler than a
browser. There is still no build step, so the dashboard is typed through JSDoc and
`public/lib/` has to sit in the published directory for both sides to import it. Separate
rounds, each with its own reason.

