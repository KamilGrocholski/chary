// Numbers and failures, as a Polish-speaking reader sees them. No DOM, no state.
//
// The strings here are Polish because a player reads them — see "Language" in AGENTS.md.

import { POLISH_LOCALE } from "@/src/shared.ts";
import { BYTES_IN_KILOBYTE, BYTES_IN_MEGABYTE } from "@/src/lib/byte-size.ts";
import { MargoStatError } from "@/web/margostat-error.ts";
import { ResourceFetchError } from "@/web/fetch-json.ts";

export const formatNumber = (value: number) => value.toLocaleString(POLISH_LOCALE);

// Fractions in Polish too — "−5,3%" next to "23 719" rather than "−5.3%", two
// conventions at once.
export const formatDecimal = (value: number, digits = 1) =>
  value.toLocaleString(POLISH_LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const formatSigned = (value: number, format = formatNumber) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${format(Math.abs(value))}`;

// A transfer, as the person paying for it reads it. Under a megabyte in whole kilobytes:
// "0,4 MB" says less than "360 KB" to somebody deciding whether to press the button.
export const formatBytes = (value: number) =>
  value >= BYTES_IN_MEGABYTE
    ? `${formatDecimal(value / BYTES_IN_MEGABYTE)} MB`
    : `${formatNumber(Math.round(value / BYTES_IN_KILOBYTE))} KB`;

/**
 * What to tell the player about a failure.
 *
 * The error bar used to carry the raw exception text — "Failed to fetch", or "HTTP 500 for
 * worlds/gordion/2026-…f.json" — i.e. a message in English, with a file path and no hint
 * about what to do. The path does not disappear from the view: it stands in the "Plik"
 * field in the filter drawer.
 *
 * Switches on the failure's `code`, never on its message. It used to match the message with
 * a regular expression, which made every one of those English sentences load-bearing —
 * rewording `HTTP 404 — …` would have quietly changed which Polish sentence appeared, with
 * every test still green (§9.5).
 *
 * @param subject what could not be fetched, in Polish, for the sentence
 */
export function describeFailure(error: unknown, subject: string): string {
  if (error instanceof ResourceFetchError) {
    return `Nie udało się pobrać ${subject}: serwer odpowiedział kodem ${error.status}.`;
  }
  if (error instanceof MargoStatError) {
    if (error.code === "ResourceParse") {
      return `Nie udało się odczytać ${subject}: plik nie jest poprawnym JSON-em.`;
    }
  }
  return `Nie udało się pobrać ${subject} — wygląda na brak połączenia. Odśwież stronę i spróbuj ponownie.`;
}
