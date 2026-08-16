import { describe, expect, test } from "bun:test";
import path from "node:path";
import { normalizeLegacyRows, splitNormalized, type FilterFile } from "../src/snapshot.ts";
import { activityBucket as activityBucketServer, buildWorldTrend, summarizeSnapshot } from "../src/trends.ts";
import { activityBucket as activityBucketBrowser } from "../public/shared.js";
import { emptyFilters, summarizeFiltered } from "../public/filters.js";
import {
  ACTIVITY_THRESHOLDS,
  DEFAULT_THRESHOLD,
  HISTORY_WINDOW,
  activeCounts,
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

// Wzorcem odniesienia są prawdziwe dane, nie reimplementacja tego samego liczenia:
// agregat sprawdzamy na próbce prawdziwej migawki w schemacie v1 (ta sama, co
// w dashboard.test.ts), a opublikowany `trends.json` — wobec `.f.json`, z których powstał.

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

describe("agregat migawki", () => {
  const summary = summarizeSnapshot(sample);

  test("populacja i profesje zgadzają się z surowymi wierszami", () => {
    expect(summary.total).toBe(legacy.rows.length);
    for (let p = 1; p <= 6; p++) {
      expect(summary.byProf[p - 1]).toBe(legacyCount((r) => r[3] === p));
    }
    expect(summary.byProf.reduce((a, b) => a + b, 0)).toBe(summary.total);
  });

  test("koszyki aktywności są rozłączne i sumują się do populacji", () => {
    for (let bucket = 0; bucket < 5; bucket++) {
      expect(summary.act[bucket]).toBe(legacyCount((r) => activityBucketServer(legacyDays(r[5])) === bucket));
    }
    expect(summary.act.reduce((a, b) => a + b, 0)).toBe(summary.total);
  });

  test("konta nigdy nieużywane siedzą w osobnym koszyku, nie wśród nieaktywnych", () => {
    // `days === null` to konto, którego nigdy nie użyto (ranking pokazuje datę z 1969 r.),
    // a nie gracz nieobecny od dawna — zlanie tych dwóch przypadków zawyżałoby „> 30 dni”.
    expect(summary.act[4]).toBe(legacyCount((r) => legacyDays(r[5]) === null));
    expect(summary.act[4]).toBeGreaterThan(0);
  });

  test("scraper i przeglądarka koszykują tak samo", () => {
    // Dwie kopie tej samej funkcji (src/trends.ts i public/shared.js) — rozjazd dałby
    // historię niezgodną z przekrojem. Lista to komplet wartości, które scraper potrafi
    // wyprodukować; wartownika −1 nie ma na niej, bo powstaje dopiero przy konwersji
    // do tablic typowanych, czyli wyłącznie po stronie przeglądarki.
    for (const days of [null, undefined, 0, 1, 7, 8, 30, 31, 365, 20_655]) {
      expect(activityBucketServer(days)).toBe(activityBucketBrowser(days));
    }
  });
});

describe("historia świata", () => {
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

  test("porządkuje migawki po startedAt, nie po nazwie pliku", () => {
    // Identyfikatory sprzed sierpnia 2026 mają w nazwie czas lokalny, więc sortowanie
    // po nich ustawiłoby migawki ze szwu stref o 2 h obok prawdy.
    const trend = buildWorldTrend([
      { id: "2026-08-01T09-48-26", filters: filters("2026-08-01T07:48:26.000Z", 2) },
      { id: "2026-07-21T22-04-12", filters: filters("2026-07-21T20:04:12.000Z", 1) },
    ]);
    expect(trend.id).toEqual(["2026-07-21T22-04-12", "2026-08-01T09-48-26"]);
    expect(trend.total).toEqual([1, 2]);
  });

  test("migawka bez startedAt wypada — nie ma jej gdzie postawić na osi czasu", () => {
    const trend = buildWorldTrend([
      { id: "bez-czasu", filters: filters(undefined, 5) },
      { id: "z-czasem", filters: filters("2026-07-21T20:04:12.000Z", 1) },
    ]);
    expect(trend.id).toEqual(["z-czasem"]);
  });

  test("wszystkie kolumny mają tę samą długość, a suspect jest przenoszony", () => {
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

describe("opublikowany trends.json", () => {
  test("pokrywa każdy świat z manifestu, migawka po migawce", () => {
    expect(trends.schema).toBe(1);
    expect(Object.keys(trends.worlds)).toHaveLength(manifest.worlds.length);

    for (const world of manifest.worlds) {
      const trend = trends.worlds[world.name];
      const dated = world.files.filter((f: { startedAt?: string }) => f.startedAt);
      expect(trend.id).toEqual(dated.map((f: { id: string }) => f.id));
      expect(trend.startedAt).toEqual(dated.map((f: { startedAt: string }) => f.startedAt));
    }
  });

  test("każda kolumna sumuje się do populacji tej samej migawki", () => {
    for (const trend of Object.values(trends.worlds) as any[]) {
      for (let i = 0; i < trend.total.length; i++) {
        expect(trend.act.reduce((s: number, b: number[]) => s + b[i], 0)).toBe(trend.total[i]);
        expect(trend.byProf.reduce((s: number, b: number[]) => s + b[i], 0)).toBe(trend.total[i]);
      }
    }
  });

  test("liczby zgadzają się z migawką, z której powstały", async () => {
    // Pełne przeliczenie najnowszej migawki każdego świata wprost z `.f.json` —
    // to jedyny test, który łapie rozjazd między tym, co zapisał scraper, a tym,
    // co pokazuje wykres.
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

  test("duży spadek populacji albo nie istnieje, albo jest oflagowany", () => {
    // Sanity check na realnych danych: gdyby agregat liczył co innego niż migawka,
    // sąsiednie punkty rozjechałyby się dużo mocniej niż realny odpływ graczy.
    //
    // Spadek > 5% to dokładnie to, co `checkPopulationDrop` (ten sam próg 0,05) ma
    // wykrywać i **zapisywać** z flagą `suspect`. Test zabraniający takiej migawce
    // istnieć robił czerwony build z pierwszego realnie obciętego scrapa — czyli karał
    // za zachowanie, które projekt uznał za poprawne. Warunek jest więc odwrócony:
    // wolno jej być, pod warunkiem że jest oflagowana.
    //
    // Tylko spadki — `checkPopulationDrop` nigdy nie flaguje wzrostów, więc świat,
    // który realnie zyskuje graczy (np. `luvia` +11% między dwiema migawkami), nie
    // ma tu żadnego invariantu do sprawdzenia.
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

describe("klient przy filtrze domyślnym liczy dokładnie to, co serwer", () => {
  test("wszystkie 202 migawki, wiersz po wierszu", async () => {
    // Rdzeń całego widoku: historia pod filtrem powstaje z tej samej funkcji, co
    // historia bez filtra. Gdyby `summarizeFiltered` odrzucał choć jeden wiersz inaczej
    // niż `summarizeSnapshot`, wykres skakałby przy pierwszym ruchu filtrem — i to
    // wyglądałoby jak zmiana w danych, a nie jak błąd.
    //
    // Pełny przelot po 64 MB trwa ~0,9 s, więc nie ma powodu sprawdzać próbki.
    const noFilter = emptyFilters();
    let checked = 0;

    for (const world of manifest.worlds) {
      for (const entry of world.files) {
        const f = JSON.parse(await Bun.file(path.join(PUBLIC_DIR, entry.filters)).text());
        expect(summarizeFiltered(f, noFilter)).toEqual(summarizeSnapshot(f));
        // i to samo po konwersji do tablic typowanych, którą robi przeglądarka
        expect(summarizeFiltered(toTypedSnapshot(f), noFilter)).toEqual(summarizeSnapshot(f));
        checked += 1;
      }
    }
    expect(checked).toBe(manifest.worlds.reduce((s: number, w: any) => s + w.files.length, 0));
    expect(checked).toBeGreaterThan(200);
  });
});

describe("konwersja do tablic typowanych", () => {
  const raw = {
    count: 5,
    level: [1, 250, 500, 10, 10],
    profession: [1, 2, 3, 4, 6],
    honor: [-35, 0, 1_224_565, 100, -1],
    days: [0, 7, null, 6598, 31],
    suspect: { reason: "test" },
  };

  test("null staje się −1, a nie zerem ani wielką liczbą", () => {
    const typed = toTypedSnapshot(raw);
    expect([...typed.days]).toEqual([0, 7, -1, 6598, 31]);
    expect(typed.suspect).toEqual({ reason: "test" });
  });

  test("żadna kolumna nie traci wartości na typie", () => {
    const typed = toTypedSnapshot(raw);
    expect([...typed.level]).toEqual(raw.level);
    expect([...typed.profession]).toEqual(raw.profession);
    // honor bywa ujemny i sięga 1,2 mln — Int16 by go urwał
    expect([...typed.honor]).toEqual(raw.honor);
  });

  test("brak suspect daje null, a nie undefined", () => {
    expect(toTypedSnapshot({ ...raw, suspect: undefined }).suspect).toBeNull();
  });
});

describe("progi aktywności są skumulowane", () => {
  const aether = trends.worlds.aether;

  test("„≤ 7 dni” to koszyk < 24h razem z 1-7 dni", () => {
    const counts = activeCounts(aether, "7d");
    for (let i = 0; i < counts.length; i++) {
      expect(counts[i]).toBe(aether.act[0][i] + aether.act[1][i]);
    }
  });

  test("liczby zgadzają się z surowym `.f.json`, nie tylko same ze sobą", async () => {
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

  test("progi rosną monotonicznie i nigdy nie przekraczają populacji", () => {
    const keys = ACTIVITY_THRESHOLDS.map((t) => t.key);
    const series = keys.map((key) => activeCounts(aether, key));
    for (let i = 0; i < aether.total.length; i++) {
      expect(series[0]![i]).toBeLessThanOrEqual(series[1]![i]!);
      expect(series[1]![i]).toBeLessThanOrEqual(series[2]![i]!);
      expect(series[2]![i]).toBeLessThanOrEqual(aether.total[i]);
    }
  });

  test("nieznany próg wraca do domyślnego zamiast wywalać widok", () => {
    expect(activeCounts(aether, "bez-sensu")).toEqual(activeCounts(aether, DEFAULT_THRESHOLD));
  });

  test("udział liczy się względem populacji tej samej migawki", () => {
    const counts = activeCounts(aether, "7d");
    const share = shareSeries(counts, aether.total);
    expect(share[0]).toBeCloseTo((counts[0]! / aether.total[0]) * 100, 6);
    expect(share.every((s: number) => s >= 0 && s <= 100)).toBe(true);
    // Populacja 0 nie może dać NaN na wykresie.
    expect(shareSeries([0], [0])).toEqual([0]);
  });
});

describe("filtr aktywności zabiera progi, które pod nim milkną", () => {
  // Przy filtrze „online ≤ 7 dni” w zbiorze nie ma już nikogo powyżej siedmiu dni,
  // więc próg „≤ 7 dni” zrównałby się z liczbą pasujących, a „≤ 30 dni” tak samo.
  test("zostają tylko progi węższe od filtra", () => {
    expect(usableThresholds(Infinity).map((t) => t.key)).toEqual(["24h", "7d", "30d"]);
    expect(usableThresholds(30).map((t) => t.key)).toEqual(["24h", "7d"]);
    expect(usableThresholds(14).map((t) => t.key)).toEqual(["24h", "7d"]);
    expect(usableThresholds(7).map((t) => t.key)).toEqual(["24h"]);
    expect(usableThresholds(3).map((t) => t.key)).toEqual(["24h"]);
    expect(usableThresholds(0)).toEqual([]);
  });

  test("wybrany próg spada do najbliższego, który jeszcze coś mówi", () => {
    expect(thresholdByKey("30d", Infinity)!.key).toBe("30d");
    expect(thresholdByKey("30d", 7)!.key).toBe("24h");
    expect(thresholdByKey("7d", 7)!.key).toBe("24h");
    // filtr węższy niż każdy próg — nie ma czego pokazać i widok musi to znieść
    expect(thresholdByKey("24h", 0)).toBeNull();
  });

  test("bez użytecznego progu „aktywni” to po prostu wszyscy pasujący", () => {
    expect(activeCounts(trends.worlds.aether, "24h", 0)).toEqual(trends.worlds.aether.total);
  });
});

describe("historia pod filtrem", () => {
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

  test("filtr domyślny oddaje agregat bez dotykania migawek", () => {
    // To jest ta ścieżka, za którą nikt niefiltrujący nie płaci ani bajtem ponad 9 KB.
    const result = buildFilteredTrend(base, new Map(), emptyFilters());
    expect(result.trend).toBe(base);
    expect(result.population).toBe(base.total);
    expect(result.loaded).toBe(3);
  });

  test("liczy tylko z wczytanych migawek, reszcie nie podstawia niczego", () => {
    const store = new Map([
      ["a", snapshot([10, 300, 300])],
      ["c", snapshot([300, 300])],
    ]);
    const { trend, population, loaded, expected } = buildFilteredTrend(base, store, {
      ...emptyFilters(),
      minLevel: 200,
    });

    expect(trend.id).toEqual(["a", "c"]); // „b” nie ma punktu, a nie punkt zmyślony
    expect(trend.total).toEqual([2, 2]);
    expect(trend.startedAt).toEqual([base.startedAt[0], base.startedAt[2]]);
    expect(trend.suspect).toEqual([0, 0]);
    expect(loaded).toBe(2);
    expect(expected).toBe(3);
    // mianownik zostaje niefiltrowany — inaczej „udział” sumowałby się do 100%
    expect(population).toEqual([100, 120]);
  });

  test("dziura w historii robi dłuższy odstęp, a nie fałszywy skok", () => {
    const store = new Map([
      ["a", snapshot([300])],
      ["c", snapshot([300, 300, 300])],
    ]);
    const { trend } = buildFilteredTrend(base, store, { ...emptyFilters(), minLevel: 200 });
    const rows = changeRows(trend);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.delta).toBe(2);
    expect(rows[0]!.days).toBeCloseTo(20, 6); // a→c, nie a→b
    expect(rows[0]!.perDay).toBeCloseTo(0.1, 6);
  });

  test("okno migawek zawęża historię i mówi, ile jej zostało", () => {
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

  test("żadna migawka nie daje pustej historii, nie wysypki", () => {
    const { trend, loaded } = buildFilteredTrend(base, new Map(), { ...emptyFilters(), minLevel: 200 });
    expect(trend.id).toEqual([]);
    expect(loaded).toBe(0);
    expect(summarize(trend)).toBeNull();
    expect(changeRows(trend)).toEqual([]);
  });
});

describe("okno migawek", () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}` }));

  test("bierze najnowsze, bo to one odpowiadają na „co się dzieje teraz”", () => {
    const picked = windowedEntries(entries, 5);
    expect(picked.map((e: { id: string }) => e.id)).toEqual(["s15", "s16", "s17", "s18", "s19"]);
  });

  test("krótsza historia przechodzi w całości", () => {
    expect(windowedEntries(entries.slice(0, 3), 5)).toHaveLength(3);
    expect(windowedEntries(entries.slice(0, 5), 5)).toHaveLength(5);
  });

  test("domyślne okno jest szersze niż najdłuższa dzisiejsza historia", () => {
    // Gdy przestanie być, licznik „N z M” ma to pokazać zamiast po cichu uciąć wykres.
    const longest = Math.max(...(Object.values(trends.worlds) as any[]).map((t) => t.id.length));
    expect(HISTORY_WINDOW).toBeGreaterThanOrEqual(longest);
  });
});

describe("pobieranie historii", () => {
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

  test("dociąga komplet i melduje postęp po każdej migawce", async () => {
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

  test("drugie wywołanie nic nie pobiera — migawki leżą już w pamięci", async () => {
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

  test("jedna zepsuta odpowiedź nie wywala całej historii", async () => {
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

  test("przełączenie świata porzuca robotę zamiast dosypywać dane do martwego widoku", async () => {
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

  test("pamięć trzyma najwyżej dwa światy — bez tego karta zbiera wszystkie 21", () => {
    cachedSnapshots("cache-a").set("x", {} as any);
    cachedSnapshots("cache-b").set("x", {} as any);
    cachedSnapshots("cache-c").set("x", {} as any);
    expect(cachedSnapshots("cache-b").size).toBe(1);
    expect(cachedSnapshots("cache-c").size).toBe(1);
    // „cache-a” wypadło, więc dostajemy świeżą, pustą mapę
    expect(cachedSnapshots("cache-a").size).toBe(0);
  });
});

describe("zmiany między migawkami", () => {
  const aether = trends.worlds.aether;

  test("delta jest dzielona przez realny odstęp, nie przez migawkę", () => {
    // Odstępy wynoszą 3-17 dni, więc „−120 graczy” z dwóch wierszy tabeli znaczy
    // dwie różne rzeczy, dopóki nie podzieli się przez czas.
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

  test("odstępy w tych danych naprawdę są nierówne", () => {
    const days = changeRows(aether).map((r) => r.days!);
    expect(Math.max(...days) - Math.min(...days)).toBeGreaterThan(3);
  });

  test("świat z jedną migawką daje pustą tabelę, nie błąd", () => {
    const single = { id: ["a"], startedAt: ["2026-08-04T10:45:20.548Z"], total: [39087], act: [[1], [1], [1], [1], [1]], byProf: [[1], [1], [1], [1], [1], [1]], suspect: [0] };
    expect(changeRows(single)).toEqual([]);
    expect(summarize(single)).toMatchObject({ snapshots: 1, delta: 0, days: 0 });
  });
});

describe("podsumowanie historii", () => {
  test("liczy zmianę od pierwszej migawki do ostatniej", () => {
    const fobos = trends.worlds.fobos;
    const s = summarize(fobos)!;
    expect(s.total).toBe(fobos.total.at(-1));
    expect(s.delta).toBe(fobos.total.at(-1) - fobos.total[0]);
    expect(s.percent).toBeCloseTo((s.delta / fobos.total[0]) * 100, 6);
    expect(s.snapshots).toBe(fobos.total.length);
    // fobos jest najszybciej wyludniającym się światem — to sygnał, dla którego ten widok powstał
    expect(s.delta).toBeLessThan(0);
  });
});

describe("stan widoku w URL-u", () => {
  test("domyślny widok nie zaśmieca linku poza wyborem świata", () => {
    expect(viewToParams({ world: "aether", threshold: DEFAULT_THRESHOLD, share: false }).toString()).toBe(
      "world=aether",
    );
  });

  test("komplet ustawień przechodzi tam i z powrotem", () => {
    const view = { world: "gordion", date: "2026-08-04T10-02-40", threshold: "30d", share: true };
    expect(viewFromParams(new URLSearchParams(viewToParams(view).toString()))).toEqual(view);
  });

  test("śmieci w URL-u nie wywalają widoku", () => {
    expect(viewFromParams(new URLSearchParams("prog=xyz&udzial=nie"))).toEqual({
      world: null,
      date: null,
      threshold: DEFAULT_THRESHOLD,
      share: false,
    });
  });

  test("stan widoku i filtrów nie kolidują kluczami", () => {
    // Na tym wisi obietnica, że linki do starego trends.html dalej działają:
    // jedna strona czyta oba zestawy parametrów naraz.
    const viewKeys = [...viewToParams({ world: "a", date: "b", threshold: "30d", share: true }).keys()];
    expect(viewKeys.sort()).toEqual(["date", "prog", "udzial", "world"]);
    for (const key of viewKeys) {
      expect(["minLevel", "maxLevel", "minHonor", "maxHonor", "maxDays", "prof"]).not.toContain(key);
    }
  });
});

const trendsHtml = await Bun.file(path.join(PUBLIC_DIR, "trends.html")).text();

describe("stara strona trendów zostaje jako przekierowanie", () => {
  test("przenosi query string, żeby rozesłane linki dalej działały", () => {
    expect(trendsHtml).toContain('"index.html" + location.search');
    expect(trendsHtml).toContain("location.replace(target)");
    expect(trendsHtml).toContain('href="index.html"');
  });

  test("nie ładuje już wykresów ani modułu widoku", () => {
    expect(trendsHtml).not.toContain("chart.umd.min.js");
    expect(trendsHtml).not.toContain("trends.js");
  });
});
