import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeLegacyRows, splitNormalized } from "@/src/snapshot.ts";
import {
  getActivityLabel,
  countByActivity,
  countByLevel,
  describeFilters,
  getEmptyFilters,
  readFiltersFromParams,
  composeFiltersParams,
  isDefaultFilters,
  getTotalsFromCounts,
  getVisibleActivityBuckets,
} from "@/public/filters.js";
import { getActivityBucket, getDaysBetween, formatSnapshotDate, isNeverOnline } from "@/public/shared.js";
import { stripComments } from "@/test/source-text.ts";

// The reference is a sample of a real snapshot in the old v1 schema
// (test/fixtures/legacy-snapshot-aether.json — every 12th row of the original, so it
// covers the whole distribution: levels 1-378, honor 0-744k, accounts never used).
//
// The test puts it through the production migration, then compares every filter against
// a count taken straight from the original rows. That way it checks at once that the
// migration loses nothing and that the view counts exactly.

const PUBLIC_DIR = path.resolve(import.meta.dir, "../public");

const legacy = JSON.parse(
  await Bun.file(path.join(import.meta.dir, "fixtures/legacy-snapshot-aether.json")).text(),
);
const { filters: data, names } = splitNormalized(normalizeLegacyRows(legacy), {
  world: "aether",
  timestamp: "2026-07-21T22-04-12",
});

function legacyDays(text: string): number | null {
  const t = String(text);
  if (t.includes("24h")) return 0;
  const n = Number(t.match(/(\d+)/)?.[1]);
  return n >= 10_000 ? null : n;
}

function filters(overrides: Record<string, unknown> = {}) {
  return { ...getEmptyFilters(), ...overrides };
}

function total(counts: Map<number, number[]>) {
  return getTotalsFromCounts(counts).total;
}

function legacyCount(predicate: (row: any[]) => boolean) {
  return legacy.rows.filter(predicate).length;
}

describe("migration to the split format", () => {
  test("neither loses nor invents rows", () => {
    expect(data.count).toBe(legacy.rows.length);
    expect(names.count).toBe(legacy.rows.length);
    for (const column of [data.level, data.profession, data.honor, data.days]) {
      expect(column).toHaveLength(data.count);
    }
  });

  test("every row keeps all of its values", () => {
    for (let i = 0; i < legacy.rows.length; i++) {
      const r = legacy.rows[i];
      expect(names.name[i]).toBe(r[1]);
      expect(data.level[i]).toBe(r[2]);
      expect(data.profession[i]).toBe(r[3]);
      expect(data.honor[i]).toBe(r[4]);
      expect(data.days[i]).toBe(legacyDays(r[5]));
    }
  });

  test("accounts never used carry null instead of a date in 1969", () => {
    const never = data.days.filter((d) => d === null).length;
    expect(never).toBeGreaterThan(0);
    expect(never).toBe(legacyCount((r) => Number(String(r[5]).match(/(\d+)/)?.[1]) >= 10_000));
  });
});

describe("filtering — always exact", () => {
  test("with no filters the whole population is visible", () => {
    expect(total(countByLevel(data, filters()))).toBe(legacy.rows.length);
  });

  test("the distribution across professions", () => {
    const perProfession = getTotalsFromCounts(countByLevel(data, filters())).perProfession;
    for (let p = 1; p <= 6; p++) {
      expect(perProfession[p - 1]).toBe(legacyCount((r) => r[3] === p));
    }
  });

  test("a range of levels", () => {
    const counts = countByLevel(data, filters({ minLevel: 200, maxLevel: 250 }));
    expect(total(counts)).toBe(legacyCount((r) => r[2] >= 200 && r[2] <= 250));
    expect([...counts.keys()].every((l) => l >= 200 && l <= 250)).toBe(true);
  });

  test("a range of honor — exact, no buckets", () => {
    expect(total(countByLevel(data, filters({ minHonor: 100_000 })))).toBe(legacyCount((r) => r[4] >= 100_000));
    expect(total(countByLevel(data, filters({ minHonor: 1, maxHonor: 999 })))).toBe(
      legacyCount((r) => r[4] >= 1 && r[4] <= 999),
    );
    // a value that sits on no bucket boundary
    expect(total(countByLevel(data, filters({ minHonor: 4137 })))).toBe(legacyCount((r) => r[4] >= 4137));
  });

  test("the activity threshold — any number of days, not only a preset", () => {
    for (const maxDays of [0, 1, 5, 13, 47, 365]) {
      const expected = legacyCount((r) => {
        const d = legacyDays(r[5]);
        return d !== null && d <= maxDays;
      });
      expect(total(countByLevel(data, filters({ maxDays })))).toBe(expected);
    }
  });

  test("the filters compose", () => {
    const f = filters({ minLevel: 250, maxLevel: 320, minHonor: 100, maxDays: 30, professions: new Set([1, 4]) });
    const expected = legacyCount((r) => {
      const d = legacyDays(r[5]);
      return r[2] >= 250 && r[2] <= 320 && r[4] >= 100 && d !== null && d <= 30 && (r[3] === 1 || r[3] === 4);
    });
    expect(total(countByLevel(data, f))).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });

  test("mutually exclusive filters give emptiness, not a crash", () => {
    expect(total(countByLevel(data, filters({ minLevel: 9000 })))).toBe(0);
    expect(total(countByLevel(data, filters({ professions: new Set() })))).toBe(0);
  });
});

