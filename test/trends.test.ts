import { describe, expect, test } from "bun:test";
import path from "node:path";
import { normalizeLegacyRows, splitNormalized, type FilterFile } from "../src/snapshot.ts";
import { activityBucket as activityBucketServer, buildWorldTrend, summarizeSnapshot } from "../src/trends.ts";
import { activityBucket as activityBucketBrowser } from "../public/shared.js";
import { emptyFilters, summarizeFiltered } from "../public/filters.js";
import {
  ACTIVITY_THRESHOLDS,
  DEFAULT_THRESHOLD,
  HISTORY_BUDGET_BYTES,
  HISTORY_WINDOW,
  activeCounts,
  budgetedEntries,
  buildFilteredTrend,
  cachedSnapshots,
  changeRows,
  loadHistory,
  loadedCount,
  shareSeries,
  summarize,
  thresholdByKey,
  toTypedSnapshot,
  usableThresholds,
  viewFromParams,
  viewToParams,
  windowedEntries,
} from "../public/history.js";

// The reference is real data, not a reimplementation of the same arithmetic: the aggregate
// is checked against a sample of a real snapshot in schema v1 (the same one dashboard.test.ts
// uses), and the published `trends.json` against the `.f.json` files it was built from.

const PUBLIC_DIR = path.resolve(import.meta.dir, "../public");

const legacy = JSON.parse(
  await Bun.file(path.join(import.meta.dir, "fixtures/legacy-snapshot-aether.json")).text(),
);
const { filters: sample } = splitNormalized(normalizeLegacyRows(legacy), {
  world: "aether",
  timestamp: "2026-07-21T22-04-12",
  startedAt: "2026-07-21T20:04:12.489Z",
});

function legacyDays(text: string): number | null {
  const t = String(text);
  if (t.includes("24h")) return 0;
  const n = Number(t.match(/(\d+)/)?.[1]);
  return n >= 10_000 ? null : n;
}

function legacyCount(predicate: (row: any[]) => boolean) {
  return legacy.rows.filter(predicate).length;
}

describe("the snapshot aggregate", () => {
  const summary = summarizeSnapshot(sample);

  test("population and professions agree with the raw rows", () => {
    expect(summary.total).toBe(legacy.rows.length);
    for (let p = 1; p <= 6; p++) {
      expect(summary.byProf[p - 1]).toBe(legacyCount((r) => r[3] === p));
    }
    expect(summary.byProf.reduce((a, b) => a + b, 0)).toBe(summary.total);
  });

  test("the activity buckets are disjoint and sum to the population", () => {
    for (let bucket = 0; bucket < 5; bucket++) {
      expect(summary.act[bucket]).toBe(legacyCount((r) => activityBucketServer(legacyDays(r[5])) === bucket));
    }
    expect(summary.act.reduce((a, b) => a + b, 0)).toBe(summary.total);
  });

  test("accounts never used sit in their own bucket, not among the inactive", () => {
    // `days === null` is an account never used (the ranking shows a date in 1969), not a
    // player absent for a long time — merging the two would inflate "> 30 days".
    expect(summary.act[4]).toBe(legacyCount((r) => legacyDays(r[5]) === null));
    expect(summary.act[4]).toBeGreaterThan(0);
  });

  test("the scraper and the browser bucket identically", () => {
    // Two copies of the same function (src/trends.ts and public/shared.js) — drift would
    // give a history that disagrees with the snapshot view. The list is every value the
    // scraper can produce; the −1 sentinel is not on it, because it appears only during the
    // conversion to typed arrays, i.e. on the browser side alone.
    for (const days of [null, undefined, 0, 1, 7, 8, 30, 31, 365, 20_655]) {
      expect(activityBucketServer(days)).toBe(activityBucketBrowser(days));
    }
  });
});

