# The rail: the filter stops being somewhere else

2026-09-16, from `e2348cb`. A redesign of the world view, chosen from three directions drawn
side by side before any code was written. This note records what the chosen one invalidates,
because two of the decisions it overturns were measured and written down in
[`2026-08-04-spec-filter-bar.md`](2026-08-04-spec-filter-bar.md), and a decision reversed in
silence reads exactly like a decision nobody made.

---

## What was chosen, and against what

Three directions, each drawn at desktop and phone width on real aether data: **A — a data
console** (a permanent left rail, the charts in a 2×2 grid), **B — a report** (large figures,
numbered sections, one sentence of lead per chart), **C — bento** (KPI tiles over a grid of
mixed spans). A was chosen.

The palettes were not eyeballed. The first `--border-strong` picked by hand for the dark
console palette measured **2.43:1** against `--panel` — under the 3:1 of WCAG 2.2 SC 1.4.11,
and the same class of fault the 2026-08-05 audit already paid for once. All six palettes
(three directions × two modes) were then solved by search against all three surfaces rather
than chosen; the shipped pair measures:

| | vs `--panel` | vs `--surface-2` | vs `--bg` |
|---|---|---|---|
| dark `--border-strong: #616b7b` | 3.33:1 | 3.07:1 | 3.56:1 |
| light `--border-strong: #808b99` | 3.46:1 | 3.05:1 | 3.19:1 |

## What it overturns

`2026-08-04-spec-filter-bar.md:64-72,260-265` rejected a left sidebar and rejected a drawer on
desktop, and `:230-258` put the world picker and the match counter into a pinned bar because
**it was 961 px from the filter to the first history chart** — more than a screen, so the two
were never visible at once.

The rail answers that measurement differently rather than denying it: the filter is not
brought closer to the chart, it is taken out of the scroll entirely. Above 1100 px it stands
beside the charts at every scroll position, so the distance is not a number any more. Below
1100 px it becomes an overlay and the old behaviour returns — a button, a panel over the
content, Escape and click-outside to close — because at that width 272 px of rail left a chart
column narrower than the phone layout gives one.

What survives from that spec unchanged: the world picker and the match counter stay in the
bar in **one** copy; the chips stay, and still both summarise the filter and remove it; the
bar keeps a **fixed** height so nothing moves when the data lands; and the open state still
lives in the markup alone and is never set from JS after load.

What changed in how that last one is spelled: `hidden` became `data-open`. `hidden` is one
answer for every width, and this panel has to be shown on a desktop and closed on a phone at
the same moment — so the attribute carries the state and CSS decides at which width it means
anything.

## Measured, at four widths

Taken through the DevTools protocol on the filtered view
(`?world=aether&minLevel=200&maxLevel=250&prof=1,4`), 375 px via device emulation because
Chrome will not open a window narrower than 500 px. The "before" column is the geometry table
in `2026-08-05-audit-ui-ux.md:262-270`; it was taken on a smaller set of snapshots, so the
page heights are indicative and the distances are not.

| | 1440 | 1100 | 800 | 375 |
|---|---|---|---|---|
| document height | **1511** (was 2561) | 2356 | **2376** (was 2606) | **2412** (was 2628) |
| bar height | 52 (was 56) | 52 | 52 (was 56) | 88 (was 88) |
| rail | shown, 272 px | overlay | overlay | overlay |
| filter → first history chart | **345** (was 973) | 888 | **908** (was 1018) | **1064** (was 1268) |
| chips, client/scroll | 537 / 537 | 592 / 592 | **292 / 294** (was 188 / 421) | hidden, as before |
| horizontal page scroll | none | none | none | none |

At 1440 the 345 px is measured at scroll 0 from the bottom of the last filter field; it is not
the number that matters any more, because the rail does not scroll away. The page is **1050 px
shorter** at that width, which is the 2×2 history grid: four full-width charts became two rows
of two.

The 800 px band is where the 2026-08-05 audit found the chips clipped to **0 px**. They now
measure 292 px of 294 — scrolling by 2 px rather than clipping — with the same
`overflow-x: auto` that fixed it then, in a bar that has one fewer thing in it.

## A defect found on the way, older than this round

Every snapshot is a tick on the time axis and `autoSkip` is off, so **every** date printed. Two
rounds can be 1.9 days apart — aether's last two — and at that spacing the labels run into
each other: on a 500 px chart "12.09" and "14.09" came out as `121.0909`, which is neither one
date nor two. It was there before this redesign at full width; halving the chart width made it
unmissable.

`selectSpacedTicks` (`web/charts.ts`) now drops a label closer than 44 px to the last one
kept, and keeps **both ends whatever the spacing** — when the last two collide, the one that
gives way is the one before the end, because the ends are what say which period the chart
covers. It takes the geometry as an argument rather than reading it: at the moment Chart.js
calls `afterBuildTicks` the scale has a width but not yet its pixel origin, so
`getPixelForValue` answers `NaN`. That also makes it a pure function four tests hold against
aether's real intervals.

## Guards added

- **The palette is compared across the three pages.** `trends.html` and `404.html` held
  `#101013` and `#3987e5` as literals and would have stayed on the old theme without a word.
  They cannot share a stylesheet — there is no CSS build step, and `index.html`'s block has to
  stay inline because `dom-smoke.ts` strips every `<script>` and never fetches a `<link>`, so
  `getThemeTokens()` would assert. The copies stay; the drift between them does not.
- **The rail's price of a transfer is asserted in both scenarios**: one line under the default
  filter, two once a filter has started spending. `renderTransferInfo` printing the whole
  history's price at the default filter was made to fail and did.
- `selectSpacedTicks` — four tests over real intervals, including that the newest date is never
  the one dropped.

Each was broken and watched go red before being restored: the markup's `data-open`, the
`spending` guard on the price, the 404 palette, and the tick spacing.

## What was left

- **The rail shows a `<select>` of worlds, not the list of 21 with their populations** that the
  drawing showed. A list is a second control for one thing, and the populations are in
  `trends.json` but nothing reads them for that purpose today — §7.1. The drawing is the
  record of what was not built.
- **The light theme has no switch.** It follows `prefers-color-scheme` only. The selector is
  already written as `:root:not([data-theme="dark"])`, so a switch would be a control and an
  attribute, not a second palette — but nothing asks for one yet.
- **No test holds the layout itself.** Everything above was measured in a browser by hand, as
  in 2026-08-05, and the same gap remains: the gate has no geometry in it.