describe("an account never used falls out of every threshold", () => {
  // The nastiest trap of typed arrays: we store `null` as −1, and `−1 > maxDays` is false.
  // A filter that asks about the threshold first would let accounts never used into every
  // activity threshold — the opposite of what the data says.
  const withSentinel = {
    count: 4,
    level: Int16Array.from([10, 10, 10, 10]),
    profession: Uint8Array.from([1, 1, 1, 1]),
    honor: Int32Array.from([0, 0, 0, 0]),
    days: Int32Array.from([0, 5, 40, -1]),
  };

  test("both representations of \"never\" mean the same thing", () => {
    expect(isNeverOnline(null)).toBe(true);
    expect(isNeverOnline(undefined)).toBe(true);
    expect(isNeverOnline(-1)).toBe(true);
    expect(isNeverOnline(0)).toBe(false);
    expect(getActivityBucket(-1)).toBe(4);
    expect(getActivityBucket(null)).toBe(4);
  });

  test("the −1 sentinel does not pass a threshold, even though it is below every one", () => {
    for (const maxDays of [0, 1, 7, 30, 365, 100_000]) {
      expect(total(countByLevel(withSentinel, filters({ maxDays })))).toBe(
        [0, 5, 40].filter((d) => d <= maxDays).length,
      );
    }
    // with no threshold everyone gets in, the account never used included
    expect(total(countByLevel(withSentinel, filters()))).toBe(4);
  });

  test("an account never used sits in the \"never\" bucket, not among > 30 days", () => {
    const buckets = new Map<number, number>(
      countByActivity(withSentinel, filters()).map(([b, c]: number[]) => [b as number, c as number]),
    );
    expect(buckets.get(4)).toBe(1);
    expect(buckets.get(3)).toBe(1);
  });
});

describe("the activity distribution", () => {
  test("agrees with the raw data and sums to the population", () => {
    const buckets = countByActivity(data, filters());
    expect(buckets.reduce((s, [, c]) => s + c, 0)).toBe(legacy.rows.length);

    for (const [bucket, count] of buckets) {
      expect(count).toBe(legacyCount((r) => getActivityBucket(legacyDays(r[5])) === bucket));
    }
  });

  test("stays exact under a level filter too (the aggregate could not)", () => {
    const f = filters({ minLevel: 100, maxLevel: 200 });
    const buckets = countByActivity(data, f);
    expect(buckets.reduce((s, [, c]) => s + c, 0)).toBe(legacyCount((r) => r[2] >= 100 && r[2] <= 200));
  });

  test.each([
    [null, 4],
    [0, 0],
    [7, 1],
    [8, 2],
    [30, 2],
    [31, 3],
  ] as const)("getActivityBucket(%p) → %p", (days, bucket) => {
    expect(getActivityBucket(days)).toBe(bucket);
  });
});

const manifest = JSON.parse(await Bun.file(path.join(PUBLIC_DIR, "manifest.json")).text());

describe("the published data", () => {
  test("every manifest entry points at a filter file that exists", async () => {
    expect(manifest.worlds.length).toBeGreaterThan(0);
    for (const world of manifest.worlds) {
      expect(world.files.length).toBeGreaterThan(0);
      for (const entry of world.files) {
        expect(entry.filters).toMatch(/\.f\.json$/);
        expect(await Bun.file(path.join(PUBLIC_DIR, entry.filters)).exists()).toBe(true);
      }
    }
  });

  test("each world's newest snapshot is internally consistent", async () => {
    for (const world of manifest.worlds) {
      const entry = world.files.at(-1);
      const f = JSON.parse(await Bun.file(path.join(PUBLIC_DIR, entry.filters)).text());

      expect(f.world).toBe(world.name);
      expect(f.count).toBeGreaterThan(0);
      expect(f.level).toHaveLength(f.count);
      expect(f.profession).toHaveLength(f.count);
      expect(f.honor).toHaveLength(f.count);
      expect(f.days).toHaveLength(f.count);
      expect(f.level.every((l: number) => Number.isInteger(l) && l > 0)).toBe(true);
      expect(f.profession.every((p: number) => p >= 1 && p <= 6)).toBe(true);
      // honor can be negative — confirmed against the live ranking (zorza, "lape", PH -20)
      expect(f.honor.every((h: number) => Number.isInteger(h))).toBe(true);
      expect(f.days.every((d: number | null) => d === null || (Number.isInteger(d) && d >= 0))).toBe(true);

      const n = JSON.parse(await Bun.file(path.join(PUBLIC_DIR, entry.names)).text());
      expect(n.count).toBe(f.count);
      expect(n.name).toHaveLength(f.count);
      expect(n.name.every((name: string) => name.length > 0)).toBe(true);
    }
  });
});