describe("a world's history", () => {
  const filters = (startedAt: string | undefined, count: number, suspect = false): FilterFile => ({
    schema: 3,
    kind: "filter",
    world: "test",
    timestamp: "t",
    ...(startedAt ? { startedAt } : {}),
    ...(suspect ? { suspect: { reason: "test", previousCount: count * 2, count, drop: 0.5 } } : {}),
    count,
    level: Array.from({ length: count }, () => 10),
    profession: Array.from({ length: count }, () => 1),
    honor: Array.from({ length: count }, () => 0),
    days: Array.from({ length: count }, () => 0),
  });

  test("orders snapshots by startedAt, not by filename", () => {
    // Identifiers from before August 2026 carry local time in the name, so sorting by them
    // would place snapshots from the timezone seam 2 h away from the truth.
    const trend = buildWorldTrend([
      { id: "2026-08-01T09-48-26", filters: filters("2026-08-01T07:48:26.000Z", 2) },
      { id: "2026-07-21T22-04-12", filters: filters("2026-07-21T20:04:12.000Z", 1) },
    ]);
    expect(trend.id).toEqual(["2026-07-21T22-04-12", "2026-08-01T09-48-26"]);
    expect(trend.total).toEqual([1, 2]);
  });

  test("a snapshot without startedAt drops out — there is nowhere to put it on the axis", () => {
    const trend = buildWorldTrend([
      { id: "undated", filters: filters(undefined, 5) },
      { id: "dated", filters: filters("2026-07-21T20:04:12.000Z", 1) },
    ]);
    expect(trend.id).toEqual(["dated"]);
  });

  test("every column has the same length, and suspect carries through", () => {
    const trend = buildWorldTrend([
      { id: "a", filters: filters("2026-07-21T20:04:12.000Z", 1) },
      { id: "b", filters: filters("2026-08-01T07:48:26.000Z", 1, true) },
    ]);
    for (const column of [trend.id, trend.startedAt, trend.total, trend.suspect, ...trend.act, ...trend.byProf]) {
      expect(column).toHaveLength(2);
    }
    expect(trend.suspect).toEqual([0, 1]);
  });
});

const manifest = JSON.parse(await Bun.file(path.join(PUBLIC_DIR, "manifest.json")).text());
const trends = JSON.parse(await Bun.file(path.join(PUBLIC_DIR, "trends.json")).text());

describe("the published trends.json", () => {
  test("covers every world in the manifest, snapshot by snapshot", () => {
    expect(trends.schema).toBe(2);
    expect(Object.keys(trends.worlds)).toHaveLength(manifest.worlds.length);

    for (const world of manifest.worlds) {
      const trend = trends.worlds[world.name];
      const dated = world.files.filter((f: { startedAt?: string }) => f.startedAt);
      expect(trend.id).toEqual(dated.map((f: { id: string }) => f.id));
      expect(trend.startedAt).toEqual(dated.map((f: { startedAt: string }) => f.startedAt));
    }
  });

  test("every world carries the gzip size of its newest snapshot", async () => {
    // The transfer budget spends this number, so a wrong one buys either too much or too
    // little. Measured here from the file rather than copied from the builder — the same
    // compression the browser is served by GitHub Pages.
    for (const world of manifest.worlds) {
      const trend = trends.worlds[world.name];
      const newest = world.files.filter((f: { startedAt?: string }) => f.startedAt).at(-1);
      const raw = await Bun.file(path.join(PUBLIC_DIR, newest.filters)).arrayBuffer();
      expect(trend.bytes).toBe(Bun.gzipSync(new Uint8Array(raw)).length);
      expect(trend.bytes).toBeGreaterThan(0);
    }
  });

  test("every column sums to the population of the same snapshot", () => {
    for (const trend of Object.values(trends.worlds) as any[]) {
      for (let i = 0; i < trend.total.length; i++) {
        expect(trend.act.reduce((s: number, b: number[]) => s + b[i], 0)).toBe(trend.total[i]);
        expect(trend.byProf.reduce((s: number, b: number[]) => s + b[i], 0)).toBe(trend.total[i]);
      }
    }
  });

  test("the numbers agree with the snapshot they came from", async () => {
    // A full recomputation of each world's newest snapshot straight from `.f.json` — the
    // only test that catches drift between what the scraper wrote and what the chart
    // shows.
    for (const world of manifest.worlds) {
      const entry = world.files.at(-1);
      const f = JSON.parse(await Bun.file(path.join(PUBLIC_DIR, entry.filters)).text());
      const trend = trends.worlds[world.name];
      const i = trend.id.indexOf(entry.id);
      expect(i).toBeGreaterThan(-1);

      const expected = summarizeSnapshot(f);
      expect(trend.total[i]).toBe(expected.total);
      expect(trend.act.map((b: number[]) => b[i])).toEqual(expected.act);
      expect(trend.byProf.map((b: number[]) => b[i])).toEqual(expected.byProf);
    }
  });

  test("a large population drop either does not exist or is flagged", () => {
    // A sanity check on real data: if the aggregate counted something other than the
    // snapshot does, neighbouring points would diverge far harder than the real drift of
    // players.
    //
    // A drop > 5% is exactly what `checkPopulationDrop` (the same 0.05 threshold) is meant
    // to detect and **write** with a `suspect` flag. A test forbidding such a snapshot to
    // exist turned the first genuinely truncated scrape into a red build — punishing the
    // behaviour the project decided was correct. So the condition is inverted: it may
    // exist, provided it is flagged.
    //
    // Drops only — `checkPopulationDrop` never flags growth, so a world genuinely gaining
    // players (e.g. `luvia`, +11% between two snapshots) has no invariant to check here.
    for (const [world, trend] of Object.entries(trends.worlds) as [string, any][]) {
      for (let i = 1; i < trend.total.length; i++) {
        const delta = (trend.total[i] - trend.total[i - 1]) / trend.total[i - 1];
        if (delta <= -0.05) {
          expect(`${world}[${i}] suspect=${trend.suspect[i]}`).toBe(`${world}[${i}] suspect=1`);
        }
      }
    }
  });
});

