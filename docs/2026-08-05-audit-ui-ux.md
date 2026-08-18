# Audit #4 — the interface: contrast, keyboard, geometry

2026-08-05. The first audit of this repo whose subject is the **visual and interaction
layer** rather than the data. The three before it asked whether the numbers were real,
whether the filter lost the threshold and whether we were fetching 5.7 MB instead of 1.9 MB.
None asked whether a form field is visible and whether this view can be used without a mouse.

The starting point is that **the tests do not touch this layer**: `dashboard.test.ts` checks
literals and numbers, `dom_smoke.ts` builds a stub with a regex over `id="…"`. No CSS, no
geometry, no focus (`2026-08-04-audit-3.md:213-216`). Everything below had to be measured in a
browser.

---

## Method

Per rule #2 ("do not trust a hypothesis — measure"), nothing here is judged by eye:

- **Contrast** — computed from the WCAG relative-luminance formula, for each pair from the
  palette separately. The same function verified the palette after the change.
- **Geometry and behaviour** — Firefox 140 headless, the dashboard in a frame of a given width
  (375, 800, 1440 px), measurements through `getBoundingClientRect` and `getComputedStyle` from
  the parent page, results sent back by POST. Scenarios played out through events, not by
  clicking blindly.
- **The history collapsing** — with a 900 ms throttle per snapshot file. On localhost the full
  set arrives faster than the 150 ms debounce, so without the throttle the problem is invisible.
- **Glyphs** — rendered next to a character outside the font (U+E000), to tell "there is no
  glyph" from "there is a glyph, it just means something else".

Three hypotheses stated before measuring **fell** — they are below, in their own section.

---

## What was broken and got fixed

### 1. A form field was distinguishable from the card by nothing

The contrasts measured with the palette from before the audit:

