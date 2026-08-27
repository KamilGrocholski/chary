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
 * JavaScript has no `abstract`, so the constructor refuses to be the one you instantiate.
 *
 * Deliberately disjoint from `MargoStatToolError`: a `catch` in the dashboard must not
 * swallow a scraper error believing it caught its own. The two never run in one process.
 */

import { assert } from "./assert.js";

/**
 * Every failure the dashboard can raise. One entry per subclass.
 *
 * @typedef {"MissingElement" | "ResourceFetch" | "ResourceParse"} MargoStatErrorCode
 */

export class MargoStatError extends Error {
  /**
   * @param {MargoStatErrorCode} code
   * @param {string} message English, always — a sentence a player reads is composed by the
   *   view from the code, never taken from here. See §9.8.
   * @param {ErrorOptions} [options]
   */
  constructor(code, message, options) {
    assert(new.target !== MargoStatError, "MargoStatError is thrown through a named subclass");
    super(message, options);
    /** @type {MargoStatErrorCode} */
    this.code = code;
    this.name = `MargoStat/${code}`;
  }
}
