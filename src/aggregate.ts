import path from "node:path";
import type { FilterFile } from "./snapshot.ts";

// Agregat to zwinięty rozkład populacji (~8 KB). Dashboard go dziś nie potrzebuje —
// filtruje dokładnie na pliku `.f.json` — ale dla widoków obejmujących wiele migawek
// naraz (trend populacji przez 9 snapshotów) 9×8 KB bije 9×500 KB.
// Generowany na żądanie: `bun run rebuild --agg`.

export const AGG_SCHEMA = 2;

/** 0: <24h, 1: ≤7 dni, 2: ≤30 dni, 3: >30 dni, 4: nigdy */
export const ACTIVITY_BUCKETS = ["<24h", "≤7 dni", "≤30 dni", ">30 dni", "nigdy"] as const;

/** 0: 0, 1: 1-99, 2: 100-999, 3: 1k-9,999, 4: 10k-99,999, 5: 100k+ */
export const HONOR_BUCKETS = ["0", "1-99", "100-999", "1k-9,999", "10k-99,999", "100k+"] as const;

export type Aggregate = {
  schema: number;
  world: string;
  timestamp: string;
  startedAt?: string;
  total: number;
  /** [poziom, [liczba dla profesji 1..6]] */
  levels: [number, number[]][];
  activity: [number, number[]][];
  honor: [number, number[]][];
  byProfession: number[];
};

export function activityBucket(days: number | null): number {
  if (days === null) return 4;
  if (days === 0) return 0;
  if (days <= 7) return 1;
  if (days <= 30) return 2;
  return 3;
}

export function honorBucket(honor: number): number {
  if (honor <= 0) return 0;
  if (honor < 100) return 1;
  if (honor < 1_000) return 2;
  if (honor < 10_000) return 3;
  if (honor < 100_000) return 4;
  return 5;
}

export function buildAggregate(filters: FilterFile): Aggregate {
  const emptyRow = () => [0, 0, 0, 0, 0, 0];

  const levels = new Map<number, number[]>();
  const activity = new Map<number, number[]>();
  const honor = new Map<number, number[]>();
  const byProfession = emptyRow();
  let total = 0;

  const bump = (map: Map<number, number[]>, key: number, profIndex: number) => {
    let counts = map.get(key);
    if (!counts) {
      counts = emptyRow();
      map.set(key, counts);
    }
    counts[profIndex]! += 1;
  };

  for (let i = 0; i < filters.count; i++) {
    const level = filters.level[i]!;
    const profession = filters.profession[i]!;
    if (level < 1 || profession < 1 || profession > 6) continue;

    const profIndex = profession - 1;
    total += 1;
    byProfession[profIndex]! += 1;
    bump(levels, level, profIndex);
    bump(activity, activityBucket(filters.days[i] ?? null), profIndex);
    bump(honor, honorBucket(filters.honor[i]!), profIndex);
  }

  const sorted = (map: Map<number, number[]>): [number, number[]][] =>
    [...map.entries()].sort((a, b) => a[0] - b[0]);

  return {
    schema: AGG_SCHEMA,
    world: filters.world,
    timestamp: filters.timestamp,
    startedAt: filters.startedAt,
    total,
    levels: sorted(levels),
    activity: sorted(activity),
    honor: sorted(honor),
    byProfession,
  };
}

export function aggPathFor(dir: string, timestamp: string) {
  return path.join(dir, `${timestamp}.agg.json`);
}
