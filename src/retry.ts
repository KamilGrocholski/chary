// The retry policy — pure functions, so they can be tested.
//
// `world-scraper.ts` runs the CLI and the whole scrape at the top level of the module, so
// importing it from a test would start a round. What has to be checked without a network
// lives here: an untested backoff is exactly how `Retry-After: 0` spent months wiping out
// the pause between attempts.

import { getIntegerFromText } from "@/src/lib/number.ts";
import { getMillisecondsFromIsoText } from "@/src/lib/timestamp.ts";

export const MAX_PAGE_RETRIES = 3;
export const BACKOFF_BASE_MS = 5_000;
export const MAX_BACKOFF_MS = 120_000;

/** `Retry-After` in milliseconds — the header is either a number of seconds or an HTTP date. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (header === null) return undefined;

  // RFC 9110 spells the first form as delay-seconds: digits, and nothing else. `Number`
  // would also have taken " 5 ", "0x10" and "1e3" — three spellings the header does not
  // have, each of which becomes a pause nobody was asked for.
  const seconds = getIntegerFromText(header.trim());
  if (seconds !== null) return seconds >= 0 ? seconds * 1000 : undefined;

  const retryAtMs = getMillisecondsFromIsoText(header);
  return retryAtMs === null ? undefined : Math.max(0, retryAtMs - now);
}

/**
 * How long to wait before the next attempt. `suggested` is `Retry-After` from the response.
 *
 * The server's hint may **extend** the pause, but it never shortens it below our own
 * exponential floor. `suggested ?? …` used to let `Retry-After: 0` through — because
 * `0 ?? x` is `0`, not `x` — and four requests went out back to back with no pause at all,
 * straight against "respect the service".
 */
export function getBackoffMs(attempt: number, suggested?: number): number {
  const ownDelayMs = BACKOFF_BASE_MS * 2 ** (attempt - 1);
  return Math.min(Math.max(suggested ?? 0, ownDelayMs), MAX_BACKOFF_MS);
}
