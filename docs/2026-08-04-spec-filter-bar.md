# Spec: a filter that does not run away upwards — 2026-08-04

After the views were merged ([`2026-08-04-spec-world-view.md`](2026-08-04-spec-world-view.md))
one filter panel drives **two** sections of results: the cross-section of the chosen snapshot
and the history of all of them. That was the whole point of the merge — and the same thing
turned the panel into something you have to keep going back to, because there is a full screen
between the filter and the data it tunes.

This document settles where the filter is to live. There is no code here — per rule #4 in
[`../AGENTS.md`](../AGENTS.md).

---

## The problem — measured, not felt

Everything below was measured from `public/index.html` in its default state, with no notes
hidden.

| measurement at a width of 1400 px | value |
|---|---|
| the height of the whole document | **2806 px** |
| the `.toolbar` card (the filter panel) | **278 px**, ending at 349 px |
| from the bottom edge of the filters to **the first history chart** | **961 px** |
| from the filters to the change table | **2081 px** |
| the panel as a share of the screen | **31%** at 900 px, 26% at 1080 px |

961 px is **1.07 screen heights** at 900 px and 0.89 at 1080. In other words: the filter and
the first chart the filter acts on are **never visible at the same time**. The loop "change the
level threshold → scroll down → look → scroll up" is forced by the layout, not by habit.

And the thing that only came out of the measurement — **on a phone the problem is different and
larger**:

| measurement at a width of 375 px | value |
|---|---|
| the `.toolbar` card | **581 px** — 2.09× the desktop figure |
| its share of the first screen, iPhone SE (667 px) | **87%** |
| `#matchLine` ("Pasuje: N z M") | **below the fold** |

The culprit is the `.toolbar-row2` grid, which `@media (max-width: 720px)` does not override at
all (`public/index.html:208-214`): at 375 px it comes out as two columns and **five rows**,
because the "last online" block has `grid-column: span 2` and the professions `1 / -1`. On a
small screen the user gets the form first and the data only after scrolling.

---

## Why this hurts more here than in a shop

In a product list the results begin **directly** below the filter — scrolling half a screen
shows the effect. Here there are two sets of results, and the more interesting one starts
961 px lower. Three things specific to this view come on top:

- **The results update live**, with no "Apply" button (a 150 ms debounce), so the feedback loop
  is fast everywhere except that you have to be able to see it.
- **A filter change can pull up to 1.9 MB** of raw snapshots. Where the filter stands is the
  natural place for the state of that fetch.
- **One number carries the whole context** — "Pasuje: 1 749 z 79 528 (2,2%)". Today it leaves
  the screen after ~390 px, and for the remaining 2400 px the user looks at charts without
  knowing how many rows make them up.

---

## What the research says

| source | finding | what follows |
|---|---|---|
| **Nielsen Norman Group** | sticky headers save **~22% of navigation time** and users prefer them; they should take **≤ 10% of the screen height** (60-80 px on desktop) | we pin — but not the panel. 278 px is **31%**, three times over the threshold |
| **Baymard Institute** | horizontal filter bars break down above **6-8 filter types**; a sidebar remains the proven default | we have **four** filter groups — a horizontal bar is in the safe range |
| **Baymard Institute** | sites showing the active filters **both in the panel and as a summary above the results** had a "vastly lower rate of user errors" than sites with one of those patterns | we do **both** — the panel stays, the bar adds the summary |
| **Baymard Institute** | users **overlook filters hidden** behind an "All filters" button | we reject a drawer on desktop |
| **Smart Interface Design Patterns** (Vitaly Friedman) | filters should stay in one place while the results update alongside; on small screens the panel is collapsed or full-screen, with a result counter | this justifies a separate mobile pattern |

Sites worth looking at as good implementations:

- **Allegro** — filters in the left rail, the active ones listed above the list. Exactly the
  "both places at once" pattern, and the one a Polish user knows from daily use.
- **Crate & Barrel** — a panel hidden on demand, the active filters permanently above the
  results.
- **Galaxus** — live results and an explicit confirmation regardless; it shows that one does
  not preclude the other.
- **Wayfair, Tylko** — a horizontal bar with a small number of filters, i.e. our case.
- **Linear** — filters as chips, each removable, the state mirrored in the URL. margostat
  already has that second half (ten parameters round-trip); the first half is missing.

---

## The variants considered

