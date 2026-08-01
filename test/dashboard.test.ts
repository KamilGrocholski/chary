import { describe, expect, test } from "bun:test";
import path from "node:path";
import { normalizeLegacyRows, splitNormalized } from "../src/snapshot.ts";
import {
  activityBucket,
  activityLabel,
  countByActivity,
  countByLevel,
  daysBetween,
  emptyFilters,
  filtersFromParams,
  filtersToParams,
  formatSnapshotDate,
  totalsFromCounts,
  visibleActivityBuckets,
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

    // Chodzi o brak zewnętrznych zasobów, nie o brak samego słowa „cdn” —
    // adres CDN-u wolno wymienić w komentarzu z instrukcją aktualizacji.
    const external = [...html.matchAll(/<(?:script|link)[^>]*\s(?:src|href)="([^"]+)"/g)]
      .map((m) => m[1]!)
      .filter((url) => /^(https?:)?\/\//.test(url));
    expect(external).toEqual([]);
  });

  test("dashboard nie sięga już po nicki ani po drugi poziom danych", () => {
    expect(js).not.toContain("needsRawData");
    expect(js).toContain("entry.filters");
    expect(js).not.toContain("entry.names");
  });
});

describe("czas migawki", () => {
  // Identyfikator migawki nie jest datą: do lipca 2026 powstawał z czasu lokalnego
  // scrapera, później z UTC. Ta sama godzina w nazwie znaczy co innego po obu stronach.
  const stary = { id: "2026-07-21T22-19-42", startedAt: "2026-07-21T20:19:42.806Z" };
  const nowy = { id: "2026-08-01T07-48-26", startedAt: "2026-08-01T07:48:26.850Z" };

  test("data liczy się ze startedAt, nie z nazwy pliku", () => {
    // 20:19 UTC to 22:19 w Warszawie — dla starej migawki nazwa i data zbiegają się
    // tylko przypadkiem, dla nowej rozjeżdżają o 2 h.
    const asDate = (e: { startedAt: string }) => new Date(e.startedAt);
    expect(formatSnapshotDate(stary)).toBe(
      `21.07.2026 ${String(asDate(stary).getHours()).padStart(2, "0")}:19`,
    );
    expect(formatSnapshotDate(nowy)).toBe(
      `01.08.2026 ${String(asDate(nowy).getHours()).padStart(2, "0")}:48`,
    );
  });

  test("odstęp między migawkami liczony z nazw plików mijałby się z prawdą", () => {
    const realny = daysBetween(stary, nowy)!;
    expect(realny).toBeCloseTo(10.48, 2);

    const zNazw =
      (new Date("2026-08-01T07:48:26Z").getTime() - new Date("2026-07-21T22:19:42Z").getTime()) / 86_400_000;
    expect(Math.abs(realny - zNazw)).toBeCloseTo(2 / 24, 3); // dokładnie strefa czasowa
  });

  test("bez startedAt data jest oznaczona jako przybliżona", () => {
    expect(formatSnapshotDate({ id: "2026-04-17T15-24-07" })).toBe("17.04.2026 15:24 (?)");
    expect(formatSnapshotDate({ id: "bez-sensu" })).toBe("bez-sensu");
    expect(daysBetween({ id: "a" }, nowy)).toBeNull();
  });
});

describe("stan widoku w URL-u", () => {
  test("domyślny widok nie zaśmieca linku", () => {
    expect(filtersToParams(emptyFilters()).toString()).toBe("");
  });

  test("komplet filtrów przechodzi tam i z powrotem", () => {
    const f = {
      minLevel: 250,
      maxLevel: 320,
      minHonor: -30,
      maxHonor: 100_000,
      maxDays: 14,
      professions: new Set([1, 4]),
    };
    const restored = filtersFromParams(new URLSearchParams(filtersToParams(f).toString()));
    expect(restored).toEqual(f);
  });

  test("pusty URL daje filtry domyślne", () => {
    expect(filtersFromParams(new URLSearchParams())).toEqual(emptyFilters());
  });

  test("śmieci w URL-u nie wywalają widoku", () => {
    const f = filtersFromParams(new URLSearchParams("minLevel=abc&maxDays=-5&prof=9,x"));
    expect(f).toEqual(emptyFilters());
  });

  test("filtry z URL-a dają ten sam wynik co ustawione ręcznie", () => {
    const f = filtersFromParams(new URLSearchParams("minLevel=200&maxLevel=250&prof=1,4"));
    const expected = legacyCount(
      (r) => r[2] >= 200 && r[2] <= 250 && (r[3] === 1 || r[3] === 4),
    );
    expect(total(countByLevel(data, f))).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });
});

