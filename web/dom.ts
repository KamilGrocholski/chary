// The document, and the only place the view looks anything up in it.
//
// Everything here answers a node or a colour and decides nothing. It is separate from the
// renderers so that "which ids does the view expect the markup to hold?" is a question
// `dashboard.test.ts` can answer by reading calls, rather than one the browser answers by
// throwing.

import { assert } from "@/src/lib/assert.ts";
import { MargoStatError } from "@/web/margostat-error.ts";

/**
 * A node this view expects `index.html` to hold.
 *
 * Its own class rather than a bare `Error` because it is the one failure here that is
 * ours: the markup and the view ship together, so a missing id means they went out of
 * step, and the code says that at a glance in a console shared with nothing.
 */
export class MissingElementError extends MargoStatError {
  readonly elementId: string;

  constructor(id: string) {
    super("MissingElement", `index.html has no element #${id}`);
    this.elementId = id;
  }
}

/** A node `index.html` is expected to hold. */
export function getElement(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new MissingElementError(id);
  return node;
}

/**
 * A form control the view reads or writes.
 *
 * Its own lookup because `HTMLElement` has no `.value`, and asking a `<div>` for one is a
 * bug nothing could see while every node came back as the same type. Which ids are really
 * `<input>`s and `<select>`s is held statically: `dashboard.test.ts` reads the ids passed
 * to `getField()` out of `web/` and checks each against the markup, so the pairing is
 * proved where it is written rather than asserted where it is used.
 */
export function getField(id: string): HTMLInputElement | HTMLSelectElement {
  return getElement(id) as HTMLInputElement | HTMLSelectElement;
}

/** The checkable inputs inside a container — the profession checkboxes. */
export function getCheckboxes(id: string, selector: string = "input"): HTMLInputElement[] {
  return [...getElement(id).querySelectorAll(selector)] as HTMLInputElement[];
}

/** The colours Chart.js is handed. Every one of them is a `:root` token, read once. */
export type ThemeTokens = ReturnType<typeof getThemeTokens>;

/**
 * The theme, read from `:root` in `index.html`.
 *
 * It used to be spelled twice: 13 tokens in the stylesheet and 24 copies of eight of their
 * values in the view, as `"#a0a09a"` and `"rgba(255, 255, 255, 0.06)"`. Changing `--muted`
 * repainted the page and left every chart, tooltip and legend on the old grey, and nothing
 * said so — the same fault §9.7 already forbids inside CSS, one file to the left.
 *
 * A missing token is an assertion, not a fallback: the stylesheet and this module ship in
 * the same commit, so a name that no longer resolves is our bug and not something a visitor
 * can be shown a substitute for. A colour nobody wrote is exactly §9.5's "value nobody
 * wrote" — an empty string here paints a chart in the browser's default black on black.
 *
 * Inline styles in the markup the view writes do NOT come through here: `var(--muted)` in a
 * `style="..."` resolves in the browser, so the token stays a token all the way down. This
 * object exists for Chart.js, which takes concrete colours and nothing else.
 */
export function getThemeTokens() {
  const style = getComputedStyle(document.documentElement);
  const requireToken = (name: string) => {
    const value = style.getPropertyValue(name).trim();
    assert(value !== "", `index.html defines the token ${name}`);
    return value;
  };
  return {
    text: requireToken("--text"),
    muted: requireToken("--muted"),
    accent: requireToken("--accent"),
    warn: requireToken("--warn"),
    ok: requireToken("--ok"),
    grid: requireToken("--grid"),
    gridSoft: requireToken("--grid-soft"),
  };
}
