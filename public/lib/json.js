/**
 * JSON both ways.
 *
 * `JSON.parse` has two habits that make it unusable raw. It throws, so every caller grows
 * its own `try`/`catch` and they drift — one of them ends up swallowing a programming
 * error of ours along with the malformed file it was written for. And it hands back `any`,
 * so `JSON.parse(text)` wearing a type is external data nobody checked: that is how a
 * snapshot truncated by a Ctrl-C became a `FilterFile` with `undefined` columns and took
 * down the rebuild meant to repair it.
 *
 * So reading answers with the value **or** with the `SyntaxError`, and never a bare
 * `null` — a file holding the four characters `null` is a legitimate document, and it must
 * not read the same as a file that is not JSON at all.
 */

/**
 * @typedef {{ ok: true, value: unknown } | { ok: false, error: SyntaxError }} JsonReading
 */

/**
 * @param {string} text
 * @returns {JsonReading}
 */
export function getValueFromJsonText(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    // The one broad catch this module is allowed: `JSON.parse` throws exactly one kind of
    // thing for malformed input, and anything else here would be a fault of the engine's.
    return { ok: false, error: error instanceof SyntaxError ? error : new SyntaxError(String(error)) };
  }
}

/**
 * Refuses a value JSON cannot carry, rather than writing `undefined` and calling it a file.
 *
 * `JSON.stringify` answers `undefined` — not a string — for a function, a symbol or a bare
 * `undefined`, and every write in this repository goes to a file that cannot be fetched
 * again, so the caller is told rather than left holding it.
 *
 * @param {unknown} value
 * @param {number} [indent]
 * @returns {string | null}
 */
export function composeJsonText(value, indent) {
  const text = JSON.stringify(value, null, indent);
  return typeof text === "string" ? text : null;
}