const html = await Bun.file(path.join(PUBLIC_DIR, "index.html")).text();
const js = await Bun.file(path.join(PUBLIC_DIR, "app.js")).text();
const sharedJs = await Bun.file(path.join(PUBLIC_DIR, "shared.js")).text();
const filtersJs = await Bun.file(path.join(PUBLIC_DIR, "filters.js")).text();
const historyJs = await Bun.file(path.join(PUBLIC_DIR, "history.js")).text();
const trendsHtml = await Bun.file(path.join(PUBLIC_DIR, "trends.html")).text();

describe("app.js agrees with index.html", () => {
  test("every element fetched through getElement() exists in the markup", () => {
    const ids = [...js.matchAll(/\bgetElement\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(10);
    for (const id of new Set(ids)) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  test("the page loads the module and a local Chart.js instead of a CDN", () => {
    expect(html).toContain('<script type="module" src="app.js">');
    expect(html).toContain('src="vendor/chart.umd.min.js"');

    // What matters is the absence of external resources, not the absence of the word
    // "cdn" — a CDN address may appear in a comment explaining how to update.
    for (const markup of [html, trendsHtml]) {
      const external = [...markup.matchAll(/<(?:script|link)[^>]*\s(?:src|href)="([^"]+)"/g)]
        .map((m) => m[1]!)
        .filter((url) => /^(https?:)?\/\//.test(url));
      expect(external).toEqual([]);
    }
  });

  test("the view does not reach for the nicknames", () => {
    // `.n.json` has no consumer today, and until a player search exists, fetching it
    // would be two thirds of the transfer for nothing.
    expect(js).toContain("entry.filters");
    expect(js).not.toContain("entry.names");
  });

  test("fetches the aggregate and the snapshots, and nothing from outside the directory", () => {
    // The list of URLs written into the code is to stay closed: no external dependency, no
    // second aggregate. Every fetch goes through `getJsonFromUrl`, so this reads the calls
    // to it rather than the calls to `fetch` — the reason the wrapper exists is that the
    // four call sites were doing the same three steps four ways (§9.5).
    const literals = [...js.matchAll(/getJsonFromUrl\(\s*["'`]([^"'`]+)/g)].map((m) => m[1]);
    expect(literals.sort()).toEqual(["manifest.json", "trends.json"]);

    // The remaining URLs come from the manifest, not from the code.
    expect(historyJs).toContain("getJsonFromUrl(entry.filters)");
    expect(js).toContain("getJsonFromUrl(entry.filters)");

    // And `fetch` itself is spelled in exactly one place, which is what makes the line
    // above a complete list rather than a sample of one.
    const fetchJs = readFileSync(path.join(repo, "public/fetch-json.js"), "utf8");
    expect(stripComments(fetchJs)).toContain("await fetch(url)");
    for (const module of [js, historyJs, filtersJs, sharedJs]) {
      expect(stripComments(module)).not.toMatch(/[^.\w]fetch\(/);
    }
  });
});

describe("app.js asks index.html for the right kind of node", () => {
  // `field()` answers an HTMLInputElement | HTMLSelectElement, and app.js says in its
  // docblock that the pairing is proved here rather than asserted at every call. That
  // sentence is only true while this test exists — asking a `<div>` for `.value` is silent
  // in a browser and would have been silent under checkJs too, since the cast is ours.
  const ids = [...js.matchAll(/\bfield\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]!);

  test("the view really reads form controls through it", () => {
    expect(new Set(ids).size).toBeGreaterThan(5);
  });

  test("every id it asks for is an <input> or a <select> in the markup", () => {
    const offenders: string[] = [];
    for (const id of new Set(ids)) {
      // The tag that carries this id, whatever it is.
      const tag = new RegExp(`<(\\w+)[^>]*\\bid="${id}"`).exec(html)?.[1];
      if (tag !== "input" && tag !== "select") offenders.push(`#${id} is <${tag ?? "nothing"}>`);
    }
    expect(offenders.sort()).toEqual([]);
  });

  test("getElement() is not used for a value — that is what the split is for", () => {
    expect(stripComments(js)).not.toMatch(/\bgetElement\([^)]*\)\.(value|checked|disabled)\b/);
  });
});

describe("the pure modules must not run anything", () => {
  // Comments are stripped, because the test is to hold the code and not the prose: the
  // paragraph explaining why a module does not reach for `document` contains that word.
  const code = stripComments;

  test("the counting logic does not touch the DOM", () => {
    // app.js starts the view as soon as it loads, so if a pure module imported anything
    // from it, the tests could not be run outside a browser.
    for (const module of [sharedJs, filtersJs, historyJs]) {
      expect(code(module)).not.toMatch(/\bdocument\b|\bwindow\b/);
      expect(module).not.toContain('from "./app.js"');
    }
    expect(js).toContain('from "./shared.js"');
    expect(js).toContain('from "./filters.js"');
    expect(js).toContain('from "./history.js"');
  });
});

describe("snapshot time", () => {
  // A snapshot's identifier is not a date: until July 2026 it came from the scraper's
  // local time, afterwards from UTC. The same hour in the name means different things on
  // either side of that seam.
  const old = { id: "2026-07-21T22-19-42", startedAt: "2026-07-21T20:19:42.806Z" };
  const recent = { id: "2026-08-01T07-48-26", startedAt: "2026-08-01T07:48:26.850Z" };

  test("the date comes from startedAt, not from the filename", () => {
    // 20:19 UTC is 22:19 in Warsaw — for the old snapshot the name and the date coincide
    // only by accident, for the new one they diverge by 2 h.
    const asDate = (e: { startedAt: string }) => new Date(e.startedAt);
    expect(formatSnapshotDate(old)).toBe(
      `21.07.2026 ${String(asDate(old).getHours()).padStart(2, "0")}:19`,
    );
    expect(formatSnapshotDate(recent)).toBe(
      `01.08.2026 ${String(asDate(recent).getHours()).padStart(2, "0")}:48`,
    );
  });

  test("an interval measured from the filenames would miss the truth", () => {
    const actual = getDaysBetween(old, recent)!;
    expect(actual).toBeCloseTo(10.48, 2);

    const fromFilenames =
      (new Date("2026-08-01T07:48:26Z").getTime() - new Date("2026-07-21T22:19:42Z").getTime()) / 86_400_000;
    expect(Math.abs(actual - fromFilenames)).toBeCloseTo(2 / 24, 3); // exactly the timezone
  });

  test("without startedAt the date is marked as approximate", () => {
    expect(formatSnapshotDate({ id: "2026-04-17T15-24-07" })).toBe("17.04.2026 15:24 (?)");
    expect(formatSnapshotDate({ id: "nonsense" })).toBe("nonsense");
    expect(getDaysBetween({ id: "a" }, recent)).toBeNull();
  });
});

describe("the filter state in the URL", () => {
  test("the default view puts nothing in the link", () => {
    expect(composeFiltersParams(getEmptyFilters()).toString()).toBe("");
  });

  test("a full set of filters survives the round trip", () => {
    const f = {
      minLevel: 250,
      maxLevel: 320,
      minHonor: -30,
      maxHonor: 100_000,
      maxDays: 14,
      professions: new Set([1, 4]),
    };
    const restored = readFiltersFromParams(new URLSearchParams(composeFiltersParams(f).toString()));
    expect(restored).toEqual(f);
  });

  test("an empty URL gives the default filters", () => {
    expect(readFiltersFromParams(new URLSearchParams())).toEqual(getEmptyFilters());
  });

  test("junk in the URL does not break the view", () => {
    const f = readFiltersFromParams(new URLSearchParams("minLevel=abc&maxDays=-5&prof=9,x"));
    expect(f).toEqual(getEmptyFilters());
  });

  test("filters from the URL give the same result as filters set by hand", () => {
    const f = readFiltersFromParams(new URLSearchParams("minLevel=200&maxLevel=250&prof=1,4"));
    const expected = legacyCount(
      (r) => r[2] >= 200 && r[2] <= 250 && (r[3] === 1 || r[3] === 4),
    );
    expect(total(countByLevel(data, f))).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });

  test("\"the default filter\" recognises exactly the filters that reject nothing", () => {
    // The whole lazy path hangs on this: under the default filter the history comes from
    // a 9 KB aggregate rather than from megabytes of raw snapshots.
    expect(isDefaultFilters(getEmptyFilters())).toBe(true);
    expect(isDefaultFilters(readFiltersFromParams(new URLSearchParams()))).toBe(true);
    expect(isDefaultFilters(readFiltersFromParams(new URLSearchParams("prof=1,2,3,4,5,6")))).toBe(true);

    expect(isDefaultFilters(filters({ minLevel: 1 }))).toBe(false);
    expect(isDefaultFilters(filters({ maxDays: 30 }))).toBe(false);
    expect(isDefaultFilters(filters({ minHonor: 0 }))).toBe(false);
    expect(isDefaultFilters(filters({ professions: new Set([1, 2, 3, 4, 5]) }))).toBe(false);
  });
});

describe("describing the active filters", () => {
  // The pl-PL thousands separator is a non-breaking space — we compare without whitespace.
  const flat = (s: string) => s.replace(/\s/g, "");
  const labels = (overrides: Record<string, unknown>) => describeFilters(filters(overrides)).map((c) => flat(c.label));
  const keys = (overrides: Record<string, unknown>) => describeFilters(filters(overrides)).map((c) => c.key);

  test("the default filter has nothing to describe", () => {
    expect(describeFilters(getEmptyFilters())).toEqual([]);
  });

  test("open and closed ranges read differently", () => {
    expect(labels({ minLevel: 250 })).toEqual(["Poziom≥250"]);
    expect(labels({ maxLevel: 400 })).toEqual(["Poziom≤400"]);
    expect(labels({ minLevel: 250, maxLevel: 400 })).toEqual(["Poziom250-400"]);
    expect(labels({ maxHonor: 50_000 })).toEqual(["Honor≤50000"]);
    // honor can be negative — the label must not lose that
    expect(labels({ minHonor: -35 })).toEqual(["Honor≥-35"]);
  });

  test("the activity threshold inflects and knows \"< 24h\"", () => {
    expect(labels({ maxDays: 0 })).toEqual(["Online<24h"]);
    expect(labels({ maxDays: 1 })).toEqual(["Online≤1dzień"]);
    expect(labels({ maxDays: 14 })).toEqual(["Online≤14dni"]);
  });

  test("professions: names up to two, then just the count", () => {
    expect(labels({ professions: new Set([2, 3]) })).toEqual(["Mag,Paladyn"]);
    expect(labels({ professions: new Set([1, 2, 3, 4]) })).toEqual(["4z6profesji"]);
    expect(labels({ professions: new Set() })).toEqual(["Żadnaprofesja"]);
    // all six professions is no filter at all, not a "6 of 6" chip
    expect(labels({ professions: new Set([1, 2, 3, 4, 5, 6]) })).toEqual([]);
  });

  test("a chip's key names a group of fields, not a single field", () => {
    // "Poziom 250-400" is one thing to the reader, though two <input>s to the code.
    expect(keys({ minLevel: 250, maxLevel: 400 })).toEqual(["level"]);
    expect(keys({ minHonor: 1, maxHonor: 2, maxDays: 7, professions: new Set([1]) })).toEqual([
      "honor",
      "days",
      "prof",
    ]);
  });

  test("the number of chips agrees with what makes a filter non-default", () => {
    // The "Filtry (N)" counter in the bar rests on this equivalence.
    const f = filters({ minLevel: 250, maxHonor: 50_000, maxDays: 14, professions: new Set([2, 3]) });
    expect(describeFilters(f)).toHaveLength(4);
    expect(isDefaultFilters(f)).toBe(false);
    expect(describeFilters(getEmptyFilters()).length === 0).toBe(isDefaultFilters(getEmptyFilters()));
  });
});

describe("the activity distribution labels", () => {
  test("with no filter they describe disjoint ranges, not running totals", () => {
    // "≤ 7 dni" over the 1-7 bucket suggested it was everyone from the last week.
    expect(getVisibleActivityBuckets(Infinity).map((b) => getActivityLabel(b))).toEqual([
      "< 24h",
      "1-7 dni",
      "8-30 dni",
      "> 30 dni",
      "nigdy",
    ]);
  });

  test("the threshold trims the label of the bucket it falls in", () => {
    expect(getVisibleActivityBuckets(14).map((b) => getActivityLabel(b, 14))).toEqual(["< 24h", "1-7 dni", "8-14 dni"]);
    expect(getVisibleActivityBuckets(3).map((b) => getActivityLabel(b, 3))).toEqual(["< 24h", "1-3 dni"]);
    expect(getVisibleActivityBuckets(60).map((b) => getActivityLabel(b, 60))).toEqual([
      "< 24h",
      "1-7 dni",
      "8-30 dni",
      "31-60 dni",
    ]);
  });

  test("under a threshold we hide the buckets that are empty by definition", () => {
    // "> 30 dni: 0 · nigdy: 0" looked like broken data
    expect(getVisibleActivityBuckets(0)).toEqual([0]);
    expect(getVisibleActivityBuckets(14)).not.toContain(3);
    expect(getVisibleActivityBuckets(14)).not.toContain(4);
    expect(getVisibleActivityBuckets(60)).not.toContain(4);
  });

  test("the numbers under the labels match the range those labels describe", () => {
    const f = filters({ maxDays: 14 });
    const buckets = new Map<number, number>(
      countByActivity(data, f).map(([bucket, count]: number[]) => [bucket as number, count as number]),
    );
    const visible = getVisibleActivityBuckets(14);
    // Read once with an assertion rather than three times with a `!`: the length is checked
    // at the end of this test, so a short list is a failure of the subject, not of indexing.
    const [first, second, third] = visible as [number, number, number];

    expect(buckets.get(first)).toBe(legacyCount((r) => legacyDays(r[5]) === 0));
    expect(buckets.get(second)).toBe(legacyCount((r) => {
      const d = legacyDays(r[5]);
      return d !== null && d >= 1 && d <= 7;
    }));
    expect(buckets.get(third)).toBe(legacyCount((r) => {
      const d = legacyDays(r[5]);
      return d !== null && d >= 8 && d <= 14;
    }));
    expect(visible).toHaveLength(3);
  });

  test("\"1 dzień\" inflects correctly", () => {
    expect(getActivityLabel(1, 1)).toBe("1 dzień");
  });
});

// ── The view as a whole ─────────────────────────────────────────────────────
//
// The DOM layer put through a stub in a separate process (test/dom-smoke.ts).
// Two scenarios, because the view has two data paths and only together do they cover
// both: the default filter (history from trends.json) and a filter set (history from
// `.f.json`).

const repo = path.resolve(import.meta.dir, "..");
const smoke = (scenario: string) => {
  const proc = Bun.spawnSync(["bun", path.join(repo, "test/dom-smoke.ts"), scenario], { cwd: repo });
  return {
    proc,
    out: proc.exitCode === 0 && proc.stdout.length > 0 ? JSON.parse(proc.stdout.toString()) : null,
  };
};

describe("the view comes together — the default filter", () => {
  const { proc, out } = smoke("default");

  test("the render goes through without an exception", () => {
    expect(proc.stderr.toString()).toBe("");
    expect(proc.exitCode).toBe(0);
    expect(out.error).toBe("");
    expect(out.professionCheckboxes).toBe(6);
  });

  test("the snapshot view shows the whole snapshot, because the filter rejects nothing", () => {
    expect(out.matched).toBeGreaterThan(0);
    expect(out.levels).toBeGreaterThan(0);
    expect(out.matchLine).toMatch(/\(100,0%\)/);
    expect(out.suspectHidden).toBe(true);
  });

  test("the history comes from the aggregate and fetches no snapshot", () => {
    // The path nobody who does not filter pays for: 9 KB instead of 1.9 MB.
    expect(out.charts.popChart.title).toBe("Populacja świata w czasie");
    expect(out.charts.popChart.label).toBe("Populacja");
    expect(out.partialNoteHidden).toBe(true);
    expect(out.historyStatus).toMatch(/^\d+ migawek$/);
  });

  test("every chart gets points placed in time, not in snapshot order", () => {
    for (const [id, expectedSeries] of [["popChart", 1], ["actChart", 1], ["profChart", 6]] as const) {
      expect(out.charts[id].series).toBe(expectedSeries);
      expect(out.charts[id].points).toBe(out.charts.popChart.points);
    }
    // The X axis in epoch milliseconds — otherwise 3-17 day intervals would look equal.
    expect(out.charts.popChart.firstX).toBeGreaterThan(0);
  });

  test("the summary and the table show real numbers", () => {
    // The change is computed from the published aggregate rather than hard-coded: "−5,3%"
    // was taken from today's fobos data, and the first `bun run scrape` turned that into
    // red CI on a data commit.
    const fobos = JSON.parse(readFileSync(path.join(PUBLIC_DIR, "trends.json"), "utf8")).worlds.fobos;
    const percent = ((fobos.total.at(-1) - fobos.total[0]) / fobos.total[0]) * 100;
    const sign = percent > 0 ? "+" : percent < 0 ? "−" : "";
    const formatted = Math.abs(percent).toLocaleString("pl-PL", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });

    expect(out.summary).toContain(`${sign}${formatted}%`);
    expect(percent).toBeLessThan(0); // fobos empties fastest of them all
    expect(out.tableRows).toBe(out.charts.popChart.points); // the header + n-1 change rows
    expect(out.tableHidden).toBe(false); // it is hidden only when there are no rows
    expect(out.singlePointHidden).toBe(true);
    expect(out.suspectNoteHidden).toBe(true);
  });

  test("the numbers are Polish, with no mixing of comma and full stop", () => {
    // Dates carry full stops by definition — we check fractions, not 04.08.2026.
    const fractions = (s: string) => s.replace(/\d{2}\.\d{2}\.\d{4}/g, "");
    expect(fractions(out.summary)).not.toMatch(/\d\.\d/);
    expect(fractions(out.table)).not.toMatch(/\d\.\d/);
    expect(out.table).toMatch(/\d,\d/);
  });

  test("switching the threshold and the scale recomputes the chart rather than making a new one", () => {
    expect(out.afterToggle.title).toBe("Udział aktywnych < 24h w populacji");
    expect(out.afterToggle.updates).toBe(1);
    expect(out.afterToggle.values.every((v: number) => v > 0 && v < 100)).toBe(true);
  });

  test("the population's share of the population is not a metric", () => {
    // With no filter, "share" for the population chart would give a flat 100% line — so
    // the chart stays in counts instead of pretending to show something.
    expect(out.afterToggle.popTitle).toBe("Populacja świata w czasie");
  });

  test("a world with one snapshot shows a point and a note instead of an empty chart", () => {
    expect(out.singleSnapshotWorld.points).toBe(1);
    expect(out.singleSnapshotWorld.noticeHidden).toBe(false);
    expect(out.singleSnapshotWorld.table).toBe("");
    // Empty content alone is not enough: `.card` has a border and padding, and
    // `tabindex="0"` with `role="region"` left an empty box that caught the tab key and
    // was announced as a region with no content. The `#singlePoint` note already carries
    // that message.
    expect(out.singleSnapshotWorld.tableHidden).toBe(true);
  });
});

describe("the view comes together — a filter set", () => {
  const { proc, out } = smoke("filtered");

  test("the render goes through without an exception", () => {
    expect(proc.stderr.toString()).toBe("");
    expect(proc.exitCode).toBe(0);
    expect(out.error).toBe("");
  });

  test("filters from the URL put on the histogram what actually sits in the snapshot", async () => {
    const latest = manifest.worlds.find((w: { name: string }) => w.name === "aether").files.at(-1);
    expect(out.source).toBe(latest.filters);

    const f = JSON.parse(await Bun.file(path.join(PUBLIC_DIR, latest.filters)).text());
    let expected = 0;
    for (let i = 0; i < f.count; i++) {
      const level = f.level[i];
      const prof = f.profession[i];
      if (level >= 200 && level <= 250 && (prof === 1 || prof === 4)) expected += 1;
    }

    expect(out.matched).toBe(expected);
    expect(expected).toBeGreaterThan(0);
    expect(out.matchLine).toContain(`Pasuje: ${expected.toLocaleString("pl-PL")}`);
  });

  test("a link carrying filters fetches the history without waiting for a mouse move", () => {
    expect(out.charts.popChart.title).toBe("Pasujących filtrowi w czasie");
    expect(out.charts.popChart.points).toBeGreaterThan(1);
    expect(out.partialNoteHidden).toBe(true); // the full set arrived in time
    expect(out.historyStatus).toMatch(/^\d+ migawek$/);
  });

  test("the last history point is the same number as the snapshot view of that snapshot", () => {
    // Two independent routes to one number: the histogram summed across its series, and
    // the aggregate computed by summarizeFiltered. Drift would mean one of them filters
    // differently.
    expect(out.charts.popChart.lastY).toBe(out.matched);
  });

  test("the profession chart shows only the professions in the filter", () => {
    expect(out.charts.profChart.series).toBe(2);
  });

  test("the bar summarises a filter that has scrolled off the screen", () => {
    // It is 961 px from the filter to the first history chart — more than a screen. The bar
    // is the only place where what is set and what it acts on are visible at once.
    expect(out.bar.chips).toEqual(["Poziom 200-250", "Wojownik, Tropiciel"]);
    expect(out.bar.toggle).toBe("Filtry (2)");
  });

  test("the drawer starts closed and nothing toggles it once the data arrives", () => {
    // A panel toggled from JS only after the `fetch`es moved the page by its own height
    // mid-load — and on a reload the restored scroll position landed somewhere else. The
    // initial state now lives in the markup alone.
    expect(out.bar.fieldsHidden).toBe(true);
    expect(out.afterOpen.fieldsHidden).toBe(false);
    expect(out.afterOpen.expanded).toBe("true");
    expect(out.afterClose.fieldsHidden).toBe(true);
    expect(out.afterClose.expanded).toBe("false");
    // opening and closing does not touch the filters
    expect(out.afterOpen.chips).toEqual(out.bar.chips);
  });

  test("the close button on a chip clears the whole group of fields, not one", () => {
    // "Poziom 200-250" is one thing to the reader and two `<input>`s to the code.
    expect(out.afterChipClear.minLevel).toBe("");
    expect(out.afterChipClear.maxLevel).toBe("");
    expect(out.afterChipClear.chips).toEqual(["Wojownik, Tropiciel"]);
    expect(out.afterChipClear.toggle).toBe("Filtry (1)");
  });

  test("each snapshot is fetched exactly once, despite a burst of filter events", () => {
    // Gordion's history is 1.9 MB. Calling the fetch straight from the `input` handler
    // started its own pass per keystroke, because the list of missing snapshots is computed
    // at start — turning "you buy 1.9 MB knowingly" into a multiple of that figure without
    // the user knowing.
    expect(out.fetches.duplicated).toEqual([]);
    expect(out.fetches.maxPerFile).toBe(1);
    expect(out.fetches.files).toBeGreaterThan(15); // aether + brutal, two worlds
  });

  test("switching worlds clears the previous one's charts instead of leaving them up", () => {
    // The first render of a new world arrives only after a snapshot is fetched. Without
    // clearing synchronously, the previous world's series stood under the new heading for a
    // few hundred milliseconds — tooltips with those dates included.
    expect(out.afterWorldSwitch).toEqual({ popSeries: 0, profSeries: 0, tableRows: 0 });
  });

  test("an incomplete history says so, and stops once it stops being incomplete", () => {
    // The snapshot count of world "brutal" grows with every scrape — taken from trends.json
    // rather than hard-coded, otherwise the next `bun run scrape` gives red CI.
    // dom-smoke.ts breaks the fetch of exactly one snapshot of that world.
    const total = JSON.parse(readFileSync(path.join(PUBLIC_DIR, "trends.json"), "utf8")).worlds.brutal
      .total.length;

    // The stub prices a brutal snapshot at 300 KB, so exactly 6 of them fit into the 2 MiB
    // budget — a constant, however many snapshots brutal gains later. Two different things
    // are then missing from the chart at once, and the counter has to keep them apart: the
    // budget is a decision, a failed fetch is an accident. Either way it counts against
    // every snapshot the world has, because counting against the budget would report a
    // trimmed history as a complete one.
    expect(out.budgetInput.bytesPerSnapshot).toBe(300_000);
    const planned = 6;

    // A snapshot that did not arrive gets no point — and the view is to say so in the
    // HISTORIA section, not in the error bar 1500 px higher, which is about the snapshot
    // being cross-sectioned.
    expect(out.partialHistory.status).toBe(
      `${planned - 1} z ${total} migawek · limit transferu 2,0 MB · 1 nie wczytano`,
    );
    expect(out.partialHistory.points).toBe(planned - 1);
    expect(out.partialHistory.noteHidden).toBe(false);
    expect(out.partialHistory.note).toContain("Historia jest niepełna");
    expect(out.partialHistory.error).toBe("");

    // The budget names what it left out and what the rest costs — a trimmed chart is
    // indistinguishable from a world with a shorter history.
    expect(out.partialHistory.budgetNoteHidden).toBe(false);
    expect(out.partialHistory.budgetNote).toContain(`sięga ${planned} najnowszych migawek z ${total}`);
    expect(out.partialHistory.loadRestLabel).toMatch(/^Dociągnij resztę historii \(\+[\d, ]+ MB\)$/);

    // Pressing the button buys the rest: every snapshot is fetched, the note has nothing
    // left to say, and the one that answers 503 is still the only point missing.
    expect(out.afterLoadRest).toEqual({
      status: `${total - 1} z ${total} migawek · 1 nie wczytano`,
      budgetNoteHidden: true,
      points: total - 1,
      axis: out.partialHistory.axis,
    });

    // The axis spans the world's whole history in all three states — that is the invariant
    // the budget must not touch: filtering may take away points, never the period the chart
    // describes. Compared against trends.json, so "equal to each other" cannot pass by all
    // three being empty.
    const brutal = JSON.parse(readFileSync(path.join(PUBLIC_DIR, "trends.json"), "utf8")).worlds.brutal;
    expect(out.partialHistory.axis).toEqual({
      min: new Date(brutal.startedAt[0]).getTime(),
      max: new Date(brutal.startedAt.at(-1)).getTime(),
    });

    // Back at the default filter, the history comes from the complete aggregate — the whole
    // of it, budget or no budget. The failure counter and the budget note from the previous
    // filter have no business still describing it.
    expect(out.afterReset).toEqual({
      status: `${total} migawek`,
      noteHidden: true,
      budgetNoteHidden: true,
      points: total,
      axis: out.partialHistory.axis,
    });
  });

  test("the chosen threshold survives a rebuild of the option list", () => {
    // Replacing the `innerHTML` of a `<select>` clears its value, so reading it AFTER the
    // replacement drops the user back to the first option. The effect: somebody who chose
    // "≤ 30 dni" lands on "< 24h" — a series swinging by 14.7% while the population is
    // steady at 0.6% — and gets it frozen into the link they copy.
    expect(out.thresholdSurvival.picked).toEqual({ value: "30d", options: 3 });

    // at "≤ 14 dni" the 30d threshold is unreachable, but we fall to the widest one that
    // still means something (7d), not to the narrowest on the list
    expect(out.thresholdSurvival.narrowed).toEqual({ value: "7d", options: 2 });

    // the list is back to three options — the choice is to stay, not jump to the first
    expect(out.thresholdSurvival.widened).toEqual({ value: "7d", options: 3 });
  });

  test("the activity filter removes the thresholds that say nothing under it", () => {
    // At "≤ 3 dni" the "≤ 7 dni" threshold would count exactly the same players as the
    // isMatch chart — three lines on top of each other look like confirmation of
    // something.
    expect(out.afterActivityFilter.thresholdOptions).toBe(1);
    expect(out.afterActivityFilter.noteHidden).toBe(false);
    expect(out.afterActivityFilter.note).toContain("≤ 3 dni");
    expect(out.afterActivityFilter.actHidden).toBe(false);
  });
});

describe("the suspect-snapshot warning", () => {
  test("the view reads the flag from the snapshot and has somewhere to show it", () => {
    // Without this the scraper would write `suspect` for nobody — exactly the pattern the
    // audit deleted the aggregate module for.
    expect(js).toMatch(/showSuspect\(\w+\.suspect/);
    expect(js).toContain("Ta migawka może być niekompletna");
    expect(html).toContain('id="suspect"');
  });

  test("the warning disappears when switching to another snapshot", () => {
    const load = js.slice(js.indexOf("async function loadSnapshot"));
    const reset = load.indexOf("showSuspect(null)");
    // The freshly fetched snapshot, not the one already in memory — that branch returns
    // before this point, so a match on it would prove nothing about the order here.
    const set = load.search(/showSuspect\(snapshot\.suspect/);
    expect(reset).toBeGreaterThan(-1);
    expect(set).toBeGreaterThan(-1);
    expect(reset).toBeLessThan(set); // cleared before the new data arrives
  });
});
