/**
 * Base for everything the scraper and the tools throw.
 *
 * These run in a terminal in front of a person, so throwing loudly is the correct
 * behaviour — the opposite of the dashboard, where a thrown error blanks the page and an
 * expected failure has to become something drawable instead (§9.5).
 *
 * Abstract on purpose: every kind of failure gets a named subclass and a `code`, so the
 * scraper's round summary can group failures without matching on message text. It
 * replaces three private classes that each carried a `readonly type` field of their own —
 * three hierarchies of one, none of which a caller could catch by base.
 *
 * Deliberately disjoint from `MargoStatError`, which is the dashboard's. Nothing imports
 * both, and that is the point.
 */

/** Every failure the terminal side can raise. One entry per subclass. */
export type MargoStatToolErrorCode =
  | "LadderMarkup"
  | "LadderHttp"
  | "LadderFetch"
  | "SnapshotWrite"
  | "SnapshotRead";

export abstract class MargoStatToolError extends Error {
  readonly code: MargoStatToolErrorCode;

  protected constructor(code: MargoStatToolErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.name = `MargoStatTool/${code}`;
  }
}
