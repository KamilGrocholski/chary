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

function getLegacyDays(text: string): number | null {
  const threshold = String(text);
  if (threshold.includes("24h")) return 0;
  const count = Number(threshold.match(/(\d+)/)?.[1]);
  return count >= 10_000 ? null : count;
}

function composeFilters(overrides: Record<string, unknown> = {}) {
  return { ...getEmptyFilters(), ...overrides };
}

function getTotal(counts: Map<number, number[]>) {
  return getTotalsFromCounts(counts).total;
}

function countLegacyRows(predicate: (row: any[]) => boolean) {
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
    for (let index = 0; index < legacy.rows.length; index++) {
      const row = legacy.rows[index];
      expect(names.name[index]).toBe(row[1]);
      expect(data.level[index]).toBe(row[2]);
      expect(data.profession[index]).toBe(row[3]);
      expect(data.honor[index]).toBe(row[4]);
      expect(data.days[index]).toBe(getLegacyDays(row[5]));
    }
  });

  test("accounts never used carry null instead of a date in 1969", () => {
    const never = data.days.filter((days) => days === null).length;
    expect(never).toBeGreaterThan(0);
    expect(never).toBe(countLegacyRows((row) => Number(String(row[5]).match(/(\d+)/)?.[1]) >= 10_000));
  });
});

describe("filtering — always exact", () => {
  test("with no filters the whole population is visible", () => {
    expect(getTotal(countByLevel(data, composeFilters()))).toBe(legacy.rows.length);
  });

  test("the distribution across professions", () => {
    const perProfession = getTotalsFromCounts(countByLevel(data, composeFilters())).perProfession;
    for (let profession = 1; profession <= 6; profession++) {
      expect(perProfession[profession - 1]).toBe(countLegacyRows((row) => row[3] === profession));
    }
  });

  test("a range of levels", () => {
    const counts = countByLevel(data, composeFilters({ minLevel: 200, maxLevel: 250 }));
    expect(getTotal(counts)).toBe(countLegacyRows((row) => row[2] >= 200 && row[2] <= 250));
    expect([...counts.keys()].every((level) => level >= 200 && level <= 250)).toBe(true);
  });

  test("a range of honor — exact, no buckets", () => {
    expect(getTotal(countByLevel(data, composeFilters({ minHonor: 100_000 })))).toBe(countLegacyRows((row) => row[4] >= 100_000));
    expect(getTotal(countByLevel(data, composeFilters({ minHonor: 1, maxHonor: 999 })))).toBe(
      countLegacyRows((row) => row[4] >= 1 && row[4] <= 999),
    );
    // a value that sits on no bucket boundary
    expect(getTotal(countByLevel(data, composeFilters({ minHonor: 4137 })))).toBe(countLegacyRows((row) => row[4] >= 4137));
  });

  test("the activity threshold — any number of days, not only a preset", () => {
    for (const maxDays of [0, 1, 5, 13, 47, 365]) {
      const expected = countLegacyRows((row) => {
        const days = getLegacyDays(row[5]);
        return days !== null && days <= maxDays;
      });
      expect(getTotal(countByLevel(data, composeFilters({ maxDays })))).toBe(expected);
    }
  });

  test("the filters compose", () => {
    const filterFile = composeFilters({ minLevel: 250, maxLevel: 320, minHonor: 100, maxDays: 30, professions: new Set([1, 4]) });
    const expected = countLegacyRows((row) => {
      const days = getLegacyDays(row[5]);
      return row[2] >= 250 && row[2] <= 320 && row[4] >= 100 && days !== null && days <= 30 && (row[3] === 1 || row[3] === 4);
    });
    expect(getTotal(countByLevel(data, filterFile))).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });

  test("mutually exclusive filters give emptiness, not a crash", () => {
    expect(getTotal(countByLevel(data, composeFilters({ minLevel: 9000 })))).toBe(0);
    expect(getTotal(countByLevel(data, composeFilters({ professions: new Set() })))).toBe(0);
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
      expect(getTotal(countByLevel(withSentinel, composeFilters({ maxDays })))).toBe(
        [0, 5, 40].filter((days) => days <= maxDays).length,
      );
    }
    // with no threshold everyone gets in, the account never used included
    expect(getTotal(countByLevel(withSentinel, composeFilters()))).toBe(4);
  });

  test("an account never used sits in the \"never\" bucket, not among > 30 days", () => {
    const buckets = new Map<number, number>(
      countByActivity(withSentinel, composeFilters()).map(([bucket, chip]: number[]) => [bucket as number, chip as number]),
    );
    expect(buckets.get(4)).toBe(1);
    expect(buckets.get(3)).toBe(1);
  });
});

