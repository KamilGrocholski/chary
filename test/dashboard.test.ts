import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeLegacyRows, splitNormalized } from "../src/snapshot.ts";
import {
  activityLabel,
  countByActivity,
  countByLevel,
  describeFilters,
  emptyFilters,
  filtersFromParams,
  filtersToParams,
  isDefaultFilters,
  totalsFromCounts,
  visibleActivityBuckets,
} from "../public/filters.js";
import { activityBucket, daysBetween, formatSnapshotDate, isNeverOnline } from "../public/shared.js";

// Wzorcem odniesienia jest próbka prawdziwego snapshotu w starym schemacie v1
// (test/fixtures/legacy-snapshot-aether.json — co 12. wiersz oryginału, więc pokrywa
// cały rozkład: poziomy 1-378, honor 0-744k, konta nigdy nieużywane).
//
// Test przepuszcza ją przez produkcyjną migrację, po czym każdy filtr porównuje
// z policzonym wprost na oryginalnych wierszach. Dzięki temu sprawdza naraz, czy
// migracja niczego nie gubi i czy widok liczy dokładnie.

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

describe("konto nigdy nieużywane wypada z każdego progu", () => {
  // Najgroźniejsza pułapka tablic typowanych: `null` zapisujemy jako −1, a `−1 > maxDays`
  // jest fałszem. Filtr, który pyta najpierw o próg, wpuściłby konta nigdy nieużywane
  // do każdego progu aktywności — odwrotnie, niż wynika z danych.
  const withSentinel = {
    count: 4,
    level: Int16Array.from([10, 10, 10, 10]),
    profession: Uint8Array.from([1, 1, 1, 1]),
    honor: Int32Array.from([0, 0, 0, 0]),
    days: Int32Array.from([0, 5, 40, -1]),
  };

  test("obie reprezentacje „nigdy” znaczą to samo", () => {
    expect(isNeverOnline(null)).toBe(true);
    expect(isNeverOnline(undefined)).toBe(true);
    expect(isNeverOnline(-1)).toBe(true);
    expect(isNeverOnline(0)).toBe(false);
    expect(activityBucket(-1)).toBe(4);
    expect(activityBucket(null)).toBe(4);
  });

  test("wartownik −1 nie przechodzi progu, mimo że jest mniejszy od każdego", () => {
    for (const maxDays of [0, 1, 7, 30, 365, 100_000]) {
      expect(total(countByLevel(withSentinel, filters({ maxDays })))).toBe(
        [0, 5, 40].filter((d) => d <= maxDays).length,
      );
    }
    // bez progu wchodzą wszyscy, łącznie z kontem nigdy nieużywanym
    expect(total(countByLevel(withSentinel, filters()))).toBe(4);
  });

  test("konto nigdy nieużywane siedzi w koszyku „nigdy”, nie wśród > 30 dni", () => {
    const buckets = new Map<number, number>(
      countByActivity(withSentinel, filters()).map(([b, c]: number[]) => [b as number, c as number]),
    );
    expect(buckets.get(4)).toBe(1);
    expect(buckets.get(3)).toBe(1);
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
const sharedJs = await Bun.file(path.join(PUBLIC_DIR, "shared.js")).text();
const filtersJs = await Bun.file(path.join(PUBLIC_DIR, "filters.js")).text();
const historyJs = await Bun.file(path.join(PUBLIC_DIR, "history.js")).text();
const trendsHtml = await Bun.file(path.join(PUBLIC_DIR, "trends.html")).text();

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
    for (const markup of [html, trendsHtml]) {
      const external = [...markup.matchAll(/<(?:script|link)[^>]*\s(?:src|href)="([^"]+)"/g)]
        .map((m) => m[1]!)
        .filter((url) => /^(https?:)?\/\//.test(url));
      expect(external).toEqual([]);
    }
  });

  test("widok nie sięga po nicki", () => {
    // `.n.json` nie ma dziś konsumenta i dopóki nie powstanie wyszukiwarka gracza,
    // pobieranie go byłoby dwiema trzecimi transferu na darmo.
    expect(js).toContain("entry.filters");
    expect(js).not.toContain("entry.names");
  });

  test("pobiera agregat i migawki, i nic spoza katalogu", () => {
    // Historia z surowych `.f.json` jest tu nowa i celowa, ale lista adresów ma
    // zostać zamknięta: żadnych zewnętrznych zależności, żadnego drugiego agregatu.
    const literals = [...js.matchAll(/fetch\(\s*["'`]([^"'`]+)/g)].map((m) => m[1]);
    expect(literals.sort()).toEqual(["manifest.json", "trends.json"]);
    // pozostałe adresy biorą się z manifestu, nie z kodu
    expect(historyJs).toContain("fetch(entry.filters)");
    expect(js).toContain("fetch(entry.filters)");
  });
});

describe("moduły czyste nie mogą niczego uruchamiać", () => {
  // Komentarze wycinamy, bo test ma pilnować kodu, a nie prozy: akapit tłumaczący,
  // dlaczego moduł nie sięga po `document`, sam zawiera to słowo.
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  test("logika liczenia nie dotyka DOM-u", () => {
    // app.js startuje widok od razu po załadowaniu, więc gdyby moduł czysty
    // importował z niego cokolwiek, testów nie dałoby się odpalić poza przeglądarką.
    for (const module of [sharedJs, filtersJs, historyJs]) {
      expect(code(module)).not.toMatch(/\bdocument\b|\bwindow\b/);
      expect(module).not.toContain('from "./app.js"');
    }
    expect(js).toContain('from "./shared.js"');
    expect(js).toContain('from "./filters.js"');
    expect(js).toContain('from "./history.js"');
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

describe("stan filtrów w URL-u", () => {
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

  test("„filtr domyślny” rozpoznaje dokładnie te filtry, które niczego nie odrzucają", () => {
    // Na tym wisi cała leniwa ścieżka: przy filtrze domyślnym historia idzie
    // z 9 KB agregatu, a nie z megabajtów surowych migawek.
    expect(isDefaultFilters(emptyFilters())).toBe(true);
    expect(isDefaultFilters(filtersFromParams(new URLSearchParams()))).toBe(true);
    expect(isDefaultFilters(filtersFromParams(new URLSearchParams("prof=1,2,3,4,5,6")))).toBe(true);

    expect(isDefaultFilters(filters({ minLevel: 1 }))).toBe(false);
    expect(isDefaultFilters(filters({ maxDays: 30 }))).toBe(false);
    expect(isDefaultFilters(filters({ minHonor: 0 }))).toBe(false);
    expect(isDefaultFilters(filters({ professions: new Set([1, 2, 3, 4, 5]) }))).toBe(false);
  });
});

describe("opis aktywnych filtrów", () => {
  // Separator tysięcy w pl-PL to spacja nierozdzielająca — porównujemy bez białych znaków.
  const flat = (s: string) => s.replace(/\s/g, "");
  const labels = (overrides: Record<string, unknown>) => describeFilters(filters(overrides)).map((c) => flat(c.label));
  const keys = (overrides: Record<string, unknown>) => describeFilters(filters(overrides)).map((c) => c.key);

  test("filtr domyślny nie ma czego opisać", () => {
    expect(describeFilters(emptyFilters())).toEqual([]);
  });

  test("zakresy otwarte i domknięte czyta się inaczej", () => {
    expect(labels({ minLevel: 250 })).toEqual(["Poziom≥250"]);
    expect(labels({ maxLevel: 400 })).toEqual(["Poziom≤400"]);
    expect(labels({ minLevel: 250, maxLevel: 400 })).toEqual(["Poziom250-400"]);
    expect(labels({ maxHonor: 50_000 })).toEqual(["Honor≤50000"]);
    // honor bywa ujemny — etykieta nie może tego gubić
    expect(labels({ minHonor: -35 })).toEqual(["Honor≥-35"]);
  });

  test("próg aktywności odmienia się i zna „< 24h”", () => {
    expect(labels({ maxDays: 0 })).toEqual(["Online<24h"]);
    expect(labels({ maxDays: 1 })).toEqual(["Online≤1dzień"]);
    expect(labels({ maxDays: 14 })).toEqual(["Online≤14dni"]);
  });

  test("profesje: nazwy do dwóch, potem sama liczba", () => {
    expect(labels({ professions: new Set([2, 3]) })).toEqual(["Mag,Paladyn"]);
    expect(labels({ professions: new Set([1, 2, 3, 4]) })).toEqual(["4z6profesji"]);
    expect(labels({ professions: new Set() })).toEqual(["Żadnaprofesja"]);
    // komplet profesji to brak filtra, nie chip „6 z 6”
    expect(labels({ professions: new Set([1, 2, 3, 4, 5, 6]) })).toEqual([]);
  });

  test("klucz chipa wskazuje grupę pól, nie pojedyncze pole", () => {
    // „Poziom 250-400” to jeden byt dla czytającego, choć dwa <input> dla kodu.
    expect(keys({ minLevel: 250, maxLevel: 400 })).toEqual(["level"]);
    expect(keys({ minHonor: 1, maxHonor: 2, maxDays: 7, professions: new Set([1]) })).toEqual([
      "honor",
      "days",
      "prof",
    ]);
  });

  test("liczba chipów zgadza się z tym, co odróżnia filtr od domyślnego", () => {
    // Na tej równoważności stoi licznik „Filtry (N)” w pasku.
    const f = filters({ minLevel: 250, maxHonor: 50_000, maxDays: 14, professions: new Set([2, 3]) });
    expect(describeFilters(f)).toHaveLength(4);
    expect(isDefaultFilters(f)).toBe(false);
    expect(describeFilters(emptyFilters()).length === 0).toBe(isDefaultFilters(emptyFilters()));
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

// ── Widok w całości ─────────────────────────────────────────────────────────
//
// Warstwa DOM-u przepuszczona przez atrapę w osobnym procesie (test/dom_smoke.ts).
// Dwa scenariusze, bo widok ma dwie ścieżki danych i tylko razem pokrywają obie:
// filtr domyślny (historia z trends.json) i filtr ustawiony (historia z `.f.json`).

const repo = path.resolve(import.meta.dir, "..");
const smoke = (scenario: string) => {
  const proc = Bun.spawnSync(["bun", path.join(repo, "test/dom_smoke.ts"), scenario], { cwd: repo });
  return {
    proc,
    out: proc.exitCode === 0 && proc.stdout.length > 0 ? JSON.parse(proc.stdout.toString()) : null,
  };
};

describe("widok składa się w całość — filtr domyślny", () => {
  const { proc, out } = smoke("default");

  test("render przechodzi bez wyjątku", () => {
    expect(proc.stderr.toString()).toBe("");
    expect(proc.exitCode).toBe(0);
    expect(out.error).toBe("");
    expect(out.professionCheckboxes).toBe(6);
  });

  test("przekrój pokazuje całą migawkę, bo filtr niczego nie odrzuca", () => {
    expect(out.matched).toBeGreaterThan(0);
    expect(out.levels).toBeGreaterThan(0);
    expect(out.matchLine).toMatch(/\(100,0%\)/);
    expect(out.suspectHidden).toBe(true);
  });

  test("historia idzie z agregatu i nie dociąga migawek", () => {
    // Ścieżka, za którą nikt niefiltrujący nie płaci: 9 KB zamiast 1,9 MB.
    expect(out.charts.popChart.title).toBe("Populacja świata w czasie");
    expect(out.charts.popChart.label).toBe("Populacja");
    expect(out.partialNoteHidden).toBe(true);
    expect(out.historyStatus).toMatch(/^\d+ migawek$/);
  });

  test("każdy wykres dostaje punkty ustawione w czasie, nie w kolejności migawek", () => {
    for (const [id, expectedSeries] of [["popChart", 1], ["actChart", 1], ["profChart", 6]] as const) {
      expect(out.charts[id].series).toBe(expectedSeries);
      expect(out.charts[id].points).toBe(out.charts.popChart.points);
    }
    // Oś X w milisekundach epoki — inaczej odstępy 3-17 dni wyglądałyby na równe.
    expect(out.charts.popChart.firstX).toBeGreaterThan(0);
  });

  test("podsumowanie i tabela pokazują realne liczby", () => {
    // Zmiana liczona z opublikowanego agregatu, nie zaszyta literałem: „−5,3%” było
    // policzone z dzisiejszych danych fobosa i pierwszy `bun run scrape` robił z tego
    // czerwone CI na commicie z danymi.
    const fobos = JSON.parse(readFileSync(path.join(PUBLIC_DIR, "trends.json"), "utf8")).worlds.fobos;
    const percent = ((fobos.total.at(-1) - fobos.total[0]) / fobos.total[0]) * 100;
    const sign = percent > 0 ? "+" : percent < 0 ? "−" : "";
    const formatted = Math.abs(percent).toLocaleString("pl-PL", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });

    expect(out.summary).toContain(`${sign}${formatted}%`);
    expect(percent).toBeLessThan(0); // fobos wyludnia się najszybciej ze wszystkich
    expect(out.tableRows).toBe(out.charts.popChart.points); // nagłówek + n-1 wierszy zmian
    expect(out.tableHidden).toBe(false); // ukrywana jest tylko wtedy, gdy nie ma wierszy
    expect(out.singlePointHidden).toBe(true);
    expect(out.suspectNoteHidden).toBe(true);
  });

  test("liczby są po polsku, bez mieszania przecinka z kropką", () => {
    // Daty mają kropki z definicji — sprawdzamy ułamki, nie 04.08.2026.
    const fractions = (s: string) => s.replace(/\d{2}\.\d{2}\.\d{4}/g, "");
    expect(fractions(out.summary)).not.toMatch(/\d\.\d/);
    expect(fractions(out.table)).not.toMatch(/\d\.\d/);
    expect(out.table).toMatch(/\d,\d/);
  });

  test("przełączenie progu i skali przelicza wykres, a nie tworzy nowego", () => {
    expect(out.afterToggle.title).toBe("Udział aktywnych < 24h w populacji");
    expect(out.afterToggle.updates).toBe(1);
    expect(out.afterToggle.values.every((v: number) => v > 0 && v < 100)).toBe(true);
  });

  test("udział populacji w populacji to nie jest metryka", () => {
    // Bez filtra „udział” dla wykresu populacji dałby płaską linię 100% — wykres
    // zostaje wtedy w liczbach zamiast udawać, że coś pokazuje.
    expect(out.afterToggle.popTitle).toBe("Populacja świata w czasie");
  });

  test("świat z jedną migawką pokazuje punkt i notkę zamiast pustego wykresu", () => {
    expect(out.singleSnapshotWorld.points).toBe(1);
    expect(out.singleSnapshotWorld.noticeHidden).toBe(false);
    expect(out.singleSnapshotWorld.table).toBe("");
    // Sama pusta treść nie wystarcza: `.card` ma ramkę i padding, a `tabindex="0"`
    // z `role="region"` zostawiały puste pudełko łapiące tabulator i ogłaszane jako
    // region bez zawartości. Notka `#singlePoint` niesie już ten komunikat.
    expect(out.singleSnapshotWorld.tableHidden).toBe(true);
  });
});

describe("widok składa się w całość — filtr ustawiony", () => {
  const { proc, out } = smoke("filtered");

  test("render przechodzi bez wyjątku", () => {
    expect(proc.stderr.toString()).toBe("");
    expect(proc.exitCode).toBe(0);
    expect(out.error).toBe("");
  });

  test("filtry z URL-a dają na histogramie to, co siedzi w migawce", async () => {
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

  test("link z filtrami dociąga historię bez czekania na ruch myszą", () => {
    expect(out.charts.popChart.title).toBe("Pasujących filtrowi w czasie");
    expect(out.charts.popChart.points).toBeGreaterThan(1);
    expect(out.partialNoteHidden).toBe(true); // komplet zdążył dojść
    expect(out.historyStatus).toMatch(/^\d+ migawek$/);
  });

  test("ostatni punkt historii to ta sama liczba, co przekrój tej samej migawki", () => {
    // Dwie niezależne drogi do jednej liczby: histogram sumowany po seriach
    // i agregat policzony przez summarizeFiltered. Rozjazd znaczyłby, że któraś
    // z nich filtruje inaczej.
    expect(out.charts.popChart.lastY).toBe(out.matched);
  });

  test("wykres profesji pokazuje tylko profesje z filtra", () => {
    expect(out.charts.profChart.series).toBe(2);
  });

  test("pasek streszcza filtr, który przewinął się poza ekran", () => {
    // Od filtra do pierwszego wykresu historii jest 961 px — więcej niż ekran. Pasek
    // jest jedynym miejscem, w którym widać naraz, co jest ustawione i na co działa.
    expect(out.bar.chips).toEqual(["Poziom 200-250", "Wojownik, Tropiciel"]);
    expect(out.bar.toggle).toBe("Filtry (2)");
  });

  test("szuflada startuje zamknięta i nic jej nie przełącza po dojściu danych", () => {
    // Panel przełączany z JS-a dopiero po `fetch`ach przesuwał stronę o własną wysokość
    // w trakcie ładowania — a przy przeładowaniu przywrócona pozycja scrolla lądowała
    // gdzie indziej. Stan początkowy jest teraz wyłącznie w markupie.
    expect(out.bar.fieldsHidden).toBe(true);
    expect(out.afterOpen.fieldsHidden).toBe(false);
    expect(out.afterOpen.expanded).toBe("true");
    expect(out.afterClose.fieldsHidden).toBe(true);
    expect(out.afterClose.expanded).toBe("false");
    // otwieranie i zamykanie nie rusza filtrów
    expect(out.afterOpen.chips).toEqual(out.bar.chips);
  });

  test("krzyżyk na chipie kasuje całą grupę pól, nie jedno", () => {
    // „Poziom 200-250” to jeden byt dla czytającego, a dwa `<input>` dla kodu.
    expect(out.afterChipClear.minLevel).toBe("");
    expect(out.afterChipClear.maxLevel).toBe("");
    expect(out.afterChipClear.chips).toEqual(["Wojownik, Tropiciel"]);
    expect(out.afterChipClear.toggle).toBe("Filtry (1)");
  });

  test("każda migawka jest pobierana dokładnie raz, mimo serii zdarzeń filtra", () => {
    // Historia gordiona to 1,9 MB. Wywoływanie pobierania wprost z handlera `input`
    // startowało własny przelot na każdy wciśnięty klawisz, bo lista brakujących
    // migawek jest liczona w momencie startu — a to zamienia „kupujesz 1,9 MB
    // świadomie” w kilkukrotność tej liczby bez wiedzy użytkownika.
    expect(out.fetches.duplicated).toEqual([]);
    expect(out.fetches.maxPerFile).toBe(1);
    expect(out.fetches.files).toBeGreaterThan(15); // aether + brutal, dwa światy
  });

  test("przełączenie świata gasi wykresy poprzedniego, zamiast trzymać je na ekranie", () => {
    // Pierwszy render nowego świata przychodzi dopiero po pobraniu migawki. Bez
    // synchronicznego wyczyszczenia pod nowym nagłówkiem stały przez kilkaset
    // milisekund serie poprzedniego świata — łącznie z dymkami z tamtymi datami.
    expect(out.afterWorldSwitch).toEqual({ popSeries: 0, profSeries: 0, tableRows: 0 });
  });

  test("niepełna historia mówi o sobie, i przestaje, gdy przestaje być niepełna", () => {
    // Liczba migawek świata "brutal" rośnie z każdym scrapem — liczona z trends.json,
    // nie zaszyta literałem, inaczej kolejny `bun run scrape` daje czerwone CI.
    // dom_smoke.ts psuje pobranie dokładnie jednej migawki tego świata.
    const total = JSON.parse(readFileSync(path.join(PUBLIC_DIR, "trends.json"), "utf8")).worlds.brutal
      .total.length;

    // Migawka, która nie doszła, nie ma punktu — i widok ma to powiedzieć w sekcji
    // HISTORIA, a nie w pasku błędu 1500 px wyżej, dotyczącym migawki przekroju.
    expect(out.partialHistory.status).toBe(`${total - 1} z ${total} migawek · 1 nie wczytano`);
    expect(out.partialHistory.noteHidden).toBe(false);
    expect(out.partialHistory.note).toContain("Historia jest niepełna");
    expect(out.partialHistory.error).toBe("");

    // Po powrocie do filtra domyślnego historia idzie z kompletnego agregatu.
    // Licznik porażek z poprzedniego filtra nie ma prawa jej dalej opisywać.
    expect(out.afterReset).toEqual({ status: `${total} migawek`, noteHidden: true, points: total });
  });

  test("wybrany próg przeżywa przebudowę listy opcji", () => {
    // Podmiana `innerHTML` na `<select>` zeruje wartość, więc odczytanie jej PO
    // podmianie cofa użytkownika na pierwszą opcję. Efekt: ktoś, kto wybrał
    // „≤ 30 dni”, ląduje na „< 24h” — serii wahającej się o 14,7% przy populacji
    // stabilnej na 0,6% — i dostaje to jeszcze utrwalone w skopiowanym linku.
    expect(out.thresholdSurvival.picked).toEqual({ value: "30d", options: 3 });

    // przy „≤ 14 dni” próg 30d jest nieosiągalny, ale schodzimy na najszerszy
    // sensowny (7d), nie na najwęższy z listy
    expect(out.thresholdSurvival.narrowed).toEqual({ value: "7d", options: 2 });

    // lista wraca do trzech opcji — wybór ma zostać, a nie skoczyć na pierwszą
    expect(out.thresholdSurvival.widened).toEqual({ value: "7d", options: 3 });
  });

  test("filtr aktywności zabiera progi, które pod nim nic już nie mówią", () => {
    // Przy „≤ 3 dni” próg „≤ 7 dni” liczyłby dokładnie tych samych graczy, co wykres
    // pasujących — trzy linie jedna na drugiej wyglądają jak potwierdzenie czegoś.
    expect(out.afterActivityFilter.thresholdOptions).toBe(1);
    expect(out.afterActivityFilter.noteHidden).toBe(false);
    expect(out.afterActivityFilter.note).toContain("≤ 3 dni");
    expect(out.afterActivityFilter.actHidden).toBe(false);
  });
});

describe("ostrzeżenie o podejrzanej migawce", () => {
  test("widok czyta flagę ze snapshotu i ma gdzie ją pokazać", () => {
    // Bez tego scraper zapisywałby `suspect` dla nikogo — dokładnie ten wzorzec,
    // za który audyt skasował moduł agregatów.
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
