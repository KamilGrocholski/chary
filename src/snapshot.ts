import { readdir } from "node:fs/promises";
import path from "node:path";
import { parseLastOnlineDays, type PlayerRow } from "./parser.ts";

// Snapshot jest zapisywany w dwóch komplementarnych plikach o tej samej kolejności
// wierszy (wiersz i ↔ ranga i+1), więc razem odtwarzają go 1:1 i nic się nie dubluje:
//
//   <ts>.f.json  — kolumnowo poziom/profesja/honor/dni. To wszystko, czego potrzebuje
//                  filtrowanie i wykres, więc dashboard ładuje ten plik zawsze
//                  (~100 KB po gzipie dla największego świata ~200 KB).
//   <ts>.n.json  — nicki i charId. Potrzebne dopiero przy wyszukiwarce gracza
//                  i śledzeniu progresji, więc pobierane dopiero wtedy.
//
// Nicki i charId to ~2/3 objętości snapshotu, a do filtrowania są bezużyteczne —
// stąd ten podział.

export const SNAPSHOT_SCHEMA = 3;

export type SnapshotMeta = {
  world: string;
  /**
   * Identyfikator migawki (trzon nazwy pliku), NIE data. Pliki sprzed sierpnia 2026
   * mają w nim czas lokalny, nowsze UTC — do wyświetlania i liczenia odstępów służy
   * wyłącznie `startedAt`. Nazwa pola została taka, jaka była w zapisanych danych;
   * przemianowanie kosztowałoby przepisanie 362 plików dla samej kosmetyki.
   */
  timestamp: string;
  startedAt?: string;
  finishedAt?: string;
  pages?: number;
  skippedRows?: number;
  /** Ustawiane, gdy populacja świata spadła podejrzanie mocno — patrz `checkPopulationDrop`. */
  suspect?: PopulationDrop;
};

/**
 * Sygnał, że migawka może być obcięta. Ranking potrafi w czasie awarii zwrócić mniej
 * stron, a taki snapshot jest formalnie poprawny — jedyne, co go zdradza, to nagły
 * spadek populacji względem poprzedniej migawki (normalnie ułamki procenta na rundę).
 */
export type PopulationDrop = {
  reason: string;
  previousCount: number;
  count: number;
  /** Udział utraconych graczy, np. 0.12 = −12%. */
  drop: number;
};

/** Domyślny próg: spadek powyżej 5% populacji świata między rundami. */
export const DEFAULT_DROP_THRESHOLD = 0.05;

export function checkPopulationDrop(
  count: number,
  previousCount: number | null,
  threshold = DEFAULT_DROP_THRESHOLD,
): PopulationDrop | null {
  // Wzrost populacji jest normalny i niczego nie sygnalizuje — patrzymy tylko na spadki.
  if (previousCount === null || previousCount <= 0 || count >= previousCount) return null;

  const drop = (previousCount - count) / previousCount;
  if (drop <= threshold) return null;

  return {
    reason: `populacja spadła o ${(drop * 100).toFixed(1)}% względem poprzedniej migawki (${previousCount} → ${count}) — migawka może być obcięta`,
    previousCount,
    count,
    drop,
  };
}

export type FilterFile = SnapshotMeta & {
  schema: number;
  kind: "filter";
  count: number;
  level: number[];
  profession: number[];
  honor: number[];
  /** 0 = „Mniej niż 24h temu”, N = „N dni temu”, null = konto nigdy nieużywane. */
  days: (number | null)[];
};

export type NamesFile = {
  schema: number;
  kind: "names";
  world: string;
  timestamp: string;
  count: number;
  name: string[];
  /** Brak dla snapshotów sprzed sierpnia 2026 — ranking nie był wtedy tak parsowany. */
  charId?: (number | null)[];
};

/** Znormalizowany wiersz, niezależny od schematu, w jakim snapshot był zapisany. */
export type NormalizedRow = {
  name: string;
  charId: number | null;
  level: number;
  profession: number;
  honor: number;
  days: number | null;
};

