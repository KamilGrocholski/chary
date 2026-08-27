/**
 * Reading the scraper's command line.
 *
 * Its own module because `world-scraper.ts` runs the whole round at the top level of the
 * module, so importing it from a test starts a scrape. That left the argument handling
 * with no test at all, and it is the part where a mistake is most expensive: a typo in
 * `--dry-run` once fell through into `positional` and started a FULL round — over an hour,
 * and every snapshot of the day overwritten.
 *
 * Reading answers with a result rather than throwing, unlike the rest of `src/` (§9.5).
 * The caller is a person who mistyped a flag, and what helps them is one line saying what
 * is accepted — not a stack trace through a module they did not write.
 */

import { getFiniteNumberFromText, getIntegerFromText } from "@/src/lib/number.ts";
import { DEFAULT_DROP_THRESHOLD } from "@/src/snapshot.ts";

/** A world name goes into a URL and into a file path alike — it has to be boring. */
const WORLD_NAME = /^[a-z0-9-]+$/;

/** Below this the ranking answers 429. AGENTS.md §7.6. */
export const MIN_INTERVAL_MS = 250;

export const DEFAULT_INTERVAL_MS = 1000;

const DROP_THRESHOLD_FLAG = "--drop-threshold=";

export type ScraperCommand = {
  worlds: string[];
  intervalMs: number;
  dropThreshold: number;
  isDryRun: boolean;
};

export type ScraperCommandReading =
  | { ok: true; command: ScraperCommand }
  | { ok: false; message: string };

/**
 * @param argumentTexts `process.argv.slice(2)`
 * @param defaultWorlds the list scraped when none is named — `WORLDS` from `worlds.ts`
 */
export function readScraperCommand(argumentTexts: string[], defaultWorlds: string[]): ScraperCommandReading {
  const isDryRun = argumentTexts.includes("--dry-run");
  const positional = argumentTexts.filter((argument) => !argument.startsWith("--"));

  // An unknown flag must not be silently dropped from `positional` — that is the typo
  // above. Every accepted spelling is listed here and nowhere else.
  const unknownFlags = argumentTexts.filter(
    (argument) => argument.startsWith("--") && argument !== "--dry-run" && !argument.startsWith(DROP_THRESHOLD_FLAG),
  );
  if (unknownFlags.length > 0) {
    return {
      ok: false,
      message: `unknown options: ${unknownFlags.join(", ")}\nknown: --dry-run, ${DROP_THRESHOLD_FLAG}<0-1>`,
    };
  }

  const dropThresholdReading = readDropThreshold(argumentTexts);
  if (!dropThresholdReading.ok) return dropThresholdReading;

  const intervalReading = readInterval(positional[1]);
  if (!intervalReading.ok) return intervalReading;

  const worldsReading = readWorlds(positional[0], defaultWorlds);
  if (!worldsReading.ok) return worldsReading;

  return {
    ok: true,
    command: {
      worlds: worldsReading.worlds,
      intervalMs: intervalReading.intervalMs,
      dropThreshold: dropThresholdReading.dropThreshold,
      isDryRun,
    },
  };
}

function readDropThreshold(argumentTexts: string[]): { ok: true; dropThreshold: number } | { ok: false; message: string } {
  const flag = argumentTexts.find((argument) => argument.startsWith(DROP_THRESHOLD_FLAG));
  if (flag === undefined) return { ok: true, dropThreshold: DEFAULT_DROP_THRESHOLD };

  // A share, not a percentage, and read as one: `Number("0x1")` is 1 and `Number("")` is 0,
  // so a mistyped flag used to arm the population guard at a threshold nobody chose.
  const dropThreshold = getFiniteNumberFromText(flag.slice(DROP_THRESHOLD_FLAG.length));
  if (dropThreshold === null || dropThreshold < 0 || dropThreshold > 1) {
    return { ok: false, message: `${DROP_THRESHOLD_FLAG} takes a number in 0-1 (a share, not a percentage)` };
  }
  return { ok: true, dropThreshold };
}

function readInterval(text: string | undefined): { ok: true; intervalMs: number } | { ok: false; message: string } {
  if (text === undefined) return { ok: true, intervalMs: DEFAULT_INTERVAL_MS };

  // `Number.parseInt("1000abc", 10)` is 1000 — it reads as far as it can and keeps what it
  // got, so a fat-fingered interval used to look like a deliberate one.
  const intervalMs = getIntegerFromText(text.trim());
  if (intervalMs === null || intervalMs < MIN_INTERVAL_MS) {
    return { ok: false, message: `the interval is a whole number of milliseconds, at least ${MIN_INTERVAL_MS}` };
  }
  return { ok: true, intervalMs };
}

function readWorlds(
  text: string | undefined,
  defaultWorlds: string[],
): { ok: true; worlds: string[] } | { ok: false; message: string } {
  const worlds =
    text === undefined
      ? defaultWorlds
      : text
          .split(",")
          .map((world) => world.trim().toLowerCase())
          .filter((world) => world !== "");

  // `scrape ,` produced an empty list, the loop did nothing, and the process exited 0 with
  // "✓ 0/0 worlds" — a round that reported success without making a single request.
  if (worlds.length === 0) return { ok: false, message: "no world named" };

  // A world name reaches the URL AND `path.join(WORLDS_DIR, world)`, so without this
  // `scrape ../../tmp/x` wrote snapshots outside public/.
  const badWorlds = worlds.filter((world) => !WORLD_NAME.test(world));
  if (badWorlds.length > 0) {
    return { ok: false, message: `a world name may hold only [a-z0-9-]: ${badWorlds.join(", ")}` };
  }

  return { ok: true, worlds };
}