describe("under the default filter the client computes exactly what the server does", () => {
  test("all 202 snapshots, row by row", async () => {
    // The heart of the whole view: history under a filter comes from the same function as
    // history without one. If `summarizeFiltered` rejected even one row differently from
    // `summarizeSnapshot`, the chart would jump on the first filter move — and it would
    // look like a change in the data rather than a bug.
    //
    // A full pass over 64 MB takes ~0.9 s, so there is no reason to check a sample.
    const noFilter = emptyFilters();
    let checked = 0;

    for (const world of manifest.worlds) {
      for (const entry of world.files) {
        const f = JSON.parse(await Bun.file(path.join(PUBLIC_DIR, entry.filters)).text());
        expect(summarizeFiltered(f, noFilter)).toEqual(summarizeSnapshot(f));
        // and the same after the conversion to typed arrays the browser performs
        expect(summarizeFiltered(toTypedSnapshot(f), noFilter)).toEqual(summarizeSnapshot(f));
        checked += 1;
      }
    }
    expect(checked).toBe(manifest.worlds.reduce((s: number, w: any) => s + w.files.length, 0));
    expect(checked).toBeGreaterThan(200);
  });
});

describe("the conversion to typed arrays", () => {
  const raw = {
    count: 5,
    level: [1, 250, 500, 10, 10],
    profession: [1, 2, 3, 4, 6],
    honor: [-35, 0, 1_224_565, 100, -1],
    days: [0, 7, null, 6598, 31],
    suspect: { reason: "test" },
  };

  test("null becomes −1, not zero and not a huge number", () => {
    const typed = toTypedSnapshot(raw);
    expect([...typed.days]).toEqual([0, 7, -1, 6598, 31]);
    expect(typed.suspect).toEqual({ reason: "test" });
  });

  test("no column loses a value to its type", () => {
    const typed = toTypedSnapshot(raw);
    expect([...typed.level]).toEqual(raw.level);
    expect([...typed.profession]).toEqual(raw.profession);
    // honor can be negative and reaches 1.2M — Int16 would clip it
    expect([...typed.honor]).toEqual(raw.honor);
  });

  test("a missing suspect gives null, not undefined", () => {
    expect(toTypedSnapshot({ ...raw, suspect: undefined }).suspect).toBeNull();
  });
});

