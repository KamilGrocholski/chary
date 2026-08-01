import { describe, expect, test } from "bun:test";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  activityBucket,
  countByActivity,
  countByLevel,
  emptyFilters,
  formatTimestamp,
  totalsFromCounts,
} from "../public/app.js";

// Dashboard liczy wszystko z tych funkcji, na pliku `<ts>.f.json`. Test sprawdza je
// na prawdziwym snapshocie i konfrontuje wyniki z oryginalnym, jednoplikowym
// snapshotem wyciągniętym z gita — czyli z danymi sprzed migracji formatu.

const PUBLIC_DIR = path.resolve(import.meta.dir, "../public");
const WORLD = "aether";
const TIMESTAMP = "2026-07-21T22-04-12";

const data = JSON.parse(await Bun.file(path.join(PUBLIC_DIR, `worlds/${WORLD}/${TIMESTAMP}.f.json`)).text());
const names = JSON.parse(await Bun.file(path.join(PUBLIC_DIR, `worlds/${WORLD}/${TIMESTAMP}.n.json`)).text());

/** Snapshot sprzed rozdzielenia formatu — wzorzec odniesienia. */
const legacy = JSON.parse(
  execSync(`git show HEAD:public/worlds/${WORLD}/${TIMESTAMP}.json`, { maxBuffer: 1e9, cwd: path.resolve(import.meta.dir, "..") }).toString(),
);

function legacyDays(text: string): number | null {
  const t = String(text);
  if (t.includes("24h")) return 0;
  const n = Number(t.match(/(\d+)/)?.[1]);
  return n >= 10_000 ? null : n;
}

function filters(overrides: Record<string, unknown> = {}) {
  return { ...emptyFilters(), ...overrides };
}

function total(counts: Map<number, number[]>) {
  return totalsFromCounts(counts).total;
}

function legacyCount(predicate: (row: any[]) => boolean) {
  return legacy.rows.filter(predicate).length;
}

describe("rozdzielony format jest wierny oryginałowi", () => {
  test("liczby wierszy się zgadzają", () => {
    expect(data.count).toBe(legacy.rows.length);
    expect(names.count).toBe(legacy.rows.length);
    expect(data.level).toHaveLength(data.count);
    expect(data.days).toHaveLength(data.count);
  });

  test("każdy wiersz ma te same wartości co przed migracją", () => {
    for (let i = 0; i < legacy.rows.length; i++) {
      const r = legacy.rows[i];
      expect(names.name[i]).toBe(r[1]);
      expect(data.level[i]).toBe(r[2]);
      expect(data.profession[i]).toBe(r[3]);
      expect(data.honor[i]).toBe(r[4]);
      expect(data.days[i]).toBe(legacyDays(r[5]));
    }
  });

  test("ranga odtwarza się z kolejności wierszy", () => {
    expect(legacy.rows.every((r: any[], i: number) => r[0] === i + 1)).toBe(true);
  });

  test("konta nigdy nieużywane mają null zamiast daty w 1969 r.", () => {
    const never = data.days.filter((d: number | null) => d === null).length;
    expect(never).toBeGreaterThan(0);
    expect(never).toBe(legacyCount((r) => Number(String(r[5]).match(/(\d+)/)?.[1]) >= 10_000));
  });
});

describe("filtrowanie — zawsze dokładne", () => {
  test("bez filtrów widać całą populację", () => {
    expect(total(countByLevel(data, filters()))).toBe(legacy.rows.length);
  });

  test("rozkład po profesjach", () => {
    const perProfession = totalsFromCounts(countByLevel(data, filters())).perProfession;
    for (let p = 1; p <= 6; p++) {
      expect(perProfession[p - 1]).toBe(legacyCount((r) => r[3] === p));
    }
  });

  test("zakres poziomów", () => {
    const counts = countByLevel(data, filters({ minLevel: 200, maxLevel: 250 }));
    expect(total(counts)).toBe(legacyCount((r) => r[2] >= 200 && r[2] <= 250));
    expect([...counts.keys()].every((l) => l >= 200 && l <= 250)).toBe(true);
  });

  test("zakres honoru — dokładny, bez koszyków", () => {
    expect(total(countByLevel(data, filters({ minHonor: 100_000 })))).toBe(legacyCount((r) => r[4] >= 100_000));
    expect(total(countByLevel(data, filters({ minHonor: 1, maxHonor: 999 })))).toBe(
      legacyCount((r) => r[4] >= 1 && r[4] <= 999),
    );
    // wartość, która nie leży na granicy żadnego koszyka
    expect(total(countByLevel(data, filters({ minHonor: 4137 })))).toBe(legacyCount((r) => r[4] >= 4137));
  });

  test("próg aktywności — dowolna liczba dni, nie tylko preset", () => {
    for (const maxDays of [0, 1, 5, 13, 47, 365]) {
      const expected = legacyCount((r) => {
        const d = legacyDays(r[5]);
        return d !== null && d <= maxDays;
      });
      expect(total(countByLevel(data, filters({ maxDays })))).toBe(expected);
    }
  });

  test("filtry składają się ze sobą", () => {
    const f = filters({ minLevel: 250, maxLevel: 320, minHonor: 100, maxDays: 30, professions: new Set([1, 4]) });
    const expected = legacyCount((r) => {
      const d = legacyDays(r[5]);
      return (
        r[2] >= 250 && r[2] <= 320 && r[4] >= 100 && d !== null && d <= 30 && (r[3] === 1 || r[3] === 4)
      );
    });
    expect(total(countByLevel(data, f))).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });

  test("filtry wykluczające dają pustkę, nie wysypkę", () => {
    expect(total(countByLevel(data, filters({ minLevel: 9000 })))).toBe(0);
    expect(total(countByLevel(data, filters({ professions: new Set() })))).toBe(0);
  });
});

describe("rozkład aktywności", () => {
  test("zgadza się z surowymi danymi i sumuje do populacji", () => {
    const buckets = countByActivity(data, filters());
    expect(buckets.reduce((s, [, c]) => s + c, 0)).toBe(legacy.rows.length);

    for (const [bucket, count] of buckets) {
      expect(count).toBe(legacyCount((r) => activityBucket(legacyDays(r[5])) === bucket));
    }
  });

  test("jest dokładny również po filtrze poziomu (agregat tego nie potrafił)", () => {
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
  ] as const)("activityBucket(%p) → %p", (days, bucket) => {
    expect(activityBucket(days)).toBe(bucket);
  });
});

const html = await Bun.file(path.join(PUBLIC_DIR, "index.html")).text();
const js = await Bun.file(path.join(PUBLIC_DIR, "app.js")).text();

describe("spójność app.js z index.html", () => {
  test("każdy element pobierany przez el() istnieje w markupie", () => {
    const ids = [...js.matchAll(/\bel\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(10);
    for (const id of new Set(ids)) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  test("strona ładuje moduł i lokalny Chart.js zamiast CDN-u", () => {
    expect(html).toContain('<script type="module" src="app.js">');
    expect(html).toContain('src="vendor/chart.umd.min.js"');
    expect(html).not.toContain("cdn.jsdelivr.net");
  });

  test("dashboard nie sięga już po nicki ani po drugi poziom danych", () => {
    expect(js).not.toContain("needsRawData");
    expect(js).toContain("entry.filters");
    expect(js).not.toContain("entry.names");
  });
});

describe("drobiazgi", () => {
  test("formatuje znacznik czasu snapshotu", () => {
    expect(formatTimestamp("2026-04-17T15-24-07")).toBe("17.04.2026 15:24");
    expect(formatTimestamp("bez-sensu")).toBe("bez-sensu");
  });
});