| variant | for | against | verdict |
|---|---|---|---|
| Pin the **whole** panel | no new UI, no new state | **278 px = 31% of the screen**, three times over NN/g's threshold; 87% on a phone | rejected |
| A **left sidebar** (Allegro, Baymard's default) | a proven, familiar pattern, the filter always visible, room for plenty | it takes **21% of the width** (280 of 1352 px), and the charts live on width — gordion's histogram has ~320 bars on its axis; it means rewriting the whole layout and CSS | rejected for now, **kept as the retreat** once the filters pass the 6-8 threshold |
| A **drawer / overlay behind a button** | no permanent screen cost | Baymard: users overlook hidden filters; here they would be hidden **always** | rejected |
| **Duplicate controls in each section's heading** | the filter close to the data it concerns | two sources of truth for one state; with three sections, three sets to keep in sync | rejected |
| A **condensed bar pinned once you scroll** | fits inside NN/g's budget, satisfies both Baymard guidelines at once, does not touch the charts' width, section anchors for free | a second place showing the filter state; a permanent cost of ~7% of the screen | **chosen** |

---

## The resolution: a condensed bar

The full panel stays where it is. Once it leaves the screen, **a separate, low bar** pins
itself. The height budget: **≤ 64 px**, i.e. ≤ 7% of a 900 px screen — comfortably under NN/g's
threshold.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [gordion ▾]  Pasuje: 1 749 z 79 528 (2,2%)                               │
│ ⌫Poziom ≥ 250  ⌫Honor ≤ 50 000  ⌫≤ 14 dni  ⌫Mag, Paladyn                │
│                        Filtry (4) ▾    Przekrój · Historia               │
└──────────────────────────────────────────────────────────────────────────┘
```

The contents, in order of importance:

1. **The world picker** — the only control that changes everything at once, and the only one
   for which going back to the top is genuinely tiresome.
2. **"Pasuje: N z M (x%)"** — the number carrying the whole page's context.
3. **Chips for the active filters**, each with an `×`. This is where Baymard's second guideline
   is realised.
4. **`Filtry (4) ▾`** — expands the full panel **in place**, under the bar, with no jump to the
   top.
5. **The `Przekrój · Historia` anchors** — the page is 2806 px and there is no way today to jump
   between them.
6. **The state of the history fetch** while it runs ("4 of 10 snapshots").

The bar appears only once the full panel leaves the screen — held by an `IntersectionObserver`
on a sentinel inserted above the panel, not by a `scrollY` threshold. That way the top of the
page does not show the panel next to a summary of itself.

### Mobile gets its own pattern

Below 720 px the panel **starts collapsed**. The first screen begins with the bar (world +
"Pasuje" + `Filtry ▾`) and then straight with the data, rather than with 581 px of form. It is
the same pattern Friedman describes for small screens, and the only way to stop `#matchLine`
being below the fold.

While we are at it, `.toolbar-row2` finally has to get a rule in `@media (max-width: 720px)` —
there is none today, so the "last online" block with `grid-column: span 2` forces a second
column even when the grid drops to one.

---

## What changes in the code

- **`public/index.html`** — a sentinel above the panel, the bar's markup, the `position: sticky`
  and mobile rules. `.wrap` has neither `overflow` nor `transform` nor `contain`, so the
  scrolling container is the viewport and sticky will work without tricks.
- **`public/app.js`** — rendering the bar from the same `readFilters()`, the sentinel observer,
  collapsing and expanding the panel, handling `×` through the existing `applyFilters()`.
- **`public/filters.js`** — a new **pure** function `describeFilters(f) → [{ key, label }]`: the
  only place turning a filter into labels, testable without a browser. In line with the split
  this repo already follows.
- Reused without a single change: `readFilters`, `applyFilters`, `resetFilters`. All of them
  reach for `document.getElementById`, so **moving the controls under a different parent costs
  nothing**.

---

## Traps

**The histogram's tooltip will slide under the bar.** `#profTooltip` is
`position: fixed; z-index: 999` attached to `body` (`public/app.js:196-204`), and its position
clamp reads `if (y < 8) y = 8`. The bar has to have a higher `z-index`, and that clamp has to
allow for its height — otherwise a tooltip over the top bars hides behind the bar.

**The order in which listeners are registered is a contract of the test.**
`test/dom_smoke.ts` calls a node's **first-registered** listener (`handlers[0]`). New listeners
on `worldSelect`, `modeSelect`, `thresholdSelect`, `onlineValue`, `minLevel` and `resetBtn` have
to go in **after** the existing ones, otherwise the smoke test starts calling something other
than it thinks.

**`#profCheckboxes` has to remain the ancestor of its six checkboxes.** Three functions run
`querySelectorAll` on it, and the `change` listener relies on bubbling. The container may be
moved anywhere, but **with its contents**, and it **has to stay empty in the markup** —
`buildProfCheckboxes` does `appendChild` without clearing, so static checkboxes in the HTML
would give twelve instead of six.

**The tests are blind to structure but not to names.** They only check `id="..."` literals in
the file, so moving things and reordering them is free. Renaming any `id`, on the other hand,
**kills the view on startup** — `el()` throws.

**The chips must not be a second source of truth.** They render from `readFilters()`, and `×`
writes back through `applyFilters()`. No state of their own — otherwise we get exactly the class
of bug audit #3 listed five times in a row.

**`[hidden] { display: none !important }` beats `position: sticky`**, and
**`.tableBox { overflow-x: auto }`** (`public/index.html:200`) creates its own scrolling
container — nothing pinned may live inside `#changeTable`.

**Thresholds and scale are not filters.** `#thresholdSelect` and `#modeSelect` govern how the
history is drawn, not who enters it. They do not go into the filter bar. Worth noting in passing
that they are why the HISTORIA heading is **83 px instead of PRZEKRÓJ's 39 px** — two selects
built into `.section-head` with `align-items: baseline`.

**Zero external resources** — a test holds this. `IntersectionObserver` is native; no polyfill
needed.

---

## Pros and cons

**For:** the filter stops running away upwards on a page that is 2806 px tall; "Pasuje: N z M"
is always visible rather than only for the first 390 px; we satisfy both Baymard guidelines at
once instead of picking one; we fit inside NN/g's threshold with room to spare; the anchors
solve a second problem in the same move; the charts' width is untouched; on a phone the first
screen begins with data rather than with 581 px of form.

**Against:** a second place showing the filter state is a second place that can drift — audit #3
showed this project has a real problem with that. A pinned bar takes ~7% of the screen
**permanently**, including from somebody who does not filter at all. The chips require labels
that fit on one line, and with four filters on a narrow screen they have to collapse to the
counter alone anyway. A collapsed panel on a phone is one extra tap for somebody arriving for
the first time who does not yet know the filters exist.

And the most important thing — **this treats the symptom**. The page is still 2806 px, because
the three history charts have a rigid 320, 320 and 420 px, and the HISTORIA heading another 83.
Genuinely shortening the page is a decision about density that this spec does not take and that
a pinned bar does not replace.

---

## What actually shipped — two departures from the above

Added after the implementation. The spec above stays unchanged; this is a correction, not a
rewrite.

**1. The world picker and the match counter are not copied into the bar — they moved into it.**
The spec assumed the full panel would stay at the top and a separate summary bar would stick
once you scrolled. That would have given two places showing the same state, i.e. precisely the
drawback it wrote into "Against" itself. In the code the bar holds the **only copy** of both
controls, so there is nothing to keep in sync and there is no `IntersectionObserver` and no
sentinel.

**2. The filter panel is a drawer falling out from under the bar, not a block at the top of the
page.** The first version left the fields where they were and toggled them with the `hidden`
attribute. That had two drawbacks, both reported as soon as it was seen:

- after scrolling, the "Filtry" button **showed nothing** — the panel expanded at the top of the
  document, off screen;
- a panel toggled from JS only once the data arrived **moved the page** by its own height, and
  on a reload the restored scroll position landed somewhere else.

The drawer is `position: absolute` inside the sticky bar, so it opens where the user happens to
be looking, and **takes no space in the layout** — the document has the same number of pixels
open and closed. The initial state lives in the markup alone (`hidden`), so JS does not touch it
after load and has nothing to move the page with.

Measured after the change: the bar is **56 px** (6.2% of a 900 px screen) on desktop and
**88 px** (13.2% of a 667 px screen) on a phone, where two rows are needed — with one, the
counter was cut off mid-number, and a truncated number reads as a different number. The
document's height fell from 2930 to **2561 px**, because the panel stopped taking up space.

## What is deliberately not here

Rewriting the layout onto a left sidebar — it is kept as the retreat once the filter groups pass
the 6-8 threshold. An "Apply" button — the results update live behind a 150 ms debounce and that
works. Saved filter sets. Navigation broader than two anchors. Any change to the charts'
heights.