describe("the activity thresholds are cumulative", () => {
  const aether = trends.worlds.aether;

  test("\"≤ 7 days\" is the < 24h bucket together with 1-7 days", () => {
    const counts = activeCounts(aether, "7d");
    for (let i = 0; i < counts.length; i++) {
      expect(counts[i]).toBe(aether.act[0][i] + aether.act[1][i]);
    }
  });

  test("the numbers agree with the raw `.f.json`, not only with themselves", async () => {
    const entry = manifest.worlds.find((w: { name: string }) => w.name === "aether").files.at(-1);
    const f = JSON.parse(await Bun.file(path.join(PUBLIC_DIR, entry.filters)).text());
    const i = aether.id.indexOf(entry.id);

    const raw = (maxDays: number) =>
      f.days.filter((d: number | null, row: number) => {
        if (d === null || d > maxDays) return false;
        return f.level[row] >= 1 && f.profession[row] >= 1 && f.profession[row] <= 6;
      }).length;

    expect(activeCounts(aether, "24h")[i]).toBe(raw(0));
    expect(activeCounts(aether, "7d")[i]).toBe(raw(7));
    expect(activeCounts(aether, "30d")[i]).toBe(raw(30));
  });

  test("the thresholds grow monotonically and never exceed the population", () => {
    const keys = ACTIVITY_THRESHOLDS.map((t) => t.key);
    const series = keys.map((key) => activeCounts(aether, key));
    for (let i = 0; i < aether.total.length; i++) {
      expect(series[0]![i]).toBeLessThanOrEqual(series[1]![i]!);
      expect(series[1]![i]).toBeLessThanOrEqual(series[2]![i]!);
      expect(series[2]![i]).toBeLessThanOrEqual(aether.total[i]);
    }
  });

  test("an unknown threshold falls back to the default instead of breaking the view", () => {
    expect(activeCounts(aether, "nonsense")).toEqual(activeCounts(aether, DEFAULT_THRESHOLD));
  });

  test("the share is computed against the population of the same snapshot", () => {
    const counts = activeCounts(aether, "7d");
    const share = shareSeries(counts, aether.total);
    expect(share[0]).toBeCloseTo((counts[0]! / aether.total[0]) * 100, 6);
    expect(share.every((s: number) => s >= 0 && s <= 100)).toBe(true);
    // A population of 0 must not produce a NaN on the chart.
    expect(shareSeries([0], [0])).toEqual([0]);
  });
});

describe("the activity filter removes the thresholds that go silent under it", () => {
  // Under an "online ≤ 7 days" filter the set holds nobody past seven days, so the
  // "≤ 7 days" threshold would equal the match count, and "≤ 30 days" likewise.
  test("only thresholds narrower than the filter survive", () => {
    expect(usableThresholds(Infinity).map((t) => t.key)).toEqual(["24h", "7d", "30d"]);
    expect(usableThresholds(30).map((t) => t.key)).toEqual(["24h", "7d"]);
    expect(usableThresholds(14).map((t) => t.key)).toEqual(["24h", "7d"]);
    expect(usableThresholds(7).map((t) => t.key)).toEqual(["24h"]);
    expect(usableThresholds(3).map((t) => t.key)).toEqual(["24h"]);
    expect(usableThresholds(0)).toEqual([]);
  });

  test("the chosen threshold falls back to the nearest one that still says something", () => {
    expect(thresholdByKey("30d", Infinity)!.key).toBe("30d");
    expect(thresholdByKey("30d", 7)!.key).toBe("24h");
    expect(thresholdByKey("7d", 7)!.key).toBe("24h");
    // a filter narrower than every threshold — nothing to show, and the view must cope
    expect(thresholdByKey("24h", 0)).toBeNull();
  });

  test("with no usable threshold, \"active\" is simply everyone matching", () => {
    expect(activeCounts(trends.worlds.aether, "24h", 0)).toEqual(trends.worlds.aether.total);
  });
});

