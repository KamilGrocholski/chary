/**
 * Every number this repository reads or writes passes through here.
 *
 * `Number(text)`, `parseInt` and `parseFloat` are conversions, not parsers, and each has a
 * way of producing a number nobody wrote:
 *
 *   Number("")        === 0          an empty cell becomes a measurement
 *   Number(" 5 ")     === 5          whitespace is discarded
 *   Number("0x10")    === 16         a different base is accepted silently
 *   Number("1e3")     === 1000       so is scientific notation
 *   parseInt("12abc") === 12         the tail is dropped
 *
 * The first is the expensive one here. `0` is a perfectly good reading of honor and of
 * `days` — "online today" — so a cell that arrived empty becomes indistinguishable from
 * one that arrived as zero, and the difference is written into a file that cannot be
 * fetched again.
 *
 * Reading and writing are not symmetrical, and that decides the shape of everything below:
 *
 *   - **Reading** takes something somebody else produced, so it returns `null` and throws
 *     nothing. What that means depends on where the text came from, and only the caller
 *     knows: an invariant of ours gets an assertion, a ranking cell becomes a rejected row
 *     with a reason, a URL parameter in the dashboard becomes an ignored filter.
 *   - **Writing** takes a number that is already ours, so a value that cannot be written
 *     is a broken invariant rather than a failure anyone can handle. It asserts, and the
 *     caller gets a `string` instead of a `null` to thread through.
 */

import { assert } from "@/src/lib/assert.ts";

const INTEGER_TEXT = /^-?\d+$/;
const FINITE_TEXT = /^-?\d+(\.\d+)?$/;

/**
 * Null unless the text is a plain decimal integer that survives the round trip.
 *
 * Beyond 2^53 the digits stop mapping one-to-one onto values, so a longer number would
 * come back as a neighbour of itself. A `charId` is nowhere near that today; the ranking
 * is not ours to make promises about.
 */
export function getIntegerFromText(text: string): number | null {
  if (!INTEGER_TEXT.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Null unless the text is digits, optionally a point and digits. No exponent, no bare
 * `.5`, no hexadecimal — a share read half-way is a share nobody measured.
 */
export function getFiniteNumberFromText(text: string): number | null {
  if (!FINITE_TEXT.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * The same reading, of a value that arrived from `JSON.parse` rather than from text.
 *
 * A number is taken as it is; a string is put through the reader above, because an older
 * snapshot schema stored some of these as text and the migration must not care which.
 * Everything else — `null`, `undefined`, an object, a boolean — is `null`, which is the
 * whole point: `Number(undefined)` is `NaN`, and `NaN` reaches a written file as `null`
 * after `JSON.stringify`, so a value nobody wrote becomes a gap nobody notices.
 */
export function getIntegerFromValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (typeof value === "string") return getIntegerFromText(value.trim());
  return null;
}

export function getFiniteNumberFromValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return getFiniteNumberFromText(value.trim());
  return null;
}

/** A number of ours as text. Asserts, because by this point we counted it. */
export function composeIntegerText(value: number): string {
  assert(Number.isSafeInteger(value), "a number written as an integer is a safe integer");
  return String(value);
}
