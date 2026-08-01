import { describe, expect, test } from "bun:test";
import { buildAggregate } from "../src/aggregate.ts";
import {
  isLegacySnapshot,
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
    ["2026-07-21T22-04-12.agg.json", false],
  ] as const)("isLegacySnapshot(%p) → %p", (name, expected) => {
    expect(isLegacySnapshot(name)).toBe(expected);
  });

  test.each([
    ["2026-07-21T22-04-12.json", "2026-07-21T22-04-12"],
    ["2026-07-21T22-04-12.f.json", "2026-07-21T22-04-12"],
    ["2026-07-21T22-04-12.n.json", "2026-07-21T22-04-12"],
    ["2026-07-21T22-04-12.agg.json", "2026-07-21T22-04-12"],
  ] as const)("timestampFromFileName(%p) → %p", (name, expected) => {
    expect(timestampFromFileName(name)).toBe(expected);
  });
});

describe("agregat (generowany na żądanie)", () => {
  test("liczy rozkłady z pliku filtrów", () => {
    const { filters } = splitSnapshot(rows, META);
    const agg = buildAggregate(filters);

    expect(agg.total).toBe(3);
    expect(agg.byProfession).toEqual([1, 0, 1, 1, 0, 0]);
    expect(agg.levels.map(([level]) => level)).toEqual([100, 359, 378]);
    expect(agg.activity).toEqual([
      [0, [0, 0, 0, 1, 0, 0]], // <24h — tropiciel
      [2, [0, 0, 1, 0, 0, 0]], // ≤30 dni — paladyn
      [4, [1, 0, 0, 0, 0, 0]], // nigdy — wojownik
    ]);
  });
});
