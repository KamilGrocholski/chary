/**
 * Base for every error the dashboard throws.
 *
 * The dashboard runs in a player's browser and writes into a console it does not own, so
 * the brand goes in `name`, where a console shows it first. An error that does not say
 * whose it is costs the person reporting it and costs us reading the report.
 *
 * Abstract on purpose: every kind of failure gets its own named subclass with a `code`, so
 * a caller tells them apart without matching on message text — and message text here is
 * the one thing that legitimately changes, because some of it is composed for a player.
 * The constructor refuses to be the one you instantiate.
 *
 * Deliberately disjoint from `MargoStatToolError`: a `catch` in the dashboard must not
 * swallow a scraper error believing it caught its own. The two never run in one process.
 */

import { assert } from "@/src/lib/assert.ts";

/** Every failure the dashboard can raise. One entry per subclass. */
export type MargoStatErrorCode = "MissingElement" | "ResourceFetch" | "ResourceParse";

export class MargoStatError extends Error {
  readonly code: MargoStatErrorCode;

  /**
   * @param message English, always — a sentence a player reads is composed by the view
   *   from the code, never taken from here. See §9.8.
   */
  constructor(code: MargoStatErrorCode, message: string, options?: ErrorOptions) {
    assert(new.target !== MargoStatError, "MargoStatError is thrown through a named subclass");
    super(message, options);
    this.code = code;
    this.name = `MargoStat/${code}`;
  }
}
