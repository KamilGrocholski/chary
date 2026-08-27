/**
 * Fetching one of the documents this repository publishes, or refusing.
 *
 * Four places did the same three steps — `fetch`, `if (!res.ok) throw`, `res.json()` — and
 * each threw a bare `Error` whose message was the only thing carrying what went wrong. The
 * view then read that message back with a regular expression to decide what to tell the
 * player, so a reworded message would have silently changed which sentence appeared
 * (§9.5). Here the outcome is a code, and the sentence is composed from the code.
 *
 * Same-origin only, by construction: every URL passed in is a path this repository
 * publishes. The dashboard fetches nothing else (§5).
 */

import { MargoStatError } from "@/web/margostat-error.ts";
import { getValueFromJsonText } from "@/src/lib/json.ts";

/** The server answered, and the answer was not the document. */
export class ResourceFetchError extends MargoStatError {
  readonly url: string;
  /** The HTTP status, so the view never parses one out of a message. */
  readonly status: number;

  constructor(url: string, status: number, options?: ErrorOptions) {
    super("ResourceFetch", `HTTP ${status} — ${url}`, options);
    this.url = url;
    this.status = status;
  }
}

/** The document arrived and was not JSON — a truncated file, or a 404 page in its place. */
export class ResourceParseError extends MargoStatError {
  readonly url: string;

  constructor(url: string, options?: ErrorOptions) {
    super("ResourceParse", `not JSON — ${url}`, options);
    this.url = url;
  }
}

/**
 * The document at `url`, parsed.
 *
 * Throws rather than answering `null`: every caller here is already inside a `try` that
 * turns a failure into something the view draws, and the two failures have to stay
 * distinguishable — a 404 and a truncated file are different sentences for a player.
 *
 * The body is read as text and put through our own JSON reader rather than through
 * `res.json()`, so a parse failure arrives as a `ResourceParseError` naming the URL
 * instead of as a bare `SyntaxError` naming a character offset.
 */
export async function getJsonFromUrl(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new ResourceFetchError(url, response.status);

  const reading = getValueFromJsonText(await response.text());
  if (!reading.ok) throw new ResourceParseError(url, { cause: reading.error });
  return reading.value;
}
