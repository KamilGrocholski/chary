import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  checkPopulationDrop,
  isLegacySnapshot,
  latestSnapshotCount,
  normalizeLegacyRows,
  splitNormalized,
  splitSnapshot,
  timestampFromFileName,
  SNAPSHOT_SCHEMA,
} from "../src/snapshot.ts";
import type { PlayerRow } from "../src/parser.ts";

const META = { world: "aether", timestamp: "2026-08-01T10-00-00" };

const rows: PlayerRow[] = [
  [1, "essobe", 729, 378, 4, 8749, 0],
  [2, "kamillek kox", 32789, 359, 3, 4715, 12],
  [3, "Widmo", 5, 100, 1, 0, null],
];

describe("rozdzielanie snapshotu", () => {
  const { filters, names } = splitSnapshot(rows, META);

  test("plik filtrów ma kolumny, których potrzebuje filtrowanie", () => {
    expect(filters.schema).toBe(SNAPSHOT_SCHEMA);
    expect(filters.count).toBe(3);
    expect(filters.level).toEqual([378, 359, 100]);
    expect(filters.profession).toEqual([4, 3, 1]);
    expect(filters.honor).toEqual([8749, 4715, 0]);
    expect(filters.days).toEqual([0, 12, null]);
  });

  test("plik nicków trzyma nick i charId w tej samej kolejności", () => {
    expect(names.name).toEqual(["essobe", "kamillek kox", "Widmo"]);
    expect(names.charId).toEqual([729, 32789, 5]);
  });

  test("w pliku filtrów nie ma nicków — to 2/3 objętości snapshotu", () => {
    expect(JSON.stringify(filters)).not.toContain("essobe");
  });

  test("oba pliki razem odtwarzają wiersze 1:1", () => {
    for (let i = 0; i < rows.length; i++) {
      expect([
        i + 1, // ranga z kolejności
        names.name[i],
        names.charId![i],
        filters.level[i],
        filters.profession[i],
        filters.honor[i],
        filters.days[i],
      ]).toEqual(rows[i]!);
    }
  });
});

describe("migracja starych snapshotów", () => {
  test("v1 — dni wyliczane z tekstu, ISO odrzucane, brak charId", () => {
    const v1 = {
      world: "aether",
      rows: [
        [1, "essobe", 378, 4, 8749, "Mniej niż 24h temu", "2026-07-21T20:03:12.814Z"],
        [2, "Ktoś", 300, 2, 10, "5 dni temu", "2026-07-16T20:03:12.814Z"],
        [3, "Widmo", 12, 1, 0, "20655 dni temu", "1969-12-06T00:00:00.000Z"],
      ],
    };
    const normalized = normalizeLegacyRows(v1);
    expect(normalized.map((r) => r.days)).toEqual([0, 5, null]);
    expect(normalized.map((r) => r.charId)).toEqual([null, null, null]);

    const { filters, names } = splitNormalized(normalized, META);
    expect(filters.level).toEqual([378, 300, 12]);
    expect(filters.honor).toEqual([8749, 10, 0]);
    // brak charId w danych → brak pustej kolumny w pliku
    expect(names.charId).toBeUndefined();
    expect(JSON.stringify(names)).not.toContain("charId");
  });

  test("v2 — czytane wprost, z zachowaniem charId", () => {
    const v2 = { schema: 2, world: "aether", rows: rows as unknown[][] };
    const normalized = normalizeLegacyRows(v2);
    expect(normalized.map((r) => r.charId)).toEqual([729, 32789, 5]);
    expect(normalized.map((r) => r.days)).toEqual([0, 12, null]);
    expect(splitNormalized(normalized, META).names.charId).toEqual([729, 32789, 5]);
  });
});

describe("rozpoznawanie plików", () => {
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
  ] as const)("timestampFromFileName(%p) → %p", (name, expected) => {
    expect(timestampFromFileName(name)).toBe(expected);
  });
});