describe("history under a filter", () => {
  const base = {
    id: ["a", "b", "c"],
    startedAt: ["2026-06-01T00:00:00.000Z", "2026-06-11T00:00:00.000Z", "2026-06-21T00:00:00.000Z"],
    total: [100, 110, 120],
    act: [[10, 11, 12], [20, 22, 24], [30, 33, 36], [39, 43, 47], [1, 1, 1]],
    byProf: [[50, 55, 60], [10, 11, 12], [10, 11, 12], [10, 11, 12], [10, 11, 12], [10, 11, 12]],
    suspect: [0, 1, 0],
  };

  const snapshot = (levels: number[]) =>
    toTypedSnapshot({
      count: levels.length,
      level: levels,
      profession: levels.map(() => 1),
      honor: levels.map(() => 0),
      days: levels.map(() => 0),
    });

  test("the default filter returns the aggregate without touching a snapshot", () => {
    // This is the path on which nobody who does not filter pays a byte over 9 KB.
    const result = buildFilteredTrend(base, new Map(), emptyFilters());
    expect(result.trend).toBe(base);
    expect(result.population).toBe(base.total);
    expect(result.loaded).toBe(3);
  });

  test("computes only from loaded snapshots and substitutes nothing for the rest", () => {
    const store = new Map([
      ["a", snapshot([10, 300, 300])],
      ["c", snapshot([300, 300])],
    ]);
    const { trend, population, loaded, expected } = buildFilteredTrend(base, store, {
      ...emptyFilters(),
      minLevel: 200,
    });

    expect(trend.id).toEqual(["a", "c"]); // "b" gets no point rather than an invented one
    expect(trend.total).toEqual([2, 2]);
    expect(trend.startedAt).toEqual([base.startedAt[0], base.startedAt[2]]);
    expect(trend.suspect).toEqual([0, 0]);
    expect(loaded).toBe(2);
    expect(expected).toBe(3);
    // the denominator stays unfiltered — otherwise "share" would sum to 100%
    expect(population).toEqual([100, 120]);
  });

  test("a hole in the history makes a longer interval, not a false jump", () => {
    const store = new Map([
      ["a", snapshot([300])],
      ["c", snapshot([300, 300, 300])],
    ]);
    const { trend } = buildFilteredTrend(base, store, { ...emptyFilters(), minLevel: 200 });
    const rows = changeRows(trend);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.delta).toBe(2);
    expect(rows[0]!.days).toBeCloseTo(20, 6); // a→c, not a→b
    expect(rows[0]!.perDay).toBeCloseTo(0.1, 6);
  });

  test("the snapshot window narrows the history and says how much is left", () => {
    const store = new Map([["b", snapshot([300])], ["c", snapshot([300])]]);
    const { trend, expected } = buildFilteredTrend(
      base,
      store,
      { ...emptyFilters(), minLevel: 200 },
      new Set(["b", "c"]),
    );
    expect(trend.id).toEqual(["b", "c"]);
    expect(expected).toBe(2);
  });

  test("no snapshot at all gives an empty history, not a crash", () => {
    const { trend, loaded } = buildFilteredTrend(base, new Map(), { ...emptyFilters(), minLevel: 200 });
    expect(trend.id).toEqual([]);
    expect(loaded).toBe(0);
    expect(summarize(trend)).toBeNull();
    expect(changeRows(trend)).toEqual([]);
  });
});

describe("the snapshot window", () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}` }));

  test("takes the newest, because those answer \"what is happening now\"", () => {
    const picked = windowedEntries(entries, 5);
    expect(picked.map((e: { id: string }) => e.id)).toEqual(["s15", "s16", "s17", "s18", "s19"]);
  });

  test("a shorter history passes through whole", () => {
    expect(windowedEntries(entries.slice(0, 3), 5)).toHaveLength(3);
    expect(windowedEntries(entries.slice(0, 5), 5)).toHaveLength(5);
  });

  test("an unknown size falls back to the count, rather than to everything", () => {
    // `trends.json` and `history.js` are separate files on Pages with separate cache
    // lifetimes, so a fresh script can meet an aggregate built before `bytes` existed.
    // Treating that as "free" would hand somebody gordion's whole history unasked.
    expect(budgetedEntries(entries, 0)).toHaveLength(HISTORY_WINDOW);
    expect(budgetedEntries(entries, undefined)).toHaveLength(HISTORY_WINDOW);
  });
});

describe("the transfer budget", () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}` }));

  test("buys the newest snapshots it can afford", () => {
    // 200 KB apiece against 2 MiB: ten fit, and they are the ten newest.
    const picked = budgetedEntries(entries, 200 * 1024);
    expect(picked).toHaveLength(10);
    expect(picked.at(-1)).toEqual({ id: "s19" });
    expect(picked[0]).toEqual({ id: "s10" });
  });

  test("a cheap world is never trimmed", () => {
    // Brutal, priced as it really is: the whole history costs less than the budget.
    expect(budgetedEntries(entries, 20 * 1024)).toHaveLength(20);
  });

  test("two points at the minimum, even when they do not fit", () => {
    // One dot is not a trend, and the snapshot view above already answers "how many are
    // there now". A single snapshot too big for the budget would leave the chart saying
    // nothing at all.
    expect(budgetedEntries(entries, 5 * 1024 * 1024)).toHaveLength(2);
  });

  test("the ceiling falls on the world that actually costs something", () => {
    // The point of the whole thing, against real sizes: gordion is trimmed, brutal is not,
    // even though brutal has MORE snapshots. A count-based window did the exact opposite.
    const fits = (world: string) =>
      budgetedEntries(
        trends.worlds[world].id.map((id: string) => ({ id })),
        trends.worlds[world].bytes,
      ).length;

    expect(trends.worlds.brutal.id.length).toBeGreaterThanOrEqual(trends.worlds.gordion.id.length);
    expect(fits("gordion")).toBeLessThan(trends.worlds.gordion.id.length);
    expect(fits("brutal")).toBe(trends.worlds.brutal.id.length);
    expect(trends.worlds.gordion.bytes * fits("gordion")).toBeLessThanOrEqual(HISTORY_BUDGET_BYTES);
  });
});

