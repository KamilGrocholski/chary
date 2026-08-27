import { describe, expect, test } from "bun:test";
import { DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS, readScraperCommand } from "@/src/scraper-cli.ts";
import { DEFAULT_DROP_THRESHOLD } from "@/src/snapshot.ts";

// The part of the scraper where a mistake costs the most and where there was no test at
// all, because `world-scraper.ts` starts a round on import. Each refusal below is a
// failure this repository has actually paid for — see the docblock in scraper-cli.ts.

const WORLDS = ["aether", "tempest"];

/** The reading, or a failure of the test — so the assertions below read as one line each. */
function readCommand(args: string[]) {
  const reading = readScraperCommand(args, WORLDS);
  if (!reading.ok) throw new Error(`expected a command, got: ${reading.message}`);
  return reading.command;
}

function readRefusal(args: string[]) {
  const reading = readScraperCommand(args, WORLDS);
  if (reading.ok) throw new Error(`expected a refusal, got: ${JSON.stringify(reading.command)}`);
  return reading.message;
}

describe("the defaults", () => {
  test("no arguments scrapes the configured list at one request a second", () => {
    expect(readCommand([])).toEqual({
      worlds: WORLDS,
      intervalMs: DEFAULT_INTERVAL_MS,
      dropThreshold: DEFAULT_DROP_THRESHOLD,
      isDryRun: false,
    });
  });

  test("the default interval respects the floor the ranking imposes", () => {
    expect(DEFAULT_INTERVAL_MS).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
  });
});

describe("worlds", () => {
  test("a comma-separated list is trimmed and lowercased", () => {
    expect(readCommand([" Aether , tempest "]).worlds).toEqual(["aether", "tempest"]);
  });

  // `scrape ,` produced an empty list, the loop did nothing, and the process exited 0
  // reporting "✓ 0/0 worlds" — success without a single request.
  test.each([[","], [" "], [",,"]])("%p is refused rather than scraping nothing", (argument) => {
    expect(readRefusal([argument])).toContain("no world named");
  });

  // A world name reaches the URL AND path.join(WORLDS_DIR, world).
  test.each([["../../tmp/x"], ["aether/../.."], ["Aether!"], ["a b"]])(
    "%p cannot become a path",
    (argument) => {
      expect(readRefusal([argument])).toContain("[a-z0-9-]");
    },
  );

  test("one bad name refuses the whole list, rather than scraping the rest", () => {
    expect(readRefusal(["aether,../x,tempest"])).toContain("../x");
  });
});

describe("the interval", () => {
  test("a whole number of milliseconds is taken", () => {
    expect(readCommand(["aether", "2000"]).intervalMs).toBe(2000);
  });

  test.each([[String(MIN_INTERVAL_MS), MIN_INTERVAL_MS]])("the floor itself is accepted: %p", (text, expected) => {
    expect(readCommand(["aether", text]).intervalMs).toBe(expected);
  });

  test("one below the floor is refused — the ranking answers 429 there", () => {
    expect(readRefusal(["aether", String(MIN_INTERVAL_MS - 1)])).toContain(String(MIN_INTERVAL_MS));
  });

  // `Number.parseInt("1000abc", 10)` is 1000: it read as far as it could and kept what it
  // got, so a fat-fingered interval looked like a deliberate one.
  test.each([["1000abc"], ["1e3"], ["0x10"], [""], ["-1"], ["1.5"]])("%p is refused, not repaired", (text) => {
    expect(readRefusal(["aether", text])).toContain("milliseconds");
  });
});

describe("the drop threshold", () => {
  test("a share is taken", () => {
    expect(readCommand(["--drop-threshold=0.1"]).dropThreshold).toBe(0.1);
  });

  test.each([["0", 0], ["1", 1]] as const)("the boundary %p is inside the range", (text, expected) => {
    expect(readCommand([`--drop-threshold=${text}`]).dropThreshold).toBe(expected);
  });

  test.each([["1.1"], ["-0.1"], ["10"], ["0x1"], [""], ["half"]])("%p is refused", (text) => {
    expect(readRefusal([`--drop-threshold=${text}`])).toContain("0-1");
  });
});

describe("flags", () => {
  test("--dry-run is a command, not a world", () => {
    const command = readCommand(["--dry-run"]);
    expect(command.isDryRun).toBe(true);
    expect(command.worlds).toEqual(WORLDS);
  });

  // The expensive one: a typo used to fall through into the positional arguments and start
  // a FULL round — over an hour, every snapshot of the day overwritten.
  test.each([["--dry-runn"], ["--dryrun"], ["--dry_run"], ["--force"]])("%p is refused, never ignored", (flag) => {
    const message = readRefusal([flag]);
    expect(message).toContain("unknown options");
    expect(message).toContain(flag);
  });

  test("the refusal names what is accepted", () => {
    expect(readRefusal(["--nope"])).toContain("--dry-run");
  });
});
