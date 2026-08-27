import * as cheerio from "cheerio";
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { WORLDS as DEFAULT_WORLDS } from "@/src/worlds.ts";
import { LadderMarkupError, parseTable, parseTotalPages, type PlayerRow } from "@/src/parser.ts";
import { MargoStatToolError } from "@/src/margostat-tool-error.ts";
import { readScraperCommand } from "@/src/scraper-cli.ts";
import {
  checkPopulationDrop,
  composeFilterPath,
  getLatestSnapshotCount,
  composeNamesPath,
  splitSnapshot,
  type PopulationDrop,
} from "@/src/snapshot.ts";
import { WORLDS_DIR, rebuildManifest } from "@/src/manifest.ts";
import { rebuildTrends } from "@/src/trends.ts";
import { writeAtomic } from "@/src/atomic.ts";
import { MAX_PAGE_RETRIES, getBackoffMs, parseRetryAfter } from "@/src/retry.ts";
import { removePageOverlap } from "@/src/page-overlap.ts";

// ── Error types ───────────────────────────────────────────────────────────────
//
// Each carries a `code` from the one hierarchy, so the round summary groups failures
// without matching on message text. They used to carry a `readonly type` field apiece —
// three hierarchies of one, none of which a caller could catch by base (§9.5).

/** The ranking answered, and the answer was not a page. */
class LadderHttpError extends MargoStatToolError {
  constructor(readonly status: number, readonly url: string, readonly retryAfterMs?: number) {
    super("LadderHttp", `HTTP ${status} — ${url}`);
  }
}

/** The request never became an answer: a timeout, a reset, a redirect that lost the page. */
class LadderFetchError extends MargoStatToolError {
  constructor(message: string, readonly url: string, options?: ErrorOptions) {
    super("LadderFetch", `${message} — ${url}`, options);
  }
}

/** The round had the data and could not write it. The one failure that loses a scrape. */
class SnapshotWriteError extends MargoStatToolError {
  constructor(message: string, options?: ErrorOptions) {
    super("SnapshotWrite", message, options);
  }
}

/** What one world's round produced, beyond the snapshot it wrote. */
type WorldRoundResult = {
  suspect: PopulationDrop | null;
  overlapRows: number;
  shiftedBoundaries: number;
};

// ── Logging ───────────────────────────────────────────────────────────────────

const LOG_DIR = "logs";
const LOG_FILE = path.join(LOG_DIR, "scraper.log");

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

const LOG_LEVEL_ENV = (process.env.LOG_LEVEL ?? "WARN").toUpperCase() as LogLevel;
const MIN_LEVEL = LOG_LEVELS[LOG_LEVEL_ENV] ?? LOG_LEVELS.WARN;

function formatLogLine(level: LogLevel, message: string, extra?: object) {
  const base = `[${new Date().toISOString()}] [${level}] ${message}`;
  return extra ? `${base} ${JSON.stringify(extra)}` : base;
}

async function log(level: LogLevel, message: string, extra?: object) {
  if (LOG_LEVELS[level] < MIN_LEVEL) return;
  const line = formatLogLine(level, message, extra) + "\n";
  process.stdout.write(line);
  try {
    await mkdir(LOG_DIR, { recursive: true });
    await appendFile(LOG_FILE, line);
  } catch {
    // best-effort
  }
}

