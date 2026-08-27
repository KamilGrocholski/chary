import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  checkPopulationDrop,
  isLegacySnapshot,
  getLatestSnapshotCount,
  normalizeLegacyRows,
  splitNormalized,
  splitSnapshot,
  getTimestampFromFileName,
  SNAPSHOT_SCHEMA,
} from "@/src/snapshot.ts";
import type { PlayerRow } from "@/src/parser.ts";
import { writeAtomic } from "@/src/atomic.ts";
import { BACKOFF_BASE_MS, MAX_BACKOFF_MS, getBackoffMs, parseRetryAfter } from "@/src/retry.ts";

const META = { world: "aether", timestamp: "2026-08-01T10-00-00" };

const rows: PlayerRow[] = [
  [1, "essobe", 729, 378, 4, 8749, 0],
  [2, "kamillek kox", 32789, 359, 3, 4715, 12],
  [3, "Widmo", 5, 100, 1, 0, null],
];

describe("splitting a snapshot", () => {
  const { filters, names } = splitSnapshot(rows, META);

  test("the filter file holds the columns filtering needs", () => {
    expect(filters.schema).toBe(SNAPSHOT_SCHEMA);
    expect(filters.count).toBe(3);
    expect(filters.level).toEqual([378, 359, 100]);
    expect(filters.profession).toEqual([4, 3, 1]);
    expect(filters.honor).toEqual([8749, 4715, 0]);
    expect(filters.days).toEqual([0, 12, null]);
  });

  test("the names file keeps nickname and charId in the same order", () => {
    expect(names.name).toEqual(["essobe", "kamillek kox", "Widmo"]);
    expect(names.charId).toEqual([729, 32789, 5]);
  });

  test("the filter file carries no nicknames — those are 2/3 of a snapshot", () => {
    expect(JSON.stringify(filters)).not.toContain("essobe");
  });

  test("the two files together reconstruct the rows 1:1", () => {
    for (let index = 0; index < rows.length; index++) {
      expect([
        index + 1, // the rank comes from the order
        names.name[index],
        names.charId![index],
        filters.level[index],
        filters.profession[index],
        filters.honor[index],
        filters.days[index],
      ]).toEqual(rows[index]!);
    }
  });
});

describe("migrating old snapshots", () => {
  test("v1 — days derived from the text, the ISO dropped, no charId", () => {
    const schemaOneRows = {
      world: "aether",
      rows: [
        [1, "essobe", 378, 4, 8749, "Mniej niż 24h temu", "2026-07-21T20:03:12.814Z"],
        [2, "Ktoś", 300, 2, 10, "5 dni temu", "2026-07-16T20:03:12.814Z"],
        [3, "Widmo", 12, 1, 0, "20655 dni temu", "1969-12-06T00:00:00.000Z"],
      ],
    };
    const normalized = normalizeLegacyRows(schemaOneRows);
    expect(normalized.map((row) => row.days)).toEqual([0, 5, null]);
    expect(normalized.map((row) => row.charId)).toEqual([null, null, null]);

    const { filters, names } = splitNormalized(normalized, META);
    expect(filters.level).toEqual([378, 300, 12]);
    expect(filters.honor).toEqual([8749, 10, 0]);
    // no charId in the data → no empty column in the file
    expect(names.charId).toBeUndefined();
    expect(JSON.stringify(names)).not.toContain("charId");
  });

  test("v2 — read as-is, keeping the charId", () => {
    const schemaTwoRows = { schema: 2, world: "aether", rows: rows as unknown[][] };
    const normalized = normalizeLegacyRows(schemaTwoRows);
    expect(normalized.map((row) => row.charId)).toEqual([729, 32789, 5]);
    expect(normalized.map((row) => row.days)).toEqual([0, 12, null]);
    expect(splitNormalized(normalized, META).names.charId).toEqual([729, 32789, 5]);
  });
});

