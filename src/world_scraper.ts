import * as cheerio from "cheerio";
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { WORLDS as DEFAULT_WORLDS } from "./worlds.ts";
import { ParseError, parseTable, parseTotalPages, type PlayerRow } from "./parser.ts";
import {
  DEFAULT_DROP_THRESHOLD,
  checkPopulationDrop,
  filterPathFor,
  latestSnapshotCount,
  namesPathFor,
  splitSnapshot,
  type PopulationDrop,
} from "./snapshot.ts";
import { WORLDS_DIR, rebuildManifest } from "./manifest.ts";
import { rebuildTrends } from "./trends.ts";
import { writeAtomic } from "./atomic.ts";
import { MAX_PAGE_RETRIES, backoffFor, parseRetryAfter } from "./retry.ts";

// ── Error types ───────────────────────────────────────────────────────────────

class HttpError extends Error {
  readonly type = "HttpError";
  constructor(readonly status: number, readonly url: string, readonly retryAfterMs?: number) {
    super(`HTTP ${status} — ${url}`);
  }
}

class FetchError extends Error {
  readonly type = "FetchError";
  constructor(message: string, readonly url: string, readonly cause?: unknown) {
    super(`${message} — ${url}`);
  }
}

class IoError extends Error {
  readonly type = "IoError";
  constructor(message: string, readonly cause?: unknown) {
    super(message);
  }
}

type ScraperError = HttpError | ParseError | FetchError | IoError;

// ── Logging ───────────────────────────────────────────────────────────────────

const LOG_DIR = "logs";
const LOG_FILE = path.join(LOG_DIR, "scraper.log");

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

const LOG_LEVEL_ENV = (process.env.LOG_LEVEL ?? "WARN").toUpperCase() as LogLevel;
const MIN_LEVEL = LOG_LEVELS[LOG_LEVEL_ENV] ?? LOG_LEVELS.WARN;

function formatLogLine(level: LogLevel, msg: string, extra?: object) {
  const base = `[${new Date().toISOString()}] [${level}] ${msg}`;
  return extra ? `${base} ${JSON.stringify(extra)}` : base;
}

async function log(level: LogLevel, msg: string, extra?: object) {
  if (LOG_LEVELS[level] < MIN_LEVEL) return;
  const line = formatLogLine(level, msg, extra) + "\n";
  process.stdout.write(line);
  try {
    await mkdir(LOG_DIR, { recursive: true });
    await appendFile(LOG_FILE, line);
  } catch {
    // best-effort
  }
}

function logError(err: ScraperError, context?: object) {
  return log("ERROR", err.message, {
    type: err.type,
    error: err.stack ?? String(err),
    ...context,
  });
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE = "https://www.margonem.pl";
const FETCH_TIMEOUT_MS = 30_000;

const MIN_INTERVAL_MS = 250;
/** Above this share of rejected rows on a page we assume the markup changed. */
const MAX_BAD_ROW_RATIO = 0.01;

/** A world name goes into a URL and into a file path alike — it has to be boring. */
const WORLD_NAME = /^[a-z0-9-]+$/;

// ── Helpers ───────────────────────────────────────────────────────────────────


// Note: the old form `/ladder/players,<world>?page=N` 301s to `/ladder/<World>/players`
// and LOSES the `page` parameter — it would fetch page 1 over and over.
function buildUrl(world: string, page: number) {
  return `${BASE}/ladder/${world}?page=${page}`;
}

function formatStamp(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}-${p(d.getUTCMinutes())}-${p(d.getUTCSeconds())}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Fetching a page ───────────────────────────────────────────────────────────

async function fetchPage(world: string, page: number): Promise<string> {
  const url = buildUrl(world, page);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (margostat scraper)", accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new FetchError(e instanceof Error ? e.message : String(e), url, e);
  }

  if (!res.ok) {
    throw new HttpError(res.status, url, parseRetryAfter(res.headers.get("retry-after")));
  }

  // A redirect that lost the page number means we would fetch the same thing over and
  // over — better to fail loudly than to write 400 copies of page 1.
  if (page > 1 && !res.url.includes(`page=${page}`)) {
    throw new FetchError(`redirect lost the pagination (${res.url})`, url);
  }

  return res.text();
}