function logError(thrown: unknown, context?: object) {
  // Nothing is constructed here. Wrapping a non-Error in `new Error` to get a `.stack`
  // would put an unbranded failure of our own making into the log, next to the real one —
  // and §9.5 has no place for an error that describes nothing (there is nothing to handle).
  // What a thrown non-Error can say is what it stringifies to, and that is what it says.
  const error = thrown instanceof Error ? thrown : null;
  return log("ERROR", error?.message ?? String(thrown), {
    // A failure of ours carries its code; anything else is somebody else's and says so.
    code: error instanceof MargoStatToolError ? error.code : "Unbranded",
    error: error?.stack ?? String(thrown),
    ...context,
  });
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE = "https://www.margonem.pl";
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Who is knocking. AGENTS.md §5 makes this a promise rather than a detail — the scraper does
 * not dress up as a browser — so it is named and spelled once.
 */
const USER_AGENT = "Mozilla/5.0 (margostat scraper)";

/** Above this share of rejected rows on a page we assume the markup changed. */
const MAX_BAD_ROW_RATIO = 0.01;

// ── Helpers ───────────────────────────────────────────────────────────────────


// Note: the old form `/ladder/players,<world>?page=N` 301s to `/ladder/<World>/players`
// and LOSES the `page` parameter — it would fetch page 1 over and over.
function buildUrl(world: string, page: number) {
  return `${BASE}/ladder/${world}?page=${page}`;
}

function formatStamp(date: Date) {
  const padTwoDigits = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${padTwoDigits(date.getUTCMonth() + 1)}-${padTwoDigits(date.getUTCDate())}T${padTwoDigits(date.getUTCHours())}-${padTwoDigits(date.getUTCMinutes())}-${padTwoDigits(date.getUTCSeconds())}`;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// ── Fetching a page ───────────────────────────────────────────────────────────

async function getPage(world: string, page: number): Promise<string> {
  const url = buildUrl(world, page);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new LadderFetchError(error instanceof Error ? error.message : String(error), url, { cause: error });
  }

  if (!response.ok) {
    throw new LadderHttpError(response.status, url, parseRetryAfter(response.headers.get("retry-after")));
  }

  // A redirect that lost the page number means we would fetch the same thing over and
  // over — better to fail loudly than to write 400 copies of page 1.
  if (page > 1 && !response.url.includes(`page=${page}`)) {
    throw new LadderFetchError(`redirect lost the pagination (${response.url})`, url);
  }

  return response.text();
}

type PageResult = { rows: PlayerRow[]; totalPages: number; badRows: string[] };

async function scrapePage(world: string, page: number): Promise<PageResult> {
  const html = await getPage(world, page);
  const $ = cheerio.load(html);
  const { rows, errors } = parseTable($, world, page);

  const ratio = errors.length / Math.max(1, rows.length + errors.length);
  if (ratio > MAX_BAD_ROW_RATIO) {
    throw new LadderMarkupError(
      `rejected ${errors.length}/${rows.length + errors.length} rows — first: ${errors[0]}`,
      world,
      page,
    );
  }

  return { rows, totalPages: parseTotalPages($), badRows: errors };
}

/** Retries a SINGLE page — retrying used to rewind the whole world to page 1. */
async function scrapePageWithRetry(world: string, page: number): Promise<PageResult> {
  let attempt = 0;
  while (true) {
    try {
      return await scrapePage(world, page);
    } catch (error) {
      attempt++;
      await logError(error, { world, page, attempt });
      if (attempt > MAX_PAGE_RETRIES) throw error;

      const suggested = error instanceof LadderHttpError ? error.retryAfterMs : undefined;
      const backoff = getBackoffMs(attempt, suggested);
      await log("WARN", `attempt ${attempt}/${MAX_PAGE_RETRIES} failed (${world} p.${page}), retrying in ${backoff}ms`, {
        world,
        page,
        backoffMs: backoff,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(backoff);
    }
  }
}

// ── Scraping a world ──────────────────────────────────────────────────────────

async function scrapeWorld(
  world: string,
  interval: number,
  dropThreshold: number,
): Promise<WorldRoundResult> {
  const startedAt = new Date();
  // The pages are kept apart rather than concatenated: `removePageOverlap` counts the seams
  // at which the ranking had shifted under the walk, and a flat array has no seams left.
  const walkedPages: PlayerRow[][] = [];
  const badRows: string[] = [];
  let walkedRows = 0;
  let page = 1;
  let maxPages = 1;

  await log("INFO", `start`, { world, interval });
  process.stdout.write(`\n⟳ ${world} — connecting...\n`);

  while (page <= maxPages) {
    const result = await scrapePageWithRetry(world, page);
    if (page === 1) maxPages = result.totalPages;

    walkedPages.push(result.rows);
    walkedRows += result.rows.length;
    badRows.push(...result.badRows.map((error) => `p.${page}: ${error}`));

    await log("DEBUG", `page ${page}/${maxPages}: ${result.rows.length} rows`, { world });
    process.stdout.write(`\r  ${world}: page ${page}/${maxPages} (${walkedRows} players)`);
    page++;

    if (page <= maxPages) await sleep(interval);
  }

  const { rows, overlapRows, shiftedBoundaries } = removePageOverlap(walkedPages);

  const directory = path.join(WORLDS_DIR, world);
  const timestamp = formatStamp(startedAt);
  // The stitched count, not the walked one: a repeat was never a player, and comparing a
  // doubled-up count against a previous round's would hide a drop behind the walk's error.
  const suspect = checkPopulationDrop(rows.length, await getLatestSnapshotCount(directory), dropThreshold);

  const { filters, names } = splitSnapshot(rows, {
    world,
    timestamp,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    pages: maxPages,
    skippedRows: badRows.length,
    overlapRows,
    ...(suspect ? { suspect } : {}),
  });

  try {
    await mkdir(directory, { recursive: true });
    await writeAtomic(composeFilterPath(directory, timestamp), JSON.stringify(filters));
    await writeAtomic(composeNamesPath(directory, timestamp), JSON.stringify(names));
  } catch (error) {
    throw new SnapshotWriteError(
      `could not write the ${world} snapshot: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  if (badRows.length > 0) {
    await log("WARN", `skipped ${badRows.length} rows`, { world, examples: badRows.slice(0, 5) });
  }

  if (overlapRows > 0) {
    await log("WARN", `dropped ${overlapRows} rows the walk fetched twice`, {
      world,
      overlapRows,
      shiftedBoundaries,
      walkedRows,
    });
  }

  // Zero says nothing and stays off the line, the way `skippedRows` already does.
  const overlapText = overlapRows > 0 ? ` — ${overlapRows} repeated rows dropped at ${shiftedBoundaries} page seams` : "";

  if (suspect) {
    await log("WARN", `suspect snapshot: ${suspect.reason}`, { world, ...suspect });
    process.stdout.write(`\r⚠ ${world}: ${rows.length} players — ${suspect.reason}\n`);
  } else {
    process.stdout.write(`\r✓ ${world}: ${rows.length} players, ${maxPages} pages — written${overlapText}\n`);
  }
  await log("INFO", `done`, {
    world,
    rows: rows.length,
    pages: maxPages,
    skippedRows: badRows.length,
    overlapRows,
    shiftedBoundaries,
    file: composeFilterPath(directory, timestamp),
  });

  return { suspect, overlapRows, shiftedBoundaries };
}

// ── Dry-run ───────────────────────────────────────────────────────────────────

/** How many pages of a world a dry run reads. */
const DRY_RUN_PAGES = 2;

/**
 * Fetches the first pages of a world and reports whether the parser copes with the markup
 * as it stands.
 *
 * Two pages, not one, because everything about pagination happens above page 1 and a
 * check of page 1 alone exercises none of it: the `page` parameter surviving the answer,
 * and `parseTotalPages` read once from page 1 and then trusted for the rest of an
 * hour-long round. The old `/ladder/players,<world>` form 301s to a URL with no `page` on
 * it and answers page 1 to every request — `getPage` refuses that, and a dry run that
 * never asks for a second page never finds out whether the refusal still fires.
 *
 * A world that really is one page long is not a failure and not a gap: page 1 is then the
 * last page as well, there is no second page to ask for, and the line says so.
 */
async function dryRunWorld(world: string, interval: number): Promise<boolean> {
  const pageLines: string[] = [];
  let totalPages = 1;
  let firstRowText = "";

  for (let page = 1; page <= DRY_RUN_PAGES; page++) {
    if (page > totalPages) break;
    if (page > 1) await sleep(interval);

    let result: PageResult;
    try {
      result = await scrapePage(world, page);
    } catch (error) {
      process.stdout.write(
        `✗ ${world.padEnd(9)} p.${page} ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return false;
    }

    if (page === 1) {
      totalPages = result.totalPages;
      const [first] = result.rows;
      firstRowText = first
        ? ` — #1 ${first[1]} (lvl ${first[3]}, prof ${first[4]}, PH ${first[5]})`
        : "";
    }
    pageLines.push(
      `p.${page} ${String(result.rows.length).padStart(3)} rows` +
        `${result.badRows.length ? `, ${result.badRows.length} skipped` : ""}`,
    );
  }

  const pagesText =
    totalPages < DRY_RUN_PAGES
      ? `${totalPages} page — the whole world, nothing to paginate`
      : `${String(totalPages).padStart(4)} pages`;
  process.stdout.write(
    `✓ ${world.padEnd(9)} ${pageLines.join(", ")}, ${pagesText}${firstRowText}\n`,
  );
  return true;
}

// ── CLI ───────────────────────────────────────────────────────────────────────
//
// Everything that reads the arguments lives in `scraper-cli.ts` and is tested there. This
// file cannot be imported without starting a round, which is why the reading is not here.

const reading = readScraperCommand(process.argv.slice(2), DEFAULT_WORLDS);
if (!reading.ok) {
  console.error(reading.message);
  process.exit(1);
}
const { worlds, intervalMs, dropThreshold, isDryRun } = reading.command;

if (isDryRun) {
  process.stdout.write(
    `Dry run: checking the parser on the first ${DRY_RUN_PAGES} pages ` +
      `(${worlds.length} worlds), writing nothing.\n\n`,
  );
  let failed = 0;
  for (const [index, world] of worlds.entries()) {
    if (!(await dryRunWorld(world, intervalMs))) failed++;
    if (index < worlds.length - 1) await sleep(intervalMs);
  }
  process.stdout.write(`\n${worlds.length - failed}/${worlds.length} worlds OK\n`);
  process.exit(failed > 0 ? 1 : 0);
}

const failures: { world: string; code: string; error: string }[] = [];
const suspects: { world: string; reason: string }[] = [];
const overlaps: { world: string; overlapRows: number; shiftedBoundaries: number }[] = [];

for (const world of worlds) {
  try {
    const { suspect, overlapRows, shiftedBoundaries } = await scrapeWorld(world, intervalMs, dropThreshold);
    if (suspect) suspects.push({ world, reason: suspect.reason });
    if (overlapRows > 0) overlaps.push({ world, overlapRows, shiftedBoundaries });
  } catch (error) {
    // The boundary with the ranking and with the filesystem: whatever comes back, this
    // world is over and the next one still has to run (§9.5).
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof MargoStatToolError ? error.code : "Unbranded";
    failures.push({ world, code, error: message });
    await logError(error, { world });
    process.stdout.write(`\r✗ ${world}: ${message}\n`);
  }
}

await rebuildManifest();

// The trends are rebuilt in full — otherwise `public/trends.json` would describe the state
// before the round, and the history view would show everything except what just came down.
const { skipped } = await rebuildTrends();
if (skipped > 0) {
  await log("WARN", `trends: skipped ${skipped} snapshots with no startedAt`, { skipped });
}

if (overlaps.length > 0) {
  // Not a warning to act on: the repeats are already gone from what was written. What it
  // reports is how far the ranking moved under the walk — and the other direction of that
  // same movement, the players the walk stepped over, is not visible from the pages at all
  // (`src/page-overlap.ts`). A world that grows here is a world whose `count` is a floor.
  process.stdout.write(`\n${overlaps.length} worlds were read off a moving ranking:\n`);
  for (const overlap of overlaps) {
    process.stdout.write(
      `  ${overlap.world}: ${overlap.overlapRows} repeated rows dropped at ${overlap.shiftedBoundaries} page seams\n`,
    );
  }
}

if (suspects.length > 0) {
  // The snapshots are written — this is a warning to look into, not a failed run.
  process.stdout.write(`\n⚠ ${suspects.length} snapshots need checking:\n`);
  for (const suspect of suspects) process.stdout.write(`  ⚠ ${suspect.world}: ${suspect.reason}\n`);
}

if (failures.length > 0) {
  process.stdout.write(`\n${failures.length}/${worlds.length} worlds were not fetched:\n`);
  for (const failure of failures) process.stdout.write(`  ✗ ${failure.world} [${failure.code}]: ${failure.error}\n`);
  process.exit(1);
}

process.stdout.write(`\n✓ ${worlds.length}/${worlds.length} worlds fetched\n`);