describe("fetching the history", () => {
  const entries = (world: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `${world}-${i}`, filters: `worlds/${world}/${i}.f.json` }));

  const fakeSnapshot = { count: 1, level: [10], profession: [1], honor: [0], days: [0] };

  async function withFetch(impl: (url: string) => Promise<any>, run: () => Promise<void>) {
    const original = globalThis.fetch;
    globalThis.fetch = impl as any;
    try {
      await run();
    } finally {
      globalThis.fetch = original;
    }
  }

  test("fetches the full set and reports progress after every snapshot", async () => {
    const seen: number[] = [];
    await withFetch(
      async () => ({ ok: true, status: 200, json: async () => fakeSnapshot }),
      async () => {
        const list = entries("w1", 7);
        const { failed } = await loadHistory("w1", list, {
          onProgress: (loaded: number) => seen.push(loaded),
        });
        expect(failed).toEqual([]);
        expect(loadedCount(cachedSnapshots("w1"), list)).toBe(7);
        expect(seen.at(-1)).toBe(7);
        expect(seen).toHaveLength(7);
      },
    );
  });

  test("a second call fetches nothing — the snapshots are already in memory", async () => {
    let calls = 0;
    await withFetch(
      async () => {
        calls += 1;
        return { ok: true, status: 200, json: async () => fakeSnapshot };
      },
      async () => {
        const list = entries("w2", 4);
        await loadHistory("w2", list, {});
        expect(calls).toBe(4);
        await loadHistory("w2", list, {});
        expect(calls).toBe(4);
      },
    );
  });

  test("one broken response does not take down the whole history", async () => {
    await withFetch(
      async (url: string) =>
        url.endsWith("2.f.json")
          ? { ok: false, status: 500, json: async () => ({}) }
          : { ok: true, status: 200, json: async () => fakeSnapshot },
      async () => {
        const list = entries("w3", 5);
        const { failed } = await loadHistory("w3", list, {});
        expect(failed).toEqual(["w3-2"]);
        expect(loadedCount(cachedSnapshots("w3"), list)).toBe(4);
      },
    );
  });

  test("switching worlds abandons the work instead of feeding a dead view", async () => {
    await withFetch(
      async () => ({ ok: true, status: 200, json: async () => fakeSnapshot }),
      async () => {
        const list = entries("w4", 8);
        let stale = false;
        await loadHistory("w4", list, {
          concurrency: 1,
          isStale: () => stale,
          onProgress: (loaded: number) => {
            if (loaded >= 2) stale = true;
          },
        });
        expect(loadedCount(cachedSnapshots("w4"), list)).toBeLessThan(8);
      },
    );
  });

  test("memory holds at most two worlds — without it a tab collects all 21", () => {
    cachedSnapshots("cache-a").set("x", {} as any);
    cachedSnapshots("cache-b").set("x", {} as any);
    cachedSnapshots("cache-c").set("x", {} as any);
    expect(cachedSnapshots("cache-b").size).toBe(1);
    expect(cachedSnapshots("cache-c").size).toBe(1);
    // "cache-a" was evicted, so we get a fresh, empty map
    expect(cachedSnapshots("cache-a").size).toBe(0);
  });
});