type PageResult = { rows: PlayerRow[]; totalPages: number; badRows: string[] };

async function scrapePage(world: string, page: number): Promise<PageResult> {
  const html = await fetchPage(world, page);
  const $ = cheerio.load(html);
  const { rows, errors } = parseTable($, world, page);

  const ratio = errors.length / Math.max(1, rows.length + errors.length);
  if (ratio > MAX_BAD_ROW_RATIO) {
    throw new ParseError(
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
    } catch (e) {
      attempt++;
      await logError(e as ScraperError, { world, page, attempt });
      if (attempt > MAX_PAGE_RETRIES) throw e;

      const suggested = e instanceof HttpError ? e.retryAfterMs : undefined;
      const backoff = backoffFor(attempt, suggested);
      await log("WARN", `attempt ${attempt}/${MAX_PAGE_RETRIES} failed (${world} p.${page}), retrying in ${backoff}ms`, {
        world,
        page,
        backoffMs: backoff,
        error: e instanceof Error ? e.message : String(e),
      });
      await sleep(backoff);
    }
  }
}

// ── Scraping a world ──────────────────────────────────────────────────────────

async function scrapeWorld(world: string, interval: number): Promise<PopulationDrop | null> {
  const startedAt = new Date();
  const allRows: PlayerRow[] = [];
  const badRows: string[] = [];
  let page = 1;
  let maxPages = 1;

  await log("INFO", `start`, { world, interval });
  process.stdout.write(`\n⟳ ${world} — connecting...\n`);

  while (page <= maxPages) {
    const result = await scrapePageWithRetry(world, page);
    if (page === 1) maxPages = result.totalPages;

    allRows.push(...result.rows);
    badRows.push(...result.badRows.map((e) => `p.${page}: ${e}`));

    await log("DEBUG", `page ${page}/${maxPages}: ${result.rows.length} rows`, { world });
    process.stdout.write(`\r  ${world}: page ${page}/${maxPages} (${allRows.length} players)`);
    page++;

    if (page <= maxPages) await sleep(interval);
  }

  const dir = path.join(WORLDS_DIR, world);
  const timestamp = formatStamp(startedAt);
  const suspect = checkPopulationDrop(allRows.length, await latestSnapshotCount(dir), dropThreshold);

  const { filters, names } = splitSnapshot(allRows, {
    world,
    timestamp,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    pages: maxPages,
    skippedRows: badRows.length,
    ...(suspect ? { suspect } : {}),
  });

  try {
    await mkdir(dir, { recursive: true });
    await writeAtomic(filterPathFor(dir, timestamp), JSON.stringify(filters));
    await writeAtomic(namesPathFor(dir, timestamp), JSON.stringify(names));
  } catch (e) {
    throw new IoError(`could not write the ${world} snapshot: ${e instanceof Error ? e.message : String(e)}`, e);
  }

  if (badRows.length > 0) {
    await log("WARN", `skipped ${badRows.length} rows`, { world, examples: badRows.slice(0, 5) });
  }

  if (suspect) {
    await log("WARN", `suspect snapshot: ${suspect.reason}`, { world, ...suspect });
    process.stdout.write(`\r⚠ ${world}: ${allRows.length} players — ${suspect.reason}\n`);
  } else {
    process.stdout.write(`\r✓ ${world}: ${allRows.length} players, ${maxPages} pages — written\n`);
  }
  await log("INFO", `done`, {
    world,
    rows: allRows.length,
    pages: maxPages,
    skippedRows: badRows.length,
    file: filterPathFor(dir, timestamp),
  });

  return suspect;
}

// ── Dry-run ───────────────────────────────────────────────────────────────────

