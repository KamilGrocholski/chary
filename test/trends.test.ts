import { describe, expect, test } from "bun:test";
import path from "node:path";
import { normalizeLegacyRows, splitNormalized, type FilterFile } from "../src/snapshot.ts";
import { activityBucket as activityBucketServer, buildWorldTrend, summarizeSnapshot } from "../src/trends.ts";
import { activityBucket as activityBucketBrowser } from "../public/shared.js";
import {
  ACTIVITY_THRESHOLDS,
  DEFAULT_THRESHOLD,
  activeCounts,
  changeRows,
  shareSeries,
  summarize,
  viewFromParams,
  viewToParams,
} from "../public/trends.js";

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
    // wykres trendów niezgodny z dashboardem migawki.
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

  test("populacja świata zmienia się o ułamki procenta, nie skokowo", () => {
    // Sanity check na realnych danych: gdyby agregat liczył co innego niż migawka,
    // sąsiednie punkty rozjechałyby się dużo mocniej niż realny odpływ graczy.
    for (const trend of Object.values(trends.worlds) as any[]) {
      for (let i = 1; i < trend.total.length; i++) {
        const change = Math.abs(trend.total[i] - trend.total[i - 1]) / trend.total[i - 1];
        expect(change).toBeLessThan(0.05);
      }
    }
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
    const view = { world: "gordion", threshold: "30d", share: true };
    expect(viewFromParams(new URLSearchParams(viewToParams(view).toString()))).toEqual(view);
  });

  test("śmieci w URL-u nie wywalają widoku", () => {
    expect(viewFromParams(new URLSearchParams("prog=xyz&udzial=nie"))).toEqual({
      world: null,
      threshold: DEFAULT_THRESHOLD,
      share: false,
    });
  });
});

const trendsHtml = await Bun.file(path.join(PUBLIC_DIR, "trends.html")).text();
const trendsJs = await Bun.file(path.join(PUBLIC_DIR, "trends.js")).text();
const sharedJs = await Bun.file(path.join(PUBLIC_DIR, "shared.js")).text();
const appJs = await Bun.file(path.join(PUBLIC_DIR, "app.js")).text();
const indexHtml = await Bun.file(path.join(PUBLIC_DIR, "index.html")).text();

describe("spójność trends.js z trends.html", () => {
  test("każdy element pobierany przez el() istnieje w markupie", () => {
    const ids = [...trendsJs.matchAll(/\bel\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(5);
    for (const id of new Set(ids)) {
      expect(trendsHtml).toContain(`id="${id}"`);
    }
  });

  test("strona ładuje moduł i lokalny Chart.js zamiast CDN-u", () => {
    expect(trendsHtml).toContain('<script type="module" src="trends.js">');
    expect(trendsHtml).toContain('src="vendor/chart.umd.min.js"');

    const external = [...trendsHtml.matchAll(/<(?:script|link)[^>]*\s(?:src|href)="([^"]+)"/g)]
      .map((m) => m[1]!)
      .filter((url) => /^(https?:)?\/\//.test(url));
    expect(external).toEqual([]);
  });

  test("widok czyta agregat, a nie surowe migawki", () => {
    // Cały sens tego widoku: 9 KB zamiast 14,9 MB. Wystarczy jedno `fetch` po
    // `.f.json`, żeby historia gordiona kosztowała 1,8 MB zamiast 9 KB.
    const fetched = [...trendsJs.matchAll(/fetch\(\s*["'`]([^"'`]+)/g)].map((m) => m[1]);
    expect(fetched).toEqual(["trends.json"]);
  });

  test("obie strony prowadzą do siebie nawzajem", () => {
    expect(indexHtml).toContain('href="trends.html"');
    expect(trendsHtml).toContain('href="index.html"');
  });
});

describe("widok składa się w całość", () => {
  // Warstwa DOM-u przepuszczona przez atrapę w osobnym procesie (test/dom_smoke.ts) —
  // sprawdza to, czego statyczna kontrola id-ków nie widzi: czy render w ogóle
  // przechodzi na prawdziwym trends.json i co ląduje w Chart.js.
  const repo = path.resolve(import.meta.dir, "..");
  const proc = Bun.spawnSync(["bun", path.join(repo, "test/dom_smoke.ts"), "trends"], { cwd: repo });
  const out = proc.exitCode === 0 ? JSON.parse(proc.stdout.toString()) : null;

  test("render przechodzi bez wyjątku", () => {
    expect(proc.stderr.toString()).toBe("");
    expect(proc.exitCode).toBe(0);
    expect(out.error).toBe("");
  });

  test("każdy wykres dostaje punkty ustawione w czasie, nie w kolejności migawek", () => {
    const fobos = trends.worlds.fobos;
    for (const [id, expectedSeries] of [["popChart", 1], ["actChart", 1], ["profChart", 6]] as const) {
      expect(out.charts[id].series).toBe(expectedSeries);
      expect(out.charts[id].points).toBe(fobos.total.length);
    }
    // Oś X w milisekundach epoki — inaczej odstępy 3-17 dni wyglądałyby na równe.
    expect(out.charts.popChart.firstX).toBe(new Date(fobos.startedAt[0]).getTime());
  });

  test("podsumowanie i tabela pokazują realne liczby", () => {
    const fobos = trends.worlds.fobos;
    // Bez spacji po obu stronach: separator tysięcy z `toLocaleString` to spacja
    // nierozdzielająca, a atrapa normalizuje białe znaki.
    const flat = (s: string) => s.replace(/\s/g, "");
    expect(flat(out.summary)).toContain(flat(fobos.total.at(-1).toLocaleString("pl-PL")));
    expect(out.summary).toContain("−5,3%"); // fobos wyludnia się najszybciej
    expect(out.tableRows).toBe(fobos.total.length); // nagłówek + n-1 wierszy zmian
    expect(out.singlePointHidden).toBe(true);
    expect(out.suspectHidden).toBe(true);
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

  test("świat z jedną migawką pokazuje punkt i notkę zamiast pustego wykresu", () => {
    expect(out.singleSnapshotWorld.points).toBe(1);
    expect(out.singleSnapshotWorld.noticeHidden).toBe(false);
    expect(out.singleSnapshotWorld.table).toBe("");
  });
});

describe("wspólny moduł nie może niczego uruchamiać", () => {
  test("shared.js nie dotyka DOM-u", () => {
    // app.js startuje dashboard od razu po załadowaniu, więc gdyby trends.js
    // importował app.js zamiast shared.js, wywaliłby się na obcym markupie.
    expect(sharedJs).not.toMatch(/\bdocument\b|\bwindow\b/);
    expect(trendsJs).not.toContain('from "./app.js"');
    expect(appJs).toContain('from "./shared.js"');
  });
});
