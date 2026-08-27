/**
 * `Date.parse` without the `NaN`.
 *
 * `Date.parse("nope")` is `NaN`, and `NaN` compares `false` against everything — so a
 * timestamp nobody could read sorts as neither earlier nor later, and a chart puts it
 * nowhere while reporting no failure. It is the same shape as the `−1 > maxDays` trap in
 * `shared.ts`, which once let every account nobody had used into every activity threshold.
 *
 * Time in this repository has exactly one trustworthy source, `startedAt`. A snapshot's
 * id is not a date — see §9.2 — so nothing here parses one.
 */

/** Milliseconds since the epoch, or `null` where the text is not a date. */
export function getMillisecondsFromIsoText(text: string | null | undefined): number | null {
  if (typeof text !== "string" || text === "") return null;
  const milliseconds = Date.parse(text);
  return Number.isNaN(milliseconds) ? null : milliseconds;
}

/** The same reading as a `Date`, for the callers that format one. */
export function getDateFromIsoText(text: string | null | undefined): Date | null {
  const milliseconds = getMillisecondsFromIsoText(text);
  return milliseconds === null ? null : new Date(milliseconds);
}