describe("changes between snapshots", () => {
  const aether = trends.worlds.aether;

  test("the delta is divided by the real interval, not per snapshot", () => {
    // The intervals run 3-17 days, so "−120 players" on two rows of the table means two
    // different things until it is divided by time.
    const rows = changeRows(aether);
    expect(rows).toHaveLength(aether.id.length - 1);

    for (const [i, row] of rows.entries()) {
      expect(row.delta).toBe(aether.total[i + 1] - aether.total[i]);
      const expectedDays =
        (new Date(aether.startedAt[i + 1]).getTime() - new Date(aether.startedAt[i]).getTime()) / 86_400_000;
      expect(row.days).toBeCloseTo(expectedDays, 6);
      expect(row.perDay).toBeCloseTo(row.delta / expectedDays, 6);
    }
  });

  test("the intervals in this data really are uneven", () => {
    const days = changeRows(aether).map((r) => r.days!);
    expect(Math.max(...days) - Math.min(...days)).toBeGreaterThan(3);
  });

  test("a world with a single snapshot gives an empty table, not an error", () => {
    const single = { id: ["a"], startedAt: ["2026-08-04T10:45:20.548Z"], total: [39087], act: [[1], [1], [1], [1], [1]], byProf: [[1], [1], [1], [1], [1], [1]], suspect: [0] };
    expect(changeRows(single)).toEqual([]);
    expect(summarize(single)).toMatchObject({ snapshots: 1, delta: 0, days: 0 });
  });
});

describe("the history summary", () => {
  test("measures the change from the first snapshot to the last", () => {
    const fobos = trends.worlds.fobos;
    const s = summarize(fobos)!;
    expect(s.total).toBe(fobos.total.at(-1));
    expect(s.delta).toBe(fobos.total.at(-1) - fobos.total[0]);
    expect(s.percent).toBeCloseTo((s.delta / fobos.total[0]) * 100, 6);
    expect(s.snapshots).toBe(fobos.total.length);
    // fobos is the fastest-emptying world — the signal this view was built for
    expect(s.delta).toBeLessThan(0);
  });
});

describe("the view state in the URL", () => {
  test("the default view puts nothing in the link beyond the world", () => {
    expect(viewToParams({ world: "aether", threshold: DEFAULT_THRESHOLD, share: false }).toString()).toBe(
      "world=aether",
    );
  });

  test("a full set of settings survives the round trip", () => {
    const view = { world: "gordion", date: "2026-08-04T10-02-40", threshold: "30d", share: true };
    expect(viewFromParams(new URLSearchParams(viewToParams(view).toString()))).toEqual(view);
  });

  test("junk in the URL does not break the view", () => {
    expect(viewFromParams(new URLSearchParams("prog=xyz&udzial=nie"))).toEqual({
      world: null,
      date: null,
      threshold: DEFAULT_THRESHOLD,
      share: false,
    });
  });

  test("the view state and the filter state do not collide on keys", () => {
    // The promise that links to the old trends.html still work hangs on this: one page
    // reads both sets of parameters at once.
    const viewKeys = [...viewToParams({ world: "a", date: "b", threshold: "30d", share: true }).keys()];
    expect(viewKeys.sort()).toEqual(["date", "prog", "udzial", "world"]);
    for (const key of viewKeys) {
      expect(["minLevel", "maxLevel", "minHonor", "maxHonor", "maxDays", "prof"]).not.toContain(key);
    }
  });
});

const trendsHtml = await Bun.file(path.join(PUBLIC_DIR, "trends.html")).text();

describe("the old trends page stays as a redirect", () => {
  test("carries the query string across, so shared links keep working", () => {
    expect(trendsHtml).toContain('"index.html" + location.search');
    expect(trendsHtml).toContain("location.replace(target)");
    expect(trendsHtml).toContain('href="index.html"');
  });

  test("no longer loads the charts or the view module", () => {
    expect(trendsHtml).not.toContain("chart.umd.min.js");
    expect(trendsHtml).not.toContain("trends.js");
  });
});
