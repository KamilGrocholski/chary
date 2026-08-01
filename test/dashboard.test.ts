import { describe, expect, test } from "bun:test";
import path from "node:path";
import { normalizeLegacyRows, splitNormalized } from "../src/snapshot.ts";
import {
  activityBucket,
  countByActivity,
  countByLevel,
  emptyFilters,
  formatTimestamp,
  totalsFromCounts,
} from "../public/app.js";

// Wzorcem odniesienia jest próbka prawdziwego snapshotu w starym schemacie v1
// (test/fixtures/legacy-snapshot-aether.json — co 12. wiersz oryginału, więc pokrywa
// cały rozkład: poziomy 1-378, honor 0-744k, konta nigdy nieużywane).
//
// Test przepuszcza ją przez produkcyjną migrację, po czym każdy filtr porównuje
// z policzonym wprost na oryginalnych wierszach. Dzięki temu sprawdza naraz, czy
// migracja niczego nie gubi i czy dashboard liczy dokładnie.

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
  return { ...emptyFilters(), ...overrides };
}

function total(counts: Map<number, number[]>) {
  return totalsFromCounts(counts).total;
}

function legacyCount(predicate: (row: any[]) => boolean) {
  return legacy.rows.filter(predicate).length;
}

describe("migracja do rozdzielonego formatu", () => {
  test("nie gubi ani nie dokłada wierszy", () => {
    expect(data.count).toBe(legacy.rows.length);
    expect(names.count).toBe(legacy.rows.length);
    for (const column of [data.level, data.profession, data.honor, data.days]) {
      expect(column).toHaveLength(data.count);
    }
  });

  test("każdy wiersz zachowuje wszystkie wartości", () => {
    for (let i = 0; i < legacy.rows.length; i++) {
      const r = legacy.rows[i];
      expect(names.name[i]).toBe(r[1]);
      expect(data.level[i]).toBe(r[2]);
      expect(data.profession[i]).toBe(r[3]);
      expect(data.honor[i]).toBe(r[4]);
      expect(data.days[i]).toBe(legacyDays(r[5]));
    }
  });

  test("konta nigdy nieużywane mają null zamiast daty w 1969 r.", () => {
    const never = data.days.filter((d) => d === null).length;
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
      return r[2] >= 250 && r[2] <= 320 && r[4] >= 100 && d !== null && d <= 30 && (r[3] === 1 || r[3] === 4);
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

const manifest = JSON.parse(await Bun.file(path.join(PUBLIC_DIR, "manifest.json")).text());

describe("opublikowane dane", () => {
  test("każdy wpis manifestu wskazuje istniejący plik filtrów", async () => {
    expect(manifest.worlds.length).toBeGreaterThan(0);
    for (const world of manifest.worlds) {
      expect(world.files.length).toBeGreaterThan(0);
      for (const entry of world.files) {
        expect(entry.filters).toMatch(/\.f\.json$/);
        expect(await Bun.file(path.join(PUBLIC_DIR, entry.filters)).exists()).toBe(true);
      }
    }
  });

  test("najnowszy snapshot każdego świata jest spójny", async () => {
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
      // honor bywa ujemny — potwierdzone na żywym rankingu (zorza, „lape”, PH -20)
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