describe("strażnik przed obciętym scrapem", () => {
  // Ranking podczas awarii potrafi oddać mniej stron. Taka migawka jest formalnie
  // poprawna — zdradza ją dopiero nagły spadek populacji, bo normalnie zmienia się
  // ona o ułamki procenta na rundę.

  test("normalny odpływ graczy przechodzi bez flagi", () => {
    expect(checkPopulationDrop(39037, 39287)).toBeNull(); // realny spadek aethera: 0,6%
    expect(checkPopulationDrop(9600, 10_000)).toBeNull(); // dokładnie 4%
    expect(checkPopulationDrop(9500, 10_000)).toBeNull(); // dokładnie próg 5%
  });

  test("spadek powyżej progu ustawia flagę z liczbami", () => {
    const suspect = checkPopulationDrop(9400, 10_000);
    expect(suspect).not.toBeNull();
    expect(suspect!.previousCount).toBe(10_000);
    expect(suspect!.count).toBe(9400);
    expect(suspect!.drop).toBeCloseTo(0.06, 5);
    expect(suspect!.reason).toContain("6.0%");
  });

  test("obcięty scrape — połowa stron nie doszła", () => {
    expect(checkPopulationDrop(4000, 8000)!.drop).toBe(0.5);
  });

  test("wzrost populacji nigdy nie jest podejrzany", () => {
    expect(checkPopulationDrop(12_000, 10_000)).toBeNull();
    expect(checkPopulationDrop(10_000, 10_000)).toBeNull();
  });

  test("nowy świat bez poprzedniej migawki nie jest podejrzany", () => {
    expect(checkPopulationDrop(5000, null)).toBeNull();
    expect(checkPopulationDrop(5000, 0)).toBeNull();
  });

  test("próg da się przestawić", () => {
    expect(checkPopulationDrop(9900, 10_000, 0.005)).not.toBeNull(); // czulszy: 1% > 0,5%
    expect(checkPopulationDrop(5000, 10_000, 0.9)).toBeNull(); // luźniejszy: 50% < 90%
  });

  test("flaga trafia do pliku filtrów, nie do pliku nicków", () => {
    const suspect = checkPopulationDrop(4000, 8000)!;
    const { filters, names } = splitSnapshot(rows, { ...META, suspect });
    expect(filters.suspect).toEqual(suspect);
    expect(JSON.stringify(names)).not.toContain("suspect");
  });

  test("zdrowa migawka nie niesie pola suspect", () => {
    expect(JSON.stringify(splitSnapshot(rows, META).filters)).not.toContain("suspect");
  });
});

describe("odczyt poprzedniej migawki", () => {
  const tmp = path.join(import.meta.dir, "..", "node_modules", ".tmp-snapshot-test");

  async function world(name: string, files: Record<string, unknown>) {
    const dir = path.join(tmp, name);
    await mkdir(dir, { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      await Bun.write(path.join(dir, file), JSON.stringify(content));
    }
    return dir;
  }

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  test("bierze count z najnowszej migawki, nie z pierwszej lepszej", async () => {
    const dir = await world("kolejnosc", {
      "2026-06-01T00-00-00.f.json": { count: 100 },
      "2026-08-01T00-00-00.f.json": { count: 300 },
      "2026-07-01T00-00-00.f.json": { count: 200 },
    });
    expect(await latestSnapshotCount(dir)).toBe(300);
  });

  test("pomija pliki nicków", async () => {
    const dir = await world("nicki", {
      "2026-08-01T00-00-00.f.json": { count: 42 },
      "2026-09-01T00-00-00.n.json": { count: 999 },
    });
    expect(await latestSnapshotCount(dir)).toBe(42);
  });

  test("nowy świat, uszkodzony plik i brak katalogu dają null zamiast wyjątku", async () => {
    expect(await latestSnapshotCount(path.join(tmp, "nie-ma-takiego"))).toBeNull();
    expect(await latestSnapshotCount(await world("pusty", {}))).toBeNull();

    const uszkodzony = path.join(tmp, "uszkodzony");
    await mkdir(uszkodzony, { recursive: true });
    await Bun.write(path.join(uszkodzony, "2026-08-01T00-00-00.f.json"), "{ to nie jest json");
    expect(await latestSnapshotCount(uszkodzony)).toBeNull();
  });

  test("razem ze strażnikiem: obcięta migawka zostaje oflagowana", async () => {
    const dir = await world("obciety", { "2026-07-01T00-00-00.f.json": { count: 7754 } });
    const suspect = checkPopulationDrop(3900, await latestSnapshotCount(dir));

    expect(suspect).not.toBeNull();
    expect(suspect!.drop).toBeCloseTo(0.497, 3);
    expect(suspect!.reason).toContain("7754 → 3900");
  });
});