describe("recognising files", () => {
  test.each([
    ["2026-07-21T22-04-12.json", true],
    ["2026-07-21T22-04-12.f.json", false],
    ["2026-07-21T22-04-12.n.json", false],
  ] as const)("isLegacySnapshot(%p) → %p", (name, expected) => {
    expect(isLegacySnapshot(name)).toBe(expected);
  });

  test.each([
    ["2026-07-21T22-04-12.json", "2026-07-21T22-04-12"],
    ["2026-07-21T22-04-12.f.json", "2026-07-21T22-04-12"],
    ["2026-07-21T22-04-12.n.json", "2026-07-21T22-04-12"],
  ] as const)("getTimestampFromFileName(%p) → %p", (name, expected) => {
    expect(getTimestampFromFileName(name)).toBe(expected);
  });
});

describe("the guard against a truncated scrape", () => {
  // During an outage the ranking can return fewer pages. Such a snapshot is formally
  // valid — the only thing that gives it away is a sudden population drop, because
  // normally the population moves by fractions of a percent per round.

  test("the normal drift of players passes unflagged", () => {
    expect(checkPopulationDrop(39037, 39287)).toBeNull(); // aether's real drop: 0.6%
    expect(checkPopulationDrop(9600, 10_000)).toBeNull(); // exactly 4%
    expect(checkPopulationDrop(9500, 10_000)).toBeNull(); // exactly the 5% threshold
  });

  test("a drop past the threshold sets the flag, with the numbers", () => {
    const suspect = checkPopulationDrop(9400, 10_000);
    expect(suspect).not.toBeNull();
    expect(suspect!.previousCount).toBe(10_000);
    expect(suspect!.count).toBe(9400);
    expect(suspect!.drop).toBeCloseTo(0.06, 5);
    expect(suspect!.reason).toContain("6.0%");
  });

  test("a truncated scrape — half the pages never arrived", () => {
    expect(checkPopulationDrop(4000, 8000)!.drop).toBe(0.5);
  });

  test("population growth is never suspect", () => {
    expect(checkPopulationDrop(12_000, 10_000)).toBeNull();
    expect(checkPopulationDrop(10_000, 10_000)).toBeNull();
  });

  test("a new world with no previous snapshot is not suspect", () => {
    expect(checkPopulationDrop(5000, null)).toBeNull();
    expect(checkPopulationDrop(5000, 0)).toBeNull();
  });

  test("the threshold can be moved", () => {
    expect(checkPopulationDrop(9900, 10_000, 0.005)).not.toBeNull(); // stricter: 1% > 0.5%
    expect(checkPopulationDrop(5000, 10_000, 0.9)).toBeNull(); // looser: 50% < 90%
  });

  test("the flag lands in the filter file, not in the names file", () => {
    const suspect = checkPopulationDrop(4000, 8000)!;
    const { filters, names } = splitSnapshot(rows, { ...META, suspect });
    expect(filters.suspect).toEqual(suspect);
    expect(JSON.stringify(names)).not.toContain("suspect");
  });

  test("a healthy snapshot carries no suspect field", () => {
    expect(JSON.stringify(splitSnapshot(rows, META).filters)).not.toContain("suspect");
  });
});

