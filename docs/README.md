# docs/ — audits and notes

Dated records from particular rounds of work: what was checked, what was fixed, what was
deliberately left for later. This is the context behind decisions, not current
documentation — do not update old notes, add new ones.

Starting work on the project? Read [`../AGENTS.md`](../AGENTS.md) first, not this directory.

| File | What for |
|---|---|
| [`2026-08-01-audit.md`](2026-08-01-audit.md) | Audit #1: is the data real (it is — verified against the live ranking), what was broken, what was deleted, what is missing. |
| [`2026-08-01-audit-2.md`](2026-08-01-audit-2.md) | Audit #2 after the fixes: what held up, what was corrected, **the debt ahead and a list of ideas**. |
| [`2026-08-01-size-budget.md`](2026-08-01-size-budget.md) | How many scrape rounds are left before the 1 GB Pages limit (~65 ≈ 2 years) and what to do when they run out. |
| [`2026-08-04-spec-trends.md`](2026-08-04-spec-trends.md) | The spec for one world's trends over time: what to show, `trends.json` (**9.0 KB gzip for the whole history**), the traps in the "last online" metric. |
| [`2026-08-04-spec-world-view.md`](2026-08-04-spec-world-view.md) | The spec for merging both views into one per world and filtering **the whole history** on the client (**7 ms over 813k rows, zero bytes against the Pages limit**). |
| [`2026-08-04-audit-3.md`](2026-08-04-audit-3.md) | Audit #3 after the views were merged: **eight bugs that 165 tests did not catch**, a DOM stub gentler than a browser, the debt and a list of ideas. |
| [`2026-08-04-spec-filter-bar.md`](2026-08-04-spec-filter-bar.md) | The spec for the pinned filter bar: the page is **2806 px**, and on a phone the panel eats **87% of the first screen**. The variants, the research (NN/g, Baymard) and examples from other sites. |
| [`2026-08-05-audit-ui-ux.md`](2026-08-05-audit-ui-ux.md) | Audit #4, the first one about the interface: the borders of controls measured **1.48:1** against a 3:1 threshold, chips vanished to **0 px** in the 721-1100 px band, focus was lost on Escape and on a chip's close button. Plus three hypotheses disproved by measurement. |
| [`2026-08-26-spec-history-budget.md`](2026-08-26-spec-history-budget.md) | The ceiling on a filtered history in **bytes instead of snapshots**: a count priced gordion (177 KB a snapshot) like brutal (20 KB) and trimmed the wrong one. The budget, where the size comes from, and why the time axis belongs to the aggregate. |

| [`2026-08-27-spec-rewrite.md`](2026-08-27-spec-rewrite.md) | The rewrite: `AGENTS.md` in rules with scopes, a value-reader floor in `public/lib/`, two branded error hierarchies, the dashboard typechecked through JSDoc, and the guards that hold all of it. What it cost and what was left undone. |
Filenames: `YYYY-MM-DD-<topic>.md`. Add a new note to the table above **and** to the "What
to read next" section in [`../AGENTS.md`](../AGENTS.md) — otherwise nobody will find it.
