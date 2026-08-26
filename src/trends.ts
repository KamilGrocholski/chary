import { readdir } from "node:fs/promises";
import path from "node:path";
import { PUBLIC_DIR, WORLDS_DIR } from "./manifest.ts";
import { timestampFromFileName, type FilterFile } from "./snapshot.ts";
import { writeAtomic } from "./atomic.ts";

// The folded history of one world: a single number per snapshot instead of hundreds of
// thousands of rows. The whole history (202 snapshots, 21 worlds) fits in ~24 KB, i.e.
// 9 KB gzipped — against the 14.9 MB it would cost to fetch the same snapshots as
// `.f.json`.
//
// The shape is dictated by what `public/history.js` draws and by nothing else: no level
// distribution (a 43× larger file) and no honor buckets, which that view does not read.
// Its predecessor, `src/aggregate.ts`, was deleted for exactly that — producing fields
// with no consumer. See docs/2026-08-04-spec-trends.md.

export const TRENDS_SCHEMA = 2;
export const TRENDS_FILE = path.join(PUBLIC_DIR, "trends.json");

/**
 * The activity bucket: 0 = <24h, 1 = 1-7 days, 2 = 8-30 days, 3 = >30 days, 4 = never.
 *
 * The buckets are **disjoint**, not cumulative — "active ≤7 days" is the sum of buckets
 * 0 and 1. It must agree value for value with `activityBucket` in `public/shared.js`;
 * a test holds that, because the two drifting apart would give a chart that disagrees
 * with the snapshot dashboard.
 */
export function activityBucket(days: number | null | undefined): number {
  if (days === null || days === undefined) return 4;
  if (days === 0) return 0;
  if (days <= 7) return 1;
  if (days <= 30) return 2;
  return 3;
}

export type SnapshotSummary = {
  total: number;
  /** Activity bucket counts, indexed as in `activityBucket`. */
  act: number[];
  /** Counts for professions 1-6. */
  byProf: number[];
};

export function summarizeSnapshot(filters: FilterFile): SnapshotSummary {
  const act = [0, 0, 0, 0, 0];
  const byProf = [0, 0, 0, 0, 0, 0];
  let total = 0;

  for (let i = 0; i < filters.count; i++) {
    const level = filters.level[i]!;
    const profession = filters.profession[i]!;
    // The same condition as `matches` in public/filters.js: a row with no level, or with
    // a profession outside 1-6, reaches no chart, so it must not count towards the
    // population.
    if (!level || level < 1 || profession < 1 || profession > 6) continue;

    total += 1;
    byProf[profession - 1]! += 1;
    act[activityBucket(filters.days[i])]! += 1;
  }

  return { total, act, byProf };
}

/** One world's history, columnar. Row i of every column is the same snapshot. */
export type WorldTrend = {
  id: string[];
  startedAt: string[];
  total: number[];
  act: number[][];
  byProf: number[][];
  suspect: number[];
  /**
   * What one of this world's snapshots costs over the wire: the gzip size of the newest
   * `.f.json`, in bytes. The history view spends its transfer budget in this currency, so
   * the ceiling falls on gordion (180 KB a snapshot) rather than on brutal (19 KB).
   *
   * One number per world, not per snapshot: per-snapshot sizes in the manifest measured
   * 5835 → 7164 B gzip, i.e. +1.3 KB on every visit for everyone — and within a world the
   * sizes barely move (gordion 177-185 KB), so count × this is accurate enough to choose a
   * count. The raw size will not do instead: the gzip ratio is 4.18 for brutal and 4.85 for
   * gordion, so a constant would misjudge one of them by 15%.
   */
  bytes: number;
};

export type Trends = {
  schema: number;
  builtAt: string;
  worlds: Record<string, WorldTrend>;
};

/**
 * Snapshots without `startedAt` are skipped: the identifier is not a date (files from
 * before August 2026 carry local time in the name), so there is nowhere to put them on the
 * time axis. How many dropped out is reported by `rebuildTrends` — losing data silently is
 * not allowed.
 */
export function buildWorldTrend(snapshots: { id: string; filters: FilterFile }[], bytes = 0): WorldTrend {
  // `bytes` is filled in by `rebuildTrends`, which is the only place that knows the files
  // themselves rather than their parsed contents.
  const trend: WorldTrend = {
    id: [],
    startedAt: [],
    total: [],
    act: [[], [], [], [], []],
    byProf: [[], [], [], [], [], []],
    suspect: [],
    // 0 means "not measured". The client reads it as unknown and falls back to a count,
    // rather than treating a world as free and pulling its whole history.
    bytes,
  };

  const dated = snapshots.filter((s) => typeof s.filters.startedAt === "string" && s.filters.startedAt !== "");
  dated.sort((a, b) => a.filters.startedAt!.localeCompare(b.filters.startedAt!));

  for (const { id, filters } of dated) {
    const { total, act, byProf } = summarizeSnapshot(filters);
    trend.id.push(id);
    trend.startedAt.push(filters.startedAt!);
    trend.total.push(total);
    act.forEach((count, bucket) => trend.act[bucket]!.push(count));
    byProf.forEach((count, index) => trend.byProf[index]!.push(count));
    trend.suspect.push(filters.suspect ? 1 : 0);
  }

  return trend;
}

/** The size the browser actually downloads — GitHub Pages serves these files gzipped. */
function gzipSize(bytes: ArrayBuffer): number {
  return Bun.gzipSync(new Uint8Array(bytes)).length;
}

/**
 * Rebuilds `public/trends.json` in full. A separate pass over the `.f.json` files from the
 * manifest's — that is ~0.9 s against a ~1.6 h scrape round, and the price of being able to
 * rebuild the trends without touching the manifest and the other way round.
 */
export async function rebuildTrends(): Promise<{ trends: Trends; skipped: number }> {
  const worldDirs = (await readdir(WORLDS_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const worlds: Record<string, WorldTrend> = {};
  let skipped = 0;

  for (const world of worldDirs) {
    const dir = path.join(WORLDS_DIR, world);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".f.json")).sort();

    const snapshots: { id: string; filters: FilterFile }[] = [];
    for (const file of files) {
      // An unreadable file is skipped with a warning rather than taking down the whole
      // rebuild — otherwise a single snapshot truncated by Ctrl-C blocks `bun run rebuild`,
      // which is exactly the command meant to repair it.
      let filters: FilterFile;
      try {
        filters = JSON.parse(await Bun.file(path.join(dir, file)).text()) as FilterFile;
      } catch (e) {
        console.warn(`⚠ skipped unreadable snapshot ${world}/${file}: ${e instanceof Error ? e.message : e}`);
        continue;
      }
      snapshots.push({ id: timestampFromFileName(file), filters });
    }

    const trend = buildWorldTrend(snapshots);
    skipped += snapshots.length - trend.id.length;
    // A world without a single dated snapshot would have nothing to show on a time axis.
    if (trend.id.length === 0) continue;

    // What the next snapshot of this world will cost the client. Only the newest file is
    // compressed — 21 of them instead of 244, and within one world the sizes barely move.
    trend.bytes = gzipSize(await Bun.file(path.join(dir, `${trend.id.at(-1)}.f.json`)).arrayBuffer());
    worlds[world] = trend;
  }

  const trends: Trends = { schema: TRENDS_SCHEMA, builtAt: new Date().toISOString(), worlds };
  await writeAtomic(TRENDS_FILE, JSON.stringify(trends));
  return { trends, skipped };
}