describe("reading the previous snapshot", () => {
  const temporaryDirectory = path.join(import.meta.dir, "..", "node_modules", ".tmp-snapshot-test");

  async function composeWorld(name: string, files: Record<string, unknown>) {
    const dir = path.join(temporaryDirectory, name);
    await mkdir(dir, { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      await Bun.write(path.join(dir, file), JSON.stringify(content));
    }
    return dir;
  }

  afterAll(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  test("takes count from the newest snapshot, not from whichever comes first", async () => {
    const dir = await composeWorld("ordering", {
      "2026-06-01T00-00-00.f.json": { count: 100 },
      "2026-08-01T00-00-00.f.json": { count: 300 },
      "2026-07-01T00-00-00.f.json": { count: 200 },
    });
    expect(await getLatestSnapshotCount(dir)).toBe(300);
  });

  test("skips the names files", async () => {
    const dir = await composeWorld("names", {
      "2026-08-01T00-00-00.f.json": { count: 42 },
      "2026-09-01T00-00-00.n.json": { count: 999 },
    });
    expect(await getLatestSnapshotCount(dir)).toBe(42);
  });

  test("a new world, a corrupted file and a missing directory give null, not an exception", async () => {
    expect(await getLatestSnapshotCount(path.join(temporaryDirectory, "no-such-world"))).toBeNull();
    expect(await getLatestSnapshotCount(await composeWorld("empty", {}))).toBeNull();

    const corrupted = path.join(temporaryDirectory, "corrupted");
    await mkdir(corrupted, { recursive: true });
    await Bun.write(path.join(corrupted, "2026-08-01T00-00-00.f.json"), "{ this is not json");
    expect(await getLatestSnapshotCount(corrupted)).toBeNull();
  });

  test("together with the guard: a truncated snapshot gets flagged", async () => {
    const dir = await composeWorld("truncated", { "2026-07-01T00-00-00.f.json": { count: 7754 } });
    const suspect = checkPopulationDrop(3900, await getLatestSnapshotCount(dir));

    expect(suspect).not.toBeNull();
    expect(suspect!.drop).toBeCloseTo(0.497, 3);
    expect(suspect!.reason).toContain("7754 → 3900");
  });

  describe("a write that is all or nothing", () => {
    // `Bun.write` is truncate + write: an interruption left a truncated `.f.json`, and
    // `JSON.parse` then took down both the tail of a round and `bun run rebuild`.
    test("replaces the contents and leaves no temp file behind", async () => {
      const dir = await composeWorld("atomic", { "file.json": { old: true } });
      const file = path.join(dir, "file.json");

      await writeAtomic(file, JSON.stringify({ fresh: true }));
      expect(await Bun.file(file).json()).toEqual({ fresh: true });
      expect(await Bun.file(`${file}.tmp`).exists()).toBe(false);
    });

    test("a failed write neither touches the previous contents nor leaves litter", async () => {
      const dir = await composeWorld("atomic-failure", { "file.json": { old: true } });
      const file = path.join(dir, "file.json");

      // A directory where the temp file goes — `Bun.write` has nowhere to write.
      await mkdir(`${file}.tmp`, { recursive: true });
      await expect(writeAtomic(file, JSON.stringify({ fresh: true }))).rejects.toThrow();

      // The old contents must survive: that is the entire point of this function.
      expect(await Bun.file(file).json()).toEqual({ old: true });
      await rm(`${file}.tmp`, { recursive: true, force: true });
    });
  });
});

describe("the retry policy", () => {
  test("`Retry-After: 0` does not wipe out the pause", () => {
    // `0 ?? x` is `0`, not `x` — that one operator sent four requests back to back with
    // no pause at all, straight against "respect the service".
    expect(parseRetryAfter("0")).toBe(0);
    expect(getBackoffMs(1, parseRetryAfter("0"))).toBe(BACKOFF_BASE_MS);
    expect(getBackoffMs(1, 0)).toBeGreaterThanOrEqual(BACKOFF_BASE_MS);
  });

  test("with no hint the backoff grows exponentially and has a ceiling", () => {
    expect(getBackoffMs(1)).toBe(BACKOFF_BASE_MS);
    expect(getBackoffMs(2)).toBe(BACKOFF_BASE_MS * 2);
    expect(getBackoffMs(3)).toBe(BACKOFF_BASE_MS * 4);
    expect(getBackoffMs(99)).toBe(MAX_BACKOFF_MS);
  });

  test("the server's hint may lengthen the pause but not shorten it", () => {
    expect(getBackoffMs(1, 60_000)).toBe(60_000); // longer than ours — honoured
    expect(getBackoffMs(3, 1_000)).toBe(BACKOFF_BASE_MS * 4); // shorter — ignored
    expect(getBackoffMs(1, 999_999)).toBe(MAX_BACKOFF_MS); // absurd — the ceiling
  });

  test("the header is sometimes a date, and junk must not take down the scraper", () => {
    const now = Date.parse("2026-08-04T12:00:00Z");
    expect(parseRetryAfter("Tue, 04 Aug 2026 12:00:30 GMT", now)).toBe(30_000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("nonsense")).toBeUndefined();
    // a date in the past must not produce a negative pause
    expect(parseRetryAfter("Tue, 04 Aug 2026 11:00:00 GMT", now)).toBe(0);
  });
});