describe("etykiety rozkładu aktywności", () => {
  test("bez filtru opisują rozłączne zakresy, a nie sumy narastające", () => {
    // „≤ 7 dni” przy koszyku 1-7 sugerowało, że to wszyscy z ostatniego tygodnia.
    expect(visibleActivityBuckets(Infinity).map((b) => activityLabel(b))).toEqual([
      "< 24h",
      "1-7 dni",
      "8-30 dni",
      "> 30 dni",
      "nigdy",
    ]);
  });

  test("próg przycina etykietę koszyka, w którym leży", () => {
    expect(visibleActivityBuckets(14).map((b) => activityLabel(b, 14))).toEqual(["< 24h", "1-7 dni", "8-14 dni"]);
    expect(visibleActivityBuckets(3).map((b) => activityLabel(b, 3))).toEqual(["< 24h", "1-3 dni"]);
    expect(visibleActivityBuckets(60).map((b) => activityLabel(b, 60))).toEqual([
      "< 24h",
      "1-7 dni",
      "8-30 dni",
      "31-60 dni",
    ]);
  });

  test("przy progu nie pokazujemy koszyków, które z definicji są puste", () => {
    // „> 30 dni: 0 · nigdy: 0” wyglądało jak zepsute dane
    expect(visibleActivityBuckets(0)).toEqual([0]);
    expect(visibleActivityBuckets(14)).not.toContain(3);
    expect(visibleActivityBuckets(14)).not.toContain(4);
    expect(visibleActivityBuckets(60)).not.toContain(4);
  });

  test("liczby pod etykietami zgadzają się z zakresem, który opisują", () => {
    const f = filters({ maxDays: 14 });
    const buckets = new Map<number, number>(
      countByActivity(data, f).map(([bucket, count]: number[]) => [bucket as number, count as number]),
    );
    const visible = visibleActivityBuckets(14);

    expect(buckets.get(visible[0])).toBe(legacyCount((r) => legacyDays(r[5]) === 0));
    expect(buckets.get(visible[1])).toBe(legacyCount((r) => {
      const d = legacyDays(r[5]);
      return d !== null && d >= 1 && d <= 7;
    }));
    expect(buckets.get(visible[2])).toBe(legacyCount((r) => {
      const d = legacyDays(r[5]);
      return d !== null && d >= 8 && d <= 14;
    }));
    expect(visible).toHaveLength(3);
  });

  test("1 dzień odmienia się poprawnie", () => {
    expect(activityLabel(1, 1)).toBe("1 dzień");
  });
});

describe("ostrzeżenie o podejrzanej migawce", () => {
  test("dashboard czyta flagę ze snapshotu i ma gdzie ją pokazać", () => {
    // Bez tego scraper zapisywałby `suspect` dla nikogo — dokładnie ten wzorzec,
    // za który ten sam audyt skasował moduł agregatów.
    expect(js).toContain("showSuspect(json.suspect)");
    expect(js).toContain("Ta migawka może być niekompletna");
    expect(html).toContain('id="suspect"');
  });

  test("ostrzeżenie znika przy przełączeniu na inną migawkę", () => {
    const load = js.slice(js.indexOf("async function loadSnapshot"));
    const reset = load.indexOf("showSuspect(null)");
    const set = load.indexOf("showSuspect(json.suspect)");
    expect(reset).toBeGreaterThan(-1);
    expect(reset).toBeLessThan(set); // czyszczone zanim dojdą nowe dane
  });
});