| pair | ratio | threshold | |
|---|---|---|---|
| `--border #35353b` against `--panel` (a field's and a card's border) | **1.48:1** | 3:1 (SC 1.4.11) | ✗ |
| `--surface-2` against `--panel` (a field's fill) | **1.09:1** | — | ✗ |
| `--panel` against `--bg` (a card against the background) | **1.05:1** | — | ✗ |

In other words: a field was distinguishable from the card neither by its border nor by its
fill, and a card from the background practically not at all — the entire division into
surfaces rested on a border with 1.48:1 contrast. The text, meanwhile, was fine (16.09:1 and
6.87:1), so audit #3 checking `--muted` could see nothing here: **the problem was not the text
but the borders**.

The fix: a separate `--border-strong: #6a6a73` variable for the borders of controls and cards —
**3.37:1** against a card, **3.10:1** against a fill, **3.55:1** against the page background.
`--border` stays for dividers in the table and above a section heading, where the 3:1 threshold
does not apply because they are decoration.

While we were at it: `#f2f2ef`, `#c98500` and `#e66767` were written out literally in five
places next to existing variables. `--warn`, `--danger` and `--ok` were added.

### 2. The controls did not inherit the font

`input, select` set neither `font-family` nor `font-size`, and those properties are not
inherited. Measured on `#worldSelect` — the main switch of the whole view:

```
before:  font-family: sans-serif        font-size: 13.3333px
after:   font-family: ui-sans-serif…    font-size: 14px
```

All four lists and five number fields were rendered in the system typeface at a size smaller
than anything else on the page.

### 3. No `color-scheme: dark`

Without that declaration the browser draws the native parts of controls in a light skin:
dropdown arrows, `input[type=number]` buttons, autofill and scrollbars. It is visible in the
screenshot from before the change — the number fields in the filter drawer have light grey
arrow boxes on a dark background. One line in `:root`.

### 4. Focus was lost in two places — and that is the only navigation without a mouse

**Escape in the filter drawer.** `setFieldsOpen(false)` hid the drawer with `display: none`
while focus was inside it. The browser then drops focus onto `<body>`, so the next Tab started
from the top of the document. Measured after the fix: focus returns to `#filtersToggle`, and
`aria-expanded` goes to `"false"`.

**A chip's close button.** `renderChips` replaces `innerHTML` on **every** render, so pressing
`×` destroyed the element that held focus. The result: **two filters could not be removed in a
row from the keyboard** — after the first, focus landed on `<body>`. After the fix it moves to
the next chip; the measured sequence is `level → honor → prof`, with `body` never in it.

The DOM stub cannot check this — it has no tree and no `activeElement`, and `querySelectorAll`
ignores its selector and returns only `input`s. Growing the stub into a real tree is more work
than this whole round, so **both behaviours are verified in a browser**, not by a test. That is
a deliberate gap, not an oversight.

### 5. The chips disappeared entirely in the 721-1100 px band

The most interesting finding, because it is invisible from the code and untrue on a typical
desktop. Measured at **800 px**:

```
before:  .chips  clientWidth 0    scrollWidth 421   (three chips, zero pixels)
after:   .chips  clientWidth 188  scrollWidth 420   (scrollable, all reachable)
```

`.chips` has `flex: 1 1 auto; min-width: 0`, and the rest of the bar (`select`, the counter,
the anchors, two buttons) took up exactly the full width — so flexbox squeezed the chips to
zero, and `overflow: hidden` made it silent. Between 721 and ~1100 px the user could see
neither which filters were active nor the close buttons to remove them. Below 720 px the chips
are deliberately `display: none`, above ~1100 they fit — the hole was exactly in the middle.

The fix came in two parts: `overflow-x: auto` instead of `hidden` (a focused chip scrolls
itself into view, so the tab key works), plus a new 1100 px threshold below which the anchors
and the "w tej migawce" qualifier give way — both are conveniences, while the chips carry the
filter state. The document height is unchanged (2561 px), so this cost the layout nothing.

A `title` was added on each chip too, because while scrolling you sometimes see half a label.

### 6. A chip's close button was below the WCAG 2.2 minimum

Measured at **21×15 px** against the 24×24 threshold of SC 2.5.8. After the change: **24×24**,
with no change to the bar's height (56 px) — the extra size went into the button itself, not
into the chip.

### 7. The horizontally scrolling table was unreachable from the keyboard

At 375 px, measured: `clientWidth 333`, `scrollWidth 526` — **193 px of content past the edge**,
including the "Zmiana" and "Na dobę" columns. `.tableBox` has `overflow-x: auto`, but a
container with no `tabindex` does not accept focus, so it could not be scrolled from the
keyboard (WCAG 2.1.1). `tabindex="0"` + `role="region"` + `aria-label` were added.

### 8. Error states left contradictory information on screen

- The `catch` in `init()` did not reset `#summary` → the line "Ładowanie…" stayed **forever**
  next to a red error message.
- The `catch` in `loadSnapshot` did not reset `#matchLine` → the bar showed numbers from the
  **previous** snapshot next to a message saying this one could not be fetched.
- The message's content was the raw exception: `Failed to fetch`, `Unexpected token '<'`,
  `HTTP 500 for worlds/gordion/2026-…f.json` — in English, with a file path, and no hint about
  what to do.

`describeFailure` was added; it tells a lost connection, an HTTP code and broken JSON apart.
The file path does not disappear from the view — it stands where it stood, in the "Plik" field.

### 9. The copy-link button — removed

The audit found three faults in it at once: `await navigator.clipboard.writeText(…)` with no
`try/catch` (outside a secure context, or when permission is refused, the button simply did not
respond and the exception went to the console), an `aria-label` covering the swapped-in "✓" —
i.e. no confirmation for a screen reader — and a `setTimeout` with no `clearTimeout`.

Rather than fixing them, the button **left the bar**. The whole view state sits in the address
anyway (`filtersToParams` + `viewToParams`, written on every render), so the button duplicated
what the browser does better: Ctrl+L, Ctrl+C. The full set of problems went with it — copying
that cannot break is copying that does not exist. The bar gained ~40 px in the process, which is
exactly the room the chips lacked in the 721-1100 px band.

The hypothesis about the `⎘` glyph fell along the way — see the section on disproved hypotheses.
The finding stays in the note, because it concerns any future icon button, not this one.

### 10. Zero matches looked like broken data

With an empty result, `#stats` printed `Wojownik: 0 · Mag: 0 · …` and
`< 24h: 0 · 1-7 dni: 0 · …` — eleven zeros. It is the same class of problem
`visibleActivityBuckets` solves for the buckets. Now there is one sentence. On top of that,
`#chartEmpty` got a reset button: the only existing "Resetuj filtry" sits in a **closed**
drawer, so getting out of an empty result required guessing where it was.

Incidentally, visible only in the screenshot: a profession **unchecked in the filter** also got
a "0" badge. `profChart` draws only the chosen series; `#stats` showed all six.

### 11. Two numeric conventions side by side

The histogram tooltip had `12.3%` and `1234`, while 40 px away the bar had `12,3%` and `1 234`.
In the `#stats` card — `10403` right under `38 909`. The test holds the format **for the table
only** (`out.table` has to match `/\d,\d/`), so the tooltip and the statistics slipped through.
Everything moved to `num()`/`dec()`.

### 12. The view's address lost its anchor and was rewritten needlessly

`writeUrlState` built the URL as `pathname + "?" + params` — with no `location.hash`. A click on
"Historia", then any filter change, and the anchor vanished from the address, so a reload
returned to the top of the page.

Separately: `replaceState` ran on **every** render, including once per history file fetched.
Safari cuts in after ~100 calls per 30 s, and an uncaught `SecurityError` would have taken down
`render()` halfway — before `renderChips` and `renderCrossSection`. The write now happens only
when the address has actually changed.

The DOM stub gained `location.hash` and a `replaceState` that really updates `location.search`.
Without that, both sides of the comparison would be `undefined` — a green test for code that
appends the string "undefined" to the address. That is exactly the trap audit #3 describes: a
stub gentler than a browser produces green tests for broken code.

### 13. Semantic gaps and small things

- No `<main>` and no skip link — all the content hung in an anonymous `<div class="wrap">`,
  behind the filter bar. With a 2561 px document that means a screen reader and the keyboard
  walked through every control before reaching the data.
- `<label>Plik</label>` and `<label>Profesja</label>` had no `for` and wrapped nothing — they
  labelled a `<div>`, i.e. nothing. They became `<span class="field-title">`.
- The six profession checkboxes were not a group: `role="group"` + `aria-labelledby`.
- Chart.js loaded without `defer`, blocking the parser ahead of the whole `<body>`.
- No `<noscript>` on a view rendered 100% from JS.
- No `theme-color`, and no style for `<code>` (used in the note about `suspect`).
- `scroll-margin-top: 76px` and `max-height: calc(100vh - 90px)` were computed for a 56 px bar,
  while on a phone the bar is 88 px — an anchor landed under the bar and the drawer could extend
  below the screen. Values for the 720 px breakpoint were added, and `vh` became `dvh`, because a
  phone's address bar does not fit inside `100vh`.
- The default `button` variant (white on the accent) measured **3.64:1**, below AA — and had not
  one user, because every button is either `.ghost-btn` or `.reset-btn`. Removed; the default
  button now looks like `.ghost-btn`, so the next one added does not silently fall back to a
  variant that fails contrast.
- The 150 ms debounce also covered `change` on the lists (`#thresholdSelect`, `#modeSelect`,
  `#onlinePreset`) and clicking "Resetuj filtry". The debounce exists for typing into a field;
  for picking from a list it was nothing but latency. `renderNow()` was added.

---

## Hypotheses that fell on contact with measurement

**"The `⎘` glyph renders as an empty box."** It does not. Rendered next to U+E000 (a character
certainly absent from any font) the difference is visible: U+E000 is a box with a hexadecimal
code, while U+2398 is **a real glyph**. The problem was a different and worse one, because it
does not catch the eye: U+2398 NEXT PAGE depicts **a page with an arrow, i.e. turning a page**,
not copying. The button itself disappeared in the end (point 9), but two findings from that
measurement stay for the future: "the glyph draws" does not mean "the glyph means the right
thing", and **emoji** code points (🗐, 🔗) are out of this interface for a different reason —
the browser draws them with a colour font, so they ignore the accent colour. The monochrome
equivalent of copying is U+29C9 "⧉".

**"Between the HISTORIA heading and the first chart stand up to five cards of notes."** Not in
the default state. Measured: **73 px** at 1440 px (one note, `#onlineNote`) and **171 px** at
375 px, where the same note wraps onto several lines. Five notes at once is possible, but it is
not a state anybody is usually in.

**"After the first character typed into a filter, the history charts collapse for several
seconds."** On localhost **it cannot be seen** — aether's full set of 10 snapshots arrives
faster than the 150 ms debounce. Only with a 900 ms throttle per file does what happens on a
real connection become visible:

```
   0 ms   10 points   (the trends.json aggregate)
 250 ms    1 point    ⏳ "Historia dopełnia się w tle" (1 of 10)
1500 ms    5 points   (concurrency 4)
2250 ms    9 points
3000 ms   10 points
```

So the collapse **is real** — for ~1.3 s the chart has one point instead of ten — but the
hypothesis "several seconds of emptiness with no explanation" was false: the state is described
by a note from the first frame and rebuilds in steps. Left as debt (D2 below), because the
alternative breaks the rule "we substitute nothing invented for missing points".

---

## Geometry — the numbers before and after

Measured in Firefox, a frame of a given width, the default filter unless stated otherwise.

| | 1440 px | 800 px | 375 px |
|---|---|---|---|
| document height | 2561 px | 2606 px | 2628 px |
| filter bar height | 56 px | 56 px | 88 px |
| from the filter to the 1st history chart | **973 px** | 1018 px | **1268 px** |
| notes before the 1st history chart | 73 px | 93 px | 171 px |
| table: content / container | 1350 / 1350 | 738 / 738 | **526 / 333** |
| chips: visible / needed (3 filters) | 575 / 575 | **188 / 420** (was 0 / 421) | hidden |
| a chip's close button | 24×24 (was 21×15) | 24×24 | — |

973 px against a 900 px screen confirms the filter-bar spec's premise: **the filter and the
first chart the filter acts on are never visible at once.** On a phone it is 1268 px against an
812 px screen, i.e. 1.56 screens.

Hiding `#actChartBox` under the "< 24h" threshold moves everything below it by a measured
**359 px** (the document height goes 2561 → 2202). Left as debt.

---

## Debt — deliberately outside this round

| # | Thing | Why not now |
|---|---|---|
| D1 | **The bar says nothing about transfer.** Typing one digit starts up to 8.7 MB raw / ~1.8 MB gzip for gordion. The progress stands in `#historyStatus` ~1000 px lower and counts snapshots, not bytes. There is no cancelling — `AbortController` does not appear in `public/` even once; resetting the filters zeroes the counter, but the files run to completion. | The bar has a fixed height and `nowrap`, and it has just run out of room for the chips. Adding an indicator is a decision about what leaves the bar — a spec, not a patch. |
| D2 | **The history collapses to one point for ~1.3 s** after the first character (measured above). | The only alternative is drawing the aggregate underneath, which breaks the rule "we substitute nothing invented". Needs a spec. |
| D3 | **The back button does not work** — only `replaceState`, no `pushState`, no `popstate`. Debt open since audit #3. | A change in navigation behaviour with its own set of tests. |
| D4 | **On a phone it is still invisible which filters are active** — the chips are `display: none` below 720 px, leaving the "Filtry (N)" counter. | The fix costs bar height, which the spec capped at 13.2% of a 667 px screen. |
| D5 | The activity preset drifts from the number field: typing `5` leaves the list on "7 dni". | Debt from audit #3, still open. |
| D6 | Hiding `#actChartBox` moves the page by **359 px**. | Needs a decision: reserve the space, or move the threshold elsewhere. |
| D7 | The world cache is **FIFO, not LRU** — `cache.delete(cache.keys().next().value)` removes the earliest inserted, so the sequence A→B→A→C evicts the very A being viewed and going back costs 8.7 MB a second time. | A one-line fix, but pointless without a test — and the test needs a four-world scenario. |
| D8 | The histogram tooltip works only on `mousemove` — **on a phone the profession chart reveals no numbers at all**. | Needs a decision about a touch pattern, not just code. |
| D9 | All the informational text is 12-13 px; `label` is globally 12 px in `--muted`. | Raising the scale changes the density of the whole page, including the bar's fixed height. |
| D10 | The charts have no text alternative — `aria-label` describes the chart type, not the data. The table covers population only. | A separate topic: what "an accessible version of the level distribution chart" means. |
| D11 | `minLevel > maxLevel` gives "Brak graczy spełniających filtry" instead of "the range is inverted"; text in a `type=number` field silently clears the filter; `?prof=99` silently substitutes all six. | Three different kinds of silent degradation, each with its own decision about what to show. |
| D12 | `profChart` does not mark `suspect` snapshots, though the other two do. `404.html:26` has `href="/"`, which on project Pages leads out of the project. | Two small things from audit #3, still open. |

Deliberately untouched because rejected in `2026-08-04-spec-filter-bar.md:246-251`: a left
sidebar, an "Apply" button, saved filter sets, navigation broader than two anchors, any change
to the charts' heights.

---

## What this audit did not check

- **A real screen reader.** The attributes and the focus order are checked, not what NVDA or
  VoiceOver actually says.
- **Other browsers.** Everything was measured in Firefox 140. `dvh`, `color-scheme` and
  `scrollbar-width` have good support, but were not confirmed in Safari — and Safari is exactly
  where the `replaceState` limit lives that one of the fixes guards against.
- **A real touch device.** The target sizes are measured; hit accuracy is not.
- **Render performance.** `render()` rebuilds five to eight blocks through `innerHTML` every
  150 ms while typing, and `buildFilteredTrend` recomputes the whole history from scratch on
  every render. Not measured, not reported as a problem — only noted.

---

## Verification

- `bun test` — 184 tests green (`dom_smoke.ts` changed in two places: `location.hash` and a
  `replaceState` that really updates `location.search`, plus the chip regex letting a `title`
  attribute through).
- `bun run typecheck` — clean.
- The contrast script after the palette change: **14 pairs, all passing** — text ≥ 4.5:1, the
  borders of controls ≥ 3:1.
- In a browser: Escape hands focus back to the "Filtry" button, two chips can be removed in a
  row from the keyboard, the table accepts focus, a field has `ui-sans-serif` at 14 px and a
  `rgb(106,106,115)` border, `color-scheme` = `dark`, and an empty result shows a sentence and a
  working reset button.