/** Fetches page 1 only and reports whether the parser copes with the current markup. */
async function dryRunWorld(world: string): Promise<boolean> {
  try {
    const { rows, totalPages, badRows } = await scrapePage(world, 1);
    const [first] = rows;
    process.stdout.write(
      `✓ ${world.padEnd(9)} ${String(rows.length).padStart(3)} rows, ${String(totalPages).padStart(4)} pages` +
        `${badRows.length ? `, ${badRows.length} skipped` : ""}` +
        `${first ? ` — #1 ${first[1]} (lvl ${first[3]}, prof ${first[4]}, PH ${first[5]})` : ""}\n`,
    );
    return true;
  } catch (e) {
    process.stdout.write(`✗ ${world.padEnd(9)} ${e instanceof Error ? e.message : String(e)}\n`);
    return false;
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const positional = args.filter((a) => !a.startsWith("--"));

// An unknown flag must not be silently dropped from `positional`: a typo in `--dry-run`
// then started a FULL scrape — ~1.6 h and 202 overwritten files.
const unknownFlags = args.filter((a) => a.startsWith("--") && a !== "--dry-run" && !a.startsWith("--drop-threshold="));
if (unknownFlags.length > 0) {
  console.error(`unknown options: ${unknownFlags.join(", ")}\nknown: --dry-run, --drop-threshold=<0-1>`);
  process.exit(1);
}

// The truncated-scrape guard's threshold, e.g. --drop-threshold=0.1 for 10%.
const dropThresholdArg = args.find((a) => a.startsWith("--drop-threshold="))?.split("=")[1];
const dropThreshold = dropThresholdArg === undefined ? DEFAULT_DROP_THRESHOLD : Number(dropThresholdArg);
if (!Number.isFinite(dropThreshold) || dropThreshold < 0 || dropThreshold > 1) {
  console.error("--drop-threshold must be a number in 0-1 (a share, not a percentage)");
  process.exit(1);
}

const worlds = positional[0]
  ? positional[0].split(",").map((w) => w.trim().toLowerCase()).filter(Boolean)
  : DEFAULT_WORLDS;

// A world name goes into the URL AND into `path.join(WORLDS_DIR, world)`, so without
// validation `scrape ../../tmp/x` wrote snapshots outside `public/`.
const badWorlds = worlds.filter((w) => !WORLD_NAME.test(w));
if (badWorlds.length > 0) {
  console.error(`a world name may contain only [a-z0-9-]: ${badWorlds.join(", ")}`);
  process.exit(1);
}

// `scrape ,` produced an empty list, the loop did nothing, and the process exited with
// code 0 and "✓ 0/0 worlds" — exactly the class of failure rule #3 is about.
if (worlds.length === 0) {
  console.error("no world given");
  process.exit(1);
}

let interval = 1000;
if (positional[1]) {
  const parsed = Number.parseInt(positional[1], 10);
  if (Number.isNaN(parsed) || parsed < MIN_INTERVAL_MS) {
    console.error(`interval must be a number ≥ ${MIN_INTERVAL_MS} (ms)`);
    process.exit(1);
  }
  interval = parsed;
}

if (dryRun) {
  process.stdout.write(`Dry run: checking the parser on page 1 (${worlds.length} worlds), writing nothing.\n\n`);
  let failed = 0;
  for (const [i, world] of worlds.entries()) {
    if (!(await dryRunWorld(world))) failed++;
    if (i < worlds.length - 1) await sleep(interval);
  }
  process.stdout.write(`\n${worlds.length - failed}/${worlds.length} worlds OK\n`);
  process.exit(failed > 0 ? 1 : 0);
}

const failures: { world: string; error: string }[] = [];
const suspects: { world: string; reason: string }[] = [];

for (const world of worlds) {
  try {
    const suspect = await scrapeWorld(world, interval);
    if (suspect) suspects.push({ world, reason: suspect.reason });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    failures.push({ world, error: message });
    await log("FATAL", `world ${world} failed — skipping`, { world, error: message });
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

if (suspects.length > 0) {
  // The snapshots are written — this is a warning to look into, not a failed run.
  process.stdout.write(`\n⚠ ${suspects.length} snapshots need checking:\n`);
  for (const s of suspects) process.stdout.write(`  ⚠ ${s.world}: ${s.reason}\n`);
}

if (failures.length > 0) {
  process.stdout.write(`\n${failures.length}/${worlds.length} worlds were not fetched:\n`);
  for (const f of failures) process.stdout.write(`  ✗ ${f.world}: ${f.error}\n`);
  process.exit(1);
}

process.stdout.write(`\n✓ ${worlds.length}/${worlds.length} worlds fetched\n`);