describe("the activity distribution", () => {
  test("agrees with the raw data and sums to the population", () => {
    const buckets = countByActivity(data, composeFilters());
    expect(buckets.reduce((text, [, chip]) => text + chip, 0)).toBe(legacy.rows.length);

    for (const [bucket, count] of buckets) {
      expect(count).toBe(countLegacyRows((row) => getActivityBucket(getLegacyDays(row[5])) === bucket));
    }
  });

  test("stays exact under a level filter too (the aggregate could not)", () => {
    const filterFile = composeFilters({ minLevel: 100, maxLevel: 200 });
    const buckets = countByActivity(data, filterFile);
    expect(buckets.reduce((text, [, chip]) => text + chip, 0)).toBe(countLegacyRows((row) => row[2] >= 100 && row[2] <= 200));
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
      const filterFile = JSON.parse(await Bun.file(path.join(PUBLIC_DIR, entry.filters)).text());

      expect(filterFile.world).toBe(world.name);
      expect(filterFile.count).toBeGreaterThan(0);
      expect(filterFile.level).toHaveLength(filterFile.count);
      expect(filterFile.profession).toHaveLength(filterFile.count);
      expect(filterFile.honor).toHaveLength(filterFile.count);
      expect(filterFile.days).toHaveLength(filterFile.count);
      expect(filterFile.level.every((level: number) => Number.isInteger(level) && level > 0)).toBe(true);
      expect(filterFile.profession.every((profession: number) => profession >= 1 && profession <= 6)).toBe(true);
      // honor can be negative — confirmed against the live ranking (zorza, "lape", PH -20)
      expect(filterFile.honor.every((honor: number) => Number.isInteger(honor))).toBe(true);
      expect(filterFile.days.every((days: number | null) => days === null || (Number.isInteger(days) && days >= 0))).toBe(true);

      const count = JSON.parse(await Bun.file(path.join(PUBLIC_DIR, entry.names)).text());
      expect(count.count).toBe(filterFile.count);
      expect(count.name).toHaveLength(filterFile.count);
      expect(count.name.every((name: string) => name.length > 0)).toBe(true);
    }
  });
});

const html = await Bun.file(path.join(PUBLIC_DIR, "index.html")).text();
const appSource = await Bun.file(path.join(PUBLIC_DIR, "app.js")).text();
const sharedJs = await Bun.file(path.join(PUBLIC_DIR, "shared.js")).text();
const filtersJs = await Bun.file(path.join(PUBLIC_DIR, "filters.js")).text();
const historyJs = await Bun.file(path.join(PUBLIC_DIR, "history.js")).text();
const trendsHtml = await Bun.file(path.join(PUBLIC_DIR, "trends.html")).text();

