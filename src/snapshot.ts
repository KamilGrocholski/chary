import { readdir } from "node:fs/promises";
import path from "node:path";
import { parseLastOnlineDays, type PlayerRow } from "./parser.ts";

// A snapshot is written as two complementary files sharing one row order
// (row i ↔ rank i+1), so together they reconstruct it 1:1 and nothing is duplicated:
//
//   <ts>.f.json  — level/profession/honor/days, columnar. That is everything filtering
//                  and the charts need, so the dashboard always loads this file
//                  (~100 KB gzipped, ~200 KB for the largest world).
//   <ts>.n.json  — nicknames and charIds. Needed only for a player search and for
//                  following progression, so fetched only then.
//
// Nicknames and charIds are ~2/3 of a snapshot's volume and useless to filtering —
// hence the split.

export const SNAPSHOT_SCHEMA = 3;

export type SnapshotMeta = {
  world: string;
  /**
   * The snapshot's identifier (the stem of the filename), NOT a date. Files from before
   * August 2026 carry local time in it, newer ones UTC — displaying a date and measuring
   * intervals use `startedAt` and nothing else. The field name stayed as it is in the
   * written data; renaming it would mean rewriting 362 files for cosmetics.
   */
  timestamp: string;
  startedAt?: string;
  finishedAt?: string;
  pages?: number;
  skippedRows?: number;
  /** Set when a world's population dropped suspiciously far — see `checkPopulationDrop`. */
  suspect?: PopulationDrop;
};

/**
 * The signal that a snapshot may be truncated. During an outage the ranking can return
 * fewer pages, and the resulting snapshot is formally valid — the only thing that gives it
 * away is a sudden population drop against the previous one (normally fractions of
 * a percent per round).
 */
export type PopulationDrop = {
  reason: string;
  previousCount: number;
  count: number;
  /** The share of players lost, e.g. 0.12 = −12%. */
  drop: number;
};

/** The default threshold: a drop of more than 5% of a world's population between rounds. */
export const DEFAULT_DROP_THRESHOLD = 0.05;

export function checkPopulationDrop(
  count: number,
  previousCount: number | null,
  threshold = DEFAULT_DROP_THRESHOLD,
): PopulationDrop | null {
  // Population growth is normal and signals nothing — we only look at drops.
  if (previousCount === null || previousCount <= 0 || count >= previousCount) return null;

  const drop = (previousCount - count) / previousCount;
  if (drop <= threshold) return null;

  return {
    // Polish on purpose: the dashboard renders this sentence to a player verbatim
    // (`suspect` in public/app.js). See "Language" in AGENTS.md.
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
  /** 0 = "less than 24 h ago", N = "N days ago", null = an account never used. */
  days: (number | null)[];
};

export type NamesFile = {
  schema: number;
  kind: "names";
  world: string;
  timestamp: string;
  count: number;
  name: string[];
  /** Absent for snapshots from before August 2026 — the ranking was not parsed this way then. */
  charId?: (number | null)[];
};

/** A normalised row, independent of the schema the snapshot was written in. */
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
 * Reads an old snapshot (schema v1 from before 07.2026, or v2) and returns normalised
 * rows — used when migrating the history into the split format.
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
 * The player count of a world's newest snapshot — the guard's reference point.
 * A missing directory, no snapshots or an unreadable file is not an error: a new world
 * simply has nothing to compare against.
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

// ── Paths ─────────────────────────────────────────────────────────────────────

export function filterPathFor(dir: string, timestamp: string) {
  return path.join(dir, `${timestamp}.f.json`);
}

export function namesPathFor(dir: string, timestamp: string) {
  return path.join(dir, `${timestamp}.n.json`);
}

/** Whether the filename is a snapshot in the old, single-file format. */
export function isLegacySnapshot(fileName: string) {
  return fileName.endsWith(".json") && !/\.(f|n)\.json$/.test(fileName);
}

export function timestampFromFileName(fileName: string) {
  return fileName.replace(/\.(f|n)?\.?json$/, "");
}