export function splitSnapshot(rows: PlayerRow[], meta: SnapshotMeta): { filters: FilterFile; names: NamesFile } {
  return {
    filters: {
      schema: SNAPSHOT_SCHEMA,
      kind: "filter",
      ...meta,
      count: rows.length,
      level: rows.map((r) => r[3]),
      profession: rows.map((r) => r[4]),
      honor: rows.map((r) => r[5]),
      days: rows.map((r) => r[6]),
    },
    names: {
      schema: SNAPSHOT_SCHEMA,
      kind: "names",
      world: meta.world,
      timestamp: meta.timestamp,
      count: rows.length,
      name: rows.map((r) => r[1]),
      charId: rows.map((r) => r[2]),
    },
  };
}

/**
 * Czyta stary snapshot (schemat v1 sprzed 07.2026 lub v2) i zwraca znormalizowane
 * wiersze — używane przy migracji historii do formatu rozdzielonego.
 *
 * v1: [rank, name, level, prof, honor, lastOnlineText, lastOnlineISO]
 * v2: [rank, name, charId, level, prof, honor, lastOnlineDays]
 */
export function normalizeLegacyRows(payload: { schema?: number; rows: unknown[][] }): NormalizedRow[] {
  const schema = payload.schema ?? (typeof payload.rows[0]?.[5] === "string" ? 1 : 2);

  return payload.rows.map((row) => {
    if (schema >= 2) {
      return {
        name: String(row[1]),
        charId: row[2] === null || row[2] === undefined ? null : Number(row[2]),
        level: Number(row[3]),
        profession: Number(row[4]),
        honor: Number(row[5]),
        days: row[6] === null || row[6] === undefined ? null : Number(row[6]),
      };
    }
    const days = parseLastOnlineDays(String(row[5] ?? ""));
    return {
      name: String(row[1]),
      charId: null,
      level: Number(row[2]),
      profession: Number(row[3]),
      honor: Number(row[4]),
      days: days === undefined ? null : days,
    };
  });
}

export function splitNormalized(rows: NormalizedRow[], meta: SnapshotMeta): { filters: FilterFile; names: NamesFile } {
  const hasCharIds = rows.some((r) => r.charId !== null);
  return {
    filters: {
      schema: SNAPSHOT_SCHEMA,
      kind: "filter",
      ...meta,
      count: rows.length,
      level: rows.map((r) => r.level),
      profession: rows.map((r) => r.profession),
      honor: rows.map((r) => r.honor),
      days: rows.map((r) => r.days),
    },
    names: {
      schema: SNAPSHOT_SCHEMA,
      kind: "names",
      world: meta.world,
      timestamp: meta.timestamp,
      count: rows.length,
      name: rows.map((r) => r.name),
      ...(hasCharIds ? { charId: rows.map((r) => r.charId) } : {}),
    },
  };
}

/**
 * Liczba graczy w najnowszej migawce świata — punkt odniesienia dla strażnika.
 * Brak katalogu, brak migawek albo nieczytelny plik to nie błąd: nowy świat
 * po prostu nie ma z czym się porównać.
 */
export async function latestSnapshotCount(dir: string): Promise<number | null> {
  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".f.json")).sort();
    const last = files.at(-1);
    if (!last) return null;

    const { count } = JSON.parse(await Bun.file(path.join(dir, last)).text()) as { count?: number };
    return typeof count === "number" ? count : null;
  } catch {
    return null;
  }
}

// ── Ścieżki ───────────────────────────────────────────────────────────────────

export function filterPathFor(dir: string, timestamp: string) {
  return path.join(dir, `${timestamp}.f.json`);
}

export function namesPathFor(dir: string, timestamp: string) {
  return path.join(dir, `${timestamp}.n.json`);
}

/** Czy nazwa pliku to snapshot w starym, jednoplikowym formacie. */
export function isLegacySnapshot(fileName: string) {
  return fileName.endsWith(".json") && !/\.(f|n)\.json$/.test(fileName);
}

export function timestampFromFileName(fileName: string) {
  return fileName.replace(/\.(f|n)?\.?json$/, "");
}