describe("app.js agrees with index.html", () => {
  test("every element fetched through getElement() exists in the markup", () => {
    const ids = [...appSource.matchAll(/\bgetElement\("([^"]+)"\)/g)].map((match) => match[1]);
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
        .map((match) => match[1]!)
        .filter((url) => /^(https?:)?\/\//.test(url));
      expect(external).toEqual([]);
    }
  });

  test("the view does not reach for the nicknames", () => {
    // `.n.json` has no consumer today, and until a player search exists, fetching it
    // would be two thirds of the transfer for nothing.
    expect(appSource).toContain("entry.filters");
    expect(appSource).not.toContain("entry.names");
  });

  test("fetches the aggregate and the snapshots, and nothing from outside the directory", () => {
    // The list of URLs written into the code is to stay closed: no external dependency, no
    // second aggregate. Every fetch goes through `getJsonFromUrl`, so this reads the calls
    // to it rather than the calls to `fetch` — the reason the wrapper exists is that the
    // four call sites were doing the same three steps four ways (§9.5).
    const literals = [...appSource.matchAll(/getJsonFromUrl\(\s*["'`]([^"'`]+)/g)].map((match) => match[1]);
    expect(literals.sort()).toEqual(["manifest.json", "trends.json"]);

    // The remaining URLs come from the manifest, not from the code.
    expect(historyJs).toContain("getJsonFromUrl(entry.filters)");
    expect(appSource).toContain("getJsonFromUrl(entry.filters)");

    // And `fetch` itself is spelled in exactly one place, which is what makes the line
    // above a complete list rather than a sample of one.
    const fetchJs = readFileSync(path.join(repositoryRoot, "public/fetch-json.js"), "utf8");
    expect(stripComments(fetchJs)).toContain("await fetch(url)");
    for (const module of [appSource, historyJs, filtersJs, sharedJs]) {
      expect(stripComments(module)).not.toMatch(/[^.\w]fetch\(/);
    }
  });
});

describe("app.js asks index.html for the right kind of node", () => {
  // `getField()` answers an HTMLInputElement | HTMLSelectElement, and app.js says in its
  // docblock that the pairing is proved here rather than asserted at every call. That
  // sentence is only true while this test exists — asking a `<div>` for `.value` is silent
  // in a browser and would have been silent under checkJs too, since the cast is ours.
  const ids = [...appSource.matchAll(/\bgetField\(\s*"([^"]+)"\s*\)/g)].map((match) => match[1]!);

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

  // §9.7 says tokens, not literals, and used to be read as a rule about CSS. `app.js` sat
  // outside it with 24 colour literals — every one an exact copy of a `:root` token — so
  // changing the theme repainted the page and left the charts behind. These four hold the
  // one-address rule across the file boundary; the palette in `shared.js` is exempt and the
  // exemption is narrow: those six are series colours, a vocabulary of their own, and that
  // module may not touch the document to read anything.
  const rootBlock = /:root\s*\{([\s\S]*?)\n\s*\}/.exec(html)?.[1] ?? "";
  const tokens = new Map(
    [...rootBlock.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name!, value!.trim()]),
  );

  test("the stylesheet still defines tokens to agree with", () => {
    expect(tokens.size).toBeGreaterThan(8);
  });

  test("no module spells a colour that the stylesheet already names", () => {
    const offenders: string[] = [];
    for (const [name, source] of [["app.js", appSource], ["filters.js", filtersJs], ["history.js", historyJs]] as const) {
      for (const [literal] of stripComments(source).matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/g)) {
        offenders.push(`${name}: ${literal}`);
      }
    }
    expect(offenders.sort()).toEqual([]);
  });

  test("every token a module reads is a token the stylesheet defines", () => {
    const asked = [...appSource.matchAll(/var\((--[\w-]+)\)|requireToken\("(--[\w-]+)"\)/g)].map((match) => match[1] ?? match[2]!);
    expect(asked.length).toBeGreaterThan(10);
    for (const name of new Set(asked)) expect([...tokens.keys()]).toContain(name);
  });

  test("the browser chrome is painted the same colour as the page", () => {
    // A `<meta>` cannot hold `var(--bg)`, so this one value is written twice on purpose and
    // the duplicate is held here rather than left to drift.
    const themeColor = /<meta name="theme-color" content="([^"]+)"/.exec(html)?.[1];
    expect(themeColor).toBe(tokens.get("--bg"));
  });

  test("every class the view writes is a class the stylesheet styles", () => {
    // `class="num"` became `class="formatNumber"` in a rename, and the change table lost its
    // right alignment and tabular numerals in silence: the markup is written in JS and the
    // rule that styles it lives in the HTML, so nothing connected the two.
    const written = [...appSource.matchAll(/class="([^"${}]+)"/g)].flatMap((match) => match[1]!.split(/\s+/));
    expect(written.length).toBeGreaterThan(3);
    for (const name of new Set(written)) expect(html).toMatch(new RegExp(`\\.${name}\\b`));
  });

  test("getElement() is not used for a value — that is what the split is for", () => {
    expect(stripComments(appSource)).not.toMatch(/\bgetElement\([^)]*\)\.(value|checked|disabled)\b/);
  });
});

describe("the pure modules must not run anything", () => {
  // Comments are stripped, because the test is to hold the code and not the prose: the
  // paragraph explaining why a module does not reach for `document` contains that word.
  const getCode = stripComments;

  test("the counting logic does not touch the DOM", () => {
    // app.js starts the view as soon as it loads, so if a pure module imported anything
    // from it, the tests could not be run outside a browser.
    for (const module of [sharedJs, filtersJs, historyJs]) {
      expect(getCode(module)).not.toMatch(/\bdocument\b|\bwindow\b/);
      expect(module).not.toContain('from "./app.js"');
    }
    expect(appSource).toContain('from "./shared.js"');
    expect(appSource).toContain('from "./filters.js"');
    expect(appSource).toContain('from "./history.js"');
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
    const getDate = (error: { startedAt: string }) => new Date(error.startedAt);
    expect(formatSnapshotDate(old)).toBe(
      `21.07.2026 ${String(getDate(old).getHours()).padStart(2, "0")}:19`,
    );
    expect(formatSnapshotDate(recent)).toBe(
      `01.08.2026 ${String(getDate(recent).getHours()).padStart(2, "0")}:48`,
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
    const filterFile = {
      minLevel: 250,
      maxLevel: 320,
      minHonor: -30,
      maxHonor: 100_000,
      maxDays: 14,
      professions: new Set([1, 4]),
    };
    const restored = readFiltersFromParams(new URLSearchParams(composeFiltersParams(filterFile).toString()));
    expect(restored).toEqual(filterFile);
  });

  test("an empty URL gives the default filters", () => {
    expect(readFiltersFromParams(new URLSearchParams())).toEqual(getEmptyFilters());
  });

  test("junk in the URL does not break the view", () => {
    const filterFile = readFiltersFromParams(new URLSearchParams("minLevel=abc&maxDays=-5&prof=9,x"));
    expect(filterFile).toEqual(getEmptyFilters());
  });

  test("filters from the URL give the same result as filters set by hand", () => {
    const filterFile = readFiltersFromParams(new URLSearchParams("minLevel=200&maxLevel=250&prof=1,4"));
    const expected = countLegacyRows(
      (row) => row[2] >= 200 && row[2] <= 250 && (row[3] === 1 || row[3] === 4),
    );
    expect(getTotal(countByLevel(data, filterFile))).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });

  test("\"the default filter\" recognises exactly the filters that reject nothing", () => {
    // The whole lazy path hangs on this: under the default filter the history comes from
    // a 9 KB aggregate rather than from megabytes of raw snapshots.
    expect(isDefaultFilters(getEmptyFilters())).toBe(true);
    expect(isDefaultFilters(readFiltersFromParams(new URLSearchParams()))).toBe(true);
    expect(isDefaultFilters(readFiltersFromParams(new URLSearchParams("prof=1,2,3,4,5,6")))).toBe(true);

    expect(isDefaultFilters(composeFilters({ minLevel: 1 }))).toBe(false);
    expect(isDefaultFilters(composeFilters({ maxDays: 30 }))).toBe(false);
    expect(isDefaultFilters(composeFilters({ minHonor: 0 }))).toBe(false);
    expect(isDefaultFilters(composeFilters({ professions: new Set([1, 2, 3, 4, 5]) }))).toBe(false);
  });
});

describe("describing the active filters", () => {
  // The pl-PL thousands separator is a non-breaking space — we compare without whitespace.
  const removeSpaces = (text: string) => text.replace(/\s/g, "");
  const getLabels = (overrides: Record<string, unknown>) => describeFilters(composeFilters(overrides)).map((chip) => removeSpaces(chip.label));
  const getKeys = (overrides: Record<string, unknown>) => describeFilters(composeFilters(overrides)).map((chip) => chip.key);

  test("the default filter has nothing to describe", () => {
    expect(describeFilters(getEmptyFilters())).toEqual([]);
  });

  test("open and closed ranges read differently", () => {
    expect(getLabels({ minLevel: 250 })).toEqual(["Poziom≥250"]);
    expect(getLabels({ maxLevel: 400 })).toEqual(["Poziom≤400"]);
    expect(getLabels({ minLevel: 250, maxLevel: 400 })).toEqual(["Poziom250-400"]);
    expect(getLabels({ maxHonor: 50_000 })).toEqual(["Honor≤50000"]);
    // honor can be negative — the label must not lose that
    expect(getLabels({ minHonor: -35 })).toEqual(["Honor≥-35"]);
  });

  test("the activity threshold inflects and knows \"< 24h\"", () => {
    expect(getLabels({ maxDays: 0 })).toEqual(["Online<24h"]);
    expect(getLabels({ maxDays: 1 })).toEqual(["Online≤1dzień"]);
    expect(getLabels({ maxDays: 14 })).toEqual(["Online≤14dni"]);
  });

  test("professions: names up to two, then just the count", () => {
    expect(getLabels({ professions: new Set([2, 3]) })).toEqual(["Mag,Paladyn"]);
    expect(getLabels({ professions: new Set([1, 2, 3, 4]) })).toEqual(["4z6profesji"]);
    expect(getLabels({ professions: new Set() })).toEqual(["Żadnaprofesja"]);
    // all six professions is no filter at all, not a "6 of 6" chip
    expect(getLabels({ professions: new Set([1, 2, 3, 4, 5, 6]) })).toEqual([]);
  });

  test("a chip's key names a group of fields, not a single field", () => {
    // "Poziom 250-400" is one thing to the reader, though two <input>s to the code.
    expect(getKeys({ minLevel: 250, maxLevel: 400 })).toEqual(["level"]);
    expect(getKeys({ minHonor: 1, maxHonor: 2, maxDays: 7, professions: new Set([1]) })).toEqual([
      "honor",
      "days",
      "prof",
    ]);
  });

  test("the number of chips agrees with what makes a filter non-default", () => {
    // The "Filtry (N)" counter in the bar rests on this equivalence.
    const filterFile = composeFilters({ minLevel: 250, maxHonor: 50_000, maxDays: 14, professions: new Set([2, 3]) });
    expect(describeFilters(filterFile)).toHaveLength(4);
    expect(isDefaultFilters(filterFile)).toBe(false);
    expect(describeFilters(getEmptyFilters()).length === 0).toBe(isDefaultFilters(getEmptyFilters()));
  });
});

describe("the activity distribution labels", () => {
  test("with no filter they describe disjoint ranges, not running totals", () => {
    // "≤ 7 dni" over the 1-7 bucket suggested it was everyone from the last week.
    expect(getVisibleActivityBuckets(Infinity).map((bucket) => getActivityLabel(bucket))).toEqual([
      "< 24h",
      "1-7 dni",
      "8-30 dni",
      "> 30 dni",
      "nigdy",
    ]);
  });

  test("the threshold trims the label of the bucket it falls in", () => {
    expect(getVisibleActivityBuckets(14).map((bucket) => getActivityLabel(bucket, 14))).toEqual(["< 24h", "1-7 dni", "8-14 dni"]);
    expect(getVisibleActivityBuckets(3).map((bucket) => getActivityLabel(bucket, 3))).toEqual(["< 24h", "1-3 dni"]);
    expect(getVisibleActivityBuckets(60).map((bucket) => getActivityLabel(bucket, 60))).toEqual([
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
    const filterFile = composeFilters({ maxDays: 14 });
    const buckets = new Map<number, number>(
      countByActivity(data, filterFile).map(([bucket, count]: number[]) => [bucket as number, count as number]),
    );
    const visible = getVisibleActivityBuckets(14);
    // Read once with an assertion rather than three times with a `!`: the length is checked
    // at the end of this test, so a short list is a failure of the subject, not of indexing.
    const [first, second, third] = visible as [number, number, number];

    expect(buckets.get(first)).toBe(countLegacyRows((row) => getLegacyDays(row[5]) === 0));
    expect(buckets.get(second)).toBe(countLegacyRows((row) => {
      const days = getLegacyDays(row[5]);
      return days !== null && days >= 1 && days <= 7;
    }));
    expect(buckets.get(third)).toBe(countLegacyRows((row) => {
      const days = getLegacyDays(row[5]);
      return days !== null && days >= 8 && days <= 14;
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

const repositoryRoot = path.resolve(import.meta.dir, "..");
const runSmoke = (scenario: string) => {
  const result = Bun.spawnSync(["bun", path.join(repositoryRoot, "test/dom-smoke.ts"), scenario], { cwd: repositoryRoot });
  return {
    result,
    out: result.exitCode === 0 && result.stdout.length > 0 ? JSON.parse(result.stdout.toString()) : null,
  };
};

describe("the view comes together — the default filter", () => {
  const { result, out } = runSmoke("default");

  test("the render goes through without an exception", () => {
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
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
    const signText = percent > 0 ? "+" : percent < 0 ? "−" : "";
    const formatted = Math.abs(percent).toLocaleString("pl-PL", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });

    expect(out.summary).toContain(`${signText}${formatted}%`);
    expect(percent).toBeLessThan(0); // fobos empties fastest of them all
    expect(out.tableRows).toBe(out.charts.popChart.points); // the header + n-1 change rows
    expect(out.tableHidden).toBe(false); // it is hidden only when there are no rows
    expect(out.singlePointHidden).toBe(true);
    expect(out.suspectNoteHidden).toBe(true);
  });

  test("the numbers are Polish, with no mixing of comma and full stop", () => {
    // Dates carry full stops by definition — we check fractions, not 04.08.2026.
    const removeDates = (text: string) => text.replace(/\d{2}\.\d{2}\.\d{4}/g, "");
    expect(removeDates(out.summary)).not.toMatch(/\d\.\d/);
    expect(removeDates(out.table)).not.toMatch(/\d\.\d/);
    expect(out.table).toMatch(/\d,\d/);
  });

  test("switching the threshold and the scale recomputes the chart rather than making a new one", () => {
    expect(out.afterToggle.title).toBe("Udział aktywnych < 24h w populacji");
    expect(out.afterToggle.updates).toBe(1);
    expect(out.afterToggle.values.every((value: number) => value > 0 && value < 100)).toBe(true);
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
  const { result, out } = runSmoke("filtered");

  test("the render goes through without an exception", () => {
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    expect(out.error).toBe("");
  });

  test("filters from the URL put on the histogram what actually sits in the snapshot", async () => {
    const latest = manifest.worlds.find((world: { name: string }) => world.name === "aether").files.at(-1);
    expect(out.source).toBe(latest.filters);

    const filterFile = JSON.parse(await Bun.file(path.join(PUBLIC_DIR, latest.filters)).text());
    let expected = 0;
    for (let index = 0; index < filterFile.count; index++) {
      const level = filterFile.level[index];
      const profession = filterFile.profession[index];
      if (level >= 200 && level <= 250 && (profession === 1 || profession === 4)) expected += 1;
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
    const getTotal = JSON.parse(readFileSync(path.join(PUBLIC_DIR, "trends.json"), "utf8")).worlds.brutal
      .total.length;

    // Every dated snapshot is fetched — there is no ceiling left to trim the plan, and that
    // is the point of this whole round. The only thing missing from the chart is the one
    // snapshot that answered 503, so the counter has exactly one reason to name and it is
    // an accident rather than a decision.
    expect(out.partialHistory.status).toBe(`${getTotal - 1} z ${getTotal} migawek · 1 nie wczytano`);
    expect(out.partialHistory.points).toBe(getTotal - 1);
    expect(out.partialHistory.noteHidden).toBe(false);
    expect(out.partialHistory.note).toContain("Historia jest niepełna");
    expect(out.partialHistory.error).toBe("");

    // The plan is every dated snapshot, and this world proves the guard is not vacuous: at
    // the price the stub gives it, its whole history costs more than the 2 MiB ceiling that
    // used to stand here, so under that ceiling only 6 of them would have been fetched and
    // the counter above would read 6 rather than the whole set. Put a budget back and this
    // test goes red — docs/2026-08-28-history-without-a-budget.md.
    expect(out.priceInput.bytesPerSnapshot).toBe(300_000);
    expect(out.priceInput.bytesPerSnapshot * getTotal).toBeGreaterThan(2 * 1024 * 1024);

    // Mid-flight the status carries the price. Nobody is stopped at a budget any more, so
    // this line is the whole of what keeps the transfer knowingly bought — and it is
    // approximate, because `bytes` prices the newest snapshot and the older ones are
    // smaller. It says so with a `~` rather than looking exact (§9.6).
    expect(out.loadingStatus).toMatch(
      new RegExp(`^wczytywanie dokładnych danych… \\d+ z ${getTotal} migawek · ~[\\d, ]+ MB$`),
    );

    // The axis spans the world's whole history in both states — filtering may take away
    // points, never the period the chart describes. Compared against trends.json, so "equal
    // to each other" cannot pass by both being empty.
    const brutal = JSON.parse(readFileSync(path.join(PUBLIC_DIR, "trends.json"), "utf8")).worlds.brutal;
    expect(out.partialHistory.axis).toEqual({
      min: new Date(brutal.startedAt[0]).getTime(),
      max: new Date(brutal.startedAt.at(-1)).getTime(),
    });

    // Back at the default filter, the history comes from the complete aggregate — every
    // snapshot, including the one whose file could not be fetched. The failure counter from
    // the previous filter has no business still describing it.
    expect(out.afterReset).toEqual({
      status: `${getTotal} migawek`,
      noteHidden: true,
      points: getTotal,
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
    expect(appSource).toMatch(/showSuspect\(\w+\.suspect/);
    expect(appSource).toContain("Ta migawka może być niekompletna");
    expect(html).toContain('id="suspect"');
  });

  test("the warning disappears when switching to another snapshot", () => {
    const loadSnapshotSource = appSource.slice(appSource.indexOf("async function loadSnapshot"));
    const resetAt = loadSnapshotSource.indexOf("showSuspect(null)");
    // The freshly fetched snapshot, not the one already in memory — that branch returns
    // before this point, so a match on it would prove nothing about the order here.
    const setPosition = loadSnapshotSource.search(/showSuspect\(snapshot\.suspect/);
    expect(resetAt).toBeGreaterThan(-1);
    expect(setPosition).toBeGreaterThan(-1);
    expect(resetAt).toBeLessThan(setPosition); // cleared before the new data arrives
  });
});
