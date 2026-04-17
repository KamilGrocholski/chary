import * as cheerio from "cheerio";
import { mkdir, readdir, stat, appendFile } from "node:fs/promises";
import path from "node:path";
import { WORLDS as DEFAULT_WORLDS } from "./worlds.ts";

type PlayerRow = [
  rank: number,
  name: string,
  level: number,
  profession: number,
  honor: number,
  lastOnlineText: string,
  lastOnline: string,
];

type SnapshotFile = {
  timestamp: string;
  file: string;
};

type ManifestWorld = {
  name: string;
  files: SnapshotFile[];
};

type Manifest = {
  worlds: ManifestWorld[];
};

// ── Error types ──────────────────────────────────────────────────────────────

class HttpError extends Error {
  readonly type = "HttpError";
  constructor(readonly status: number, readonly url: string) {
    super(`HTTP ${status} — ${url}`);
  }
}

class ParseError extends Error {
  readonly type = "ParseError";
  constructor(message: string, readonly world: string, readonly page: number) {
    super(`${message} (world=${world}, page=${page})`);
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

// ── Logging ──────────────────────────────────────────────────────────────────

const LOG_DIR = "logs";
const LOG_FILE = path.join(LOG_DIR, "scraper.log");

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

const LOG_LEVEL_ENV = (process.env.LOG_LEVEL ?? "WARN").toUpperCase() as LogLevel;
const MIN_LEVEL = LOG_LEVELS[LOG_LEVEL_ENV] ?? LOG_LEVELS.WARN;

function nowIso() {
  return new Date().toISOString();
}

function formatLogLine(level: LogLevel, msg: string, extra?: object) {
  const base = `[${nowIso()}] [${level}] ${msg}`;
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
    message: err.message,
    error: err.stack ?? String(err),
    ...context,
  });
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE = "https://www.margonem.pl";
const PUBLIC_DIR = "public";
const WORLDS_DIR = path.join(PUBLIC_DIR, "worlds");
const MANIFEST_FILE = path.join(PUBLIC_DIR, "manifest.json");

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildUrl(world: string, page: number) {
  return `${BASE}/ladder/players,${world}?page=${page}`;
}

function parseNumber(text: string) {
  const n = Number(text.replace(/[^\d-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function formatStamp(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function parseTotalPages($: cheerio.CheerioAPI): number {
  const candidates = [
    $(".pagination .total-pages").first().text().trim(),
    $("input[name='page'][max]").attr("max") ?? "",
    $(".pagination a[href*='page=']")
      .map((_, el) => parseNumber($(el).text()))
      .get()
      .filter((n) => n > 0)
      .join(" "),
  ];

  for (const c of candidates) {
    const n = parseNumber(c);
    if (n > 0) return n;
  }
  return 1;
}

function parseLastOnline(text: string, now = new Date()): Date | null {
  const t = text.trim().toLowerCase();

  if (t.includes("mniej") && t.includes("24h")) {
    // store as 1 min before scrape time so the record stays valid for ~24h
    return new Date(now.getTime() - 60 * 1000);
  }

  const d = t.match(/(\d+)\s+dni?\s+temu/);
  if (d) {
    const date = new Date(now);
    date.setDate(date.getDate() - Number(d[1]));
    return date;
  }

  return null;
}

function professionToInt(name: string): number {
  const m: Record<string, number> = {
    Wojownik: 1,
    Mag: 2,
    Paladyn: 3,
    Tropiciel: 4,
    "Tancerz ostrzy": 5,
    Łowca: 6,
    owca: 6,
  };
  return m[name.trim()] ?? 0;
}

function parseTable($: cheerio.CheerioAPI, world: string, page: number): PlayerRow[] {
  const rows: PlayerRow[] = [];

  const table = $("table")
    .filter((_, el) => {
      const txt = $(el).text();
      return txt.includes("Gracz") && txt.includes("Poziom") && txt.includes("Profesja");
    })
    .first();

  table.find("tbody tr").each((_, tr) => {
    const tds = $(tr).children("td");
    if (tds.length < 6) return;

    const rank = parseNumber($(tds[0]).text());
    const name = $(tds[1]).text().trim();
    const level = parseNumber($(tds[2]).text());
    const profession = professionToInt($(tds[3]).text().trim());
    const honor = parseNumber($(tds[4]).text());
    const lastOnlineText = $(tds[5]).text().trim();
    const lastOnlineDate = parseLastOnline(lastOnlineText);

    if (!lastOnlineDate) return; // skip rows with unrecognized last-online format

    rows.push([
      rank,
      name,
      level,
      profession,
      honor,
      lastOnlineText,
      lastOnlineDate.toISOString(),
    ]);
  });

  if (rows.length === 0) {
    throw new ParseError("No rows parsed from table", world, page);
  }

  return rows;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toManifestTimestamp(fileName: string) {
  return fileName.replace(/\.json$/, "");
}

// ── Manifest ──────────────────────────────────────────────────────────────────

async function rebuildManifest() {
  await mkdir(WORLDS_DIR, { recursive: true });

  const worlds = await readdir(WORLDS_DIR, { withFileTypes: true });
  const manifest: Manifest = { worlds: [] };

  for (const worldDir of worlds) {
    if (!worldDir.isDirectory()) continue;

    const worldName = worldDir.name;
    const fullWorldDir = path.join(WORLDS_DIR, worldName);
    const files = await readdir(fullWorldDir, { withFileTypes: true });
    const snapshots: SnapshotFile[] = [];

    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      const fullPath = path.join(fullWorldDir, file.name);
      const s = await stat(fullPath);
      if (!s.isFile()) continue;

      snapshots.push({
        timestamp: toManifestTimestamp(file.name.split("__")[0] ?? file.name),
        file: path.posix.join("worlds", worldName, file.name),
      });
    }

    snapshots.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    manifest.worlds.push({ name: worldName, files: snapshots });
  }

  manifest.worlds.sort((a, b) => a.name.localeCompare(b.name));
  await Bun.write(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
}

// ── Scraper ───────────────────────────────────────────────────────────────────

async function scrapeWorld(world: string, interval: number) {
  const startedAt = new Date();
  const allRows: PlayerRow[] = [];
  let page = 1;
  let maxPages = 1;

  await log("INFO", `Starting scrape`, { world, interval });
  process.stdout.write(`\n⟳ ${world} — łączenie...\n`);

  while (page <= maxPages) {
    const url = buildUrl(world, page);

    let html: string;
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "Mozilla/5.0", accept: "text/html,application/xhtml+xml" },
      });

      if (!res.ok) {
        const err = new HttpError(res.status, url);
        await logError(err, { world, page });
        throw err;
      }

      html = await res.text();
    } catch (e) {
      if (e instanceof HttpError) throw e;
      const err = new FetchError(e instanceof Error ? e.message : String(e), url, e);
      await logError(err, { world, page });
      throw err;
    }

    let rows: PlayerRow[];
    try {
      const $ = cheerio.load(html);
      if (page === 1) maxPages = parseTotalPages($);
      rows = parseTable($, world, page);
    } catch (e) {
      if (e instanceof ParseError) {
        await logError(e);
        throw e;
      }
      const err = new ParseError(e instanceof Error ? e.message : String(e), world, page);
      await logError(err);
      throw err;
    }

    allRows.push(...rows);
    await log("DEBUG", `page ${page}/${maxPages}: ${rows.length} rows`, { world });
    process.stdout.write(`\r  ${world}: strona ${page}/${maxPages} (${allRows.length} graczy)`);
    page++;

    if (page <= maxPages) await sleep(interval);
  }

  const finishedAt = new Date();
  const dir = path.join(WORLDS_DIR, world);
  const file = path.join(dir, `${formatStamp(startedAt)}.json`);
  const payload = {
    world,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    pages: maxPages,
    rows: allRows,
  };

  try {
    await mkdir(dir, { recursive: true });
    await Bun.write(file, JSON.stringify(payload, null, 2));
    await rebuildManifest();
  } catch (e) {
    const err = new IoError(`Failed to save snapshot for ${world}: ${e instanceof Error ? e.message : String(e)}`, e);
    await logError(err, { world, file });
    throw err;
  }

  process.stdout.write(`\r✓ ${world}: ${allRows.length} graczy, ${maxPages} stron — zapisano\n`);
  await log("INFO", `Done`, { world, rows: allRows.length, pages: maxPages, file });
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const worldArg = process.argv[2];
const worlds = worldArg
  ? worldArg.split(",").map((w) => w.trim()).filter(Boolean)
  : DEFAULT_WORLDS;
let interval = 1000;
const intervalArg = process.argv[3];

if (intervalArg) {
  interval = parseInt(intervalArg, 10);
  if (Number.isNaN(interval) || interval < 0) {
    console.error("interval must be a non-negative integer (ms)");
    process.exit(1);
  }
}

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 5_000;

async function scrapeWithRetry(world: string, interval: number) {
  let attempt = 0;
  while (true) {
    try {
      await scrapeWorld(world, interval);
      return;
    } catch (e) {
      attempt++;
      if (attempt > MAX_RETRIES) {
        await log("FATAL", `All ${MAX_RETRIES} retries exhausted for ${world}, giving up`, { world });
        return;
      }
      const backoff = BACKOFF_BASE_MS * 2 ** (attempt - 1);
      await log("WARN", `Attempt ${attempt}/${MAX_RETRIES} failed for ${world}, retrying in ${backoff}ms`, {
        world,
        attempt,
        backoffMs: backoff,
        error: e instanceof Error ? e.message : String(e),
      });
      await sleep(backoff);
    }
  }
}

(async () => {
  for (const world of worlds) {
    await scrapeWithRetry(world, interval);
  }
})();
