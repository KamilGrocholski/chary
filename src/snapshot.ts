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
  timestamp: string;
  startedAt?: string;
  finishedAt?: string;
  pages?: number;
  skippedRows?: number;
};

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
