import { readdir } from "node:fs/promises";
import path from "node:path";
import { PUBLIC_DIR, WORLDS_DIR } from "@/src/manifest.ts";
import { FILTER_SUFFIX, getTimestampFromFileName, type FilterFile } from "@/src/snapshot.ts";
import { writeAtomic } from "@/src/atomic.ts";
import { assertDefined } from "@/src/lib/assert.ts";
import { getValueFromJsonText } from "@/src/lib/json.ts";
import { getTextOrder } from "@/src/lib/text-order.ts";
import {
  composeActivityCounts,
  composeActivitySeries,
  composeProfessionCounts,
  composeProfessionSeries,
  getActivityBucket,
} from "@/src/shared.ts";

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
 * The few numbers a chart draws — one row of `trends.json`. Stated once, in
 * `public/shared.js`, because the browser computes the same shape when a filter is set and
 * the two paths must be indistinguishable to the drawing (§9.6). Re-exported here so the
 * scraper's callers read it from the module that builds it.
 */
export type SnapshotSummary = import("@/src/shared.ts").SnapshotSummary;

export function summarizeSnapshot(filters: FilterFile): SnapshotSummary {
  const act = composeActivityCounts();
  const byProf = composeProfessionCounts();
  let total = 0;

  for (let index = 0; index < filters.count; index++) {
    // `count` is the row count of every column — the whole premise of the columnar format
    // (§9.2), so a short column is a broken file rather than a case to handle.
    const level = assertDefined(filters.level[index], "every .f.json column holds `count` rows");
    const profession = assertDefined(filters.profession[index], "every .f.json column holds `count` rows");

    // The same condition as `isMatch` in public/filters.js: a row with no level, or with
    // a profession outside 1-6, reaches no chart, so it must not count towards the
    // population.
    if (!level || level < 1 || profession < 1 || profession > 6) continue;

    const bucket = getActivityBucket(filters.days[index]);
    total += 1;
    byProf[profession - 1] = assertDefined(byProf[profession - 1], "professions are 1-6") + 1;
    act[bucket] = assertDefined(act[bucket], "getActivityBucket answers 0-4") + 1;
  }

  return { total, act, byProf };
}

/**
 * One world's folded history, columnar. Stated once in `public/shared.js` for the same
 * reason as `SnapshotSummary`: this is the shape of a file this repository publishes and the
 * browser reads, so it has one definition and not one per side.
 */
export type WorldTrend = import("@/src/shared.ts").WorldTrend;

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
    act: composeActivitySeries(),
    byProf: composeProfessionSeries(),
    suspect: [],
    // 0 means "not measured". The client reads it as unknown and falls back to a count,
    // rather than treating a world as free and pulling its whole history.
    bytes,
  };

  // Narrowed once, into a shape that carries the date — rather than filtered and then
  // re-asserted with `!` at each of the three places that read it back.
  const dated: { id: string; startedAt: string; filters: FilterFile }[] = [];
  for (const { id, filters } of snapshots) {
    const { startedAt } = filters;
    if (typeof startedAt !== "string" || startedAt === "") continue;
    dated.push({ id, startedAt, filters });
  }
  dated.sort((left, right) => getTextOrder(left.startedAt, right.startedAt));

  for (const { id, startedAt, filters } of dated) {
    const { total, act, byProf } = summarizeSnapshot(filters);
    trend.id.push(id);
    trend.startedAt.push(startedAt);
    trend.total.push(total);
    act.forEach((count, bucket) =>
      assertDefined(trend.act[bucket], "a summary has one count per activity bucket").push(count),
    );
    byProf.forEach((count, index) =>
      assertDefined(trend.byProf[index], "a summary has one count per profession").push(count),
    );
    trend.suspect.push(filters.suspect ? 1 : 0);
  }

  return trend;
}

/**
 * A parsed snapshot, or `null` — never a cast.
 *
 * `JSON.parse(...) as FilterFile` is how a file truncated mid-write became a snapshot with
 * `undefined` columns: every field typed, none of them there, and the first sign of it was
 * an aggregate silently missing a world. Checking the columns is cheap next to the pass
 * over their contents that follows.
 *
 * Exported at its second consumer and not before (§7.1): `tools/data-status.ts` reports
 * `overlapRows` off the same files, and a status tool that read them its own way would be
 * a second answer to "is this a snapshot" for the guards to hold together.
 */
export function readFilterFile(value: unknown): FilterFile | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;

  if (typeof candidate.count !== "number") return null;
  for (const column of ["level", "profession", "honor", "days"]) {
    const rows = candidate[column];
    if (!Array.isArray(rows) || rows.length !== candidate.count) return null;
  }

  return candidate as unknown as FilterFile;
}

/** The size the browser actually downloads — GitHub Pages serves these files gzipped. */
function getGzipSizeBytes(bytes: ArrayBuffer): number {
  return Bun.gzipSync(new Uint8Array(bytes)).length;
}

/**
 * Rebuilds `public/trends.json` in full. A separate pass over the `.f.json` files from the
 * manifest's — that is ~0.9 s against a ~1.6 h scrape round, and the price of being able to
 * rebuild the trends without touching the manifest and the other way round.
 */
export async function rebuildTrends(): Promise<{ trends: Trends; skipped: number }> {
  const worldDirs = (await readdir(WORLDS_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const worlds: Record<string, WorldTrend> = {};
  let skipped = 0;

  for (const world of worldDirs) {
    const directory = path.join(WORLDS_DIR, world);
    const files = (await readdir(directory)).filter((file) => file.endsWith(FILTER_SUFFIX)).sort();

    const snapshots: { id: string; filters: FilterFile }[] = [];
    for (const file of files) {
      // An unreadable file is skipped with a warning rather than taking down the whole
      // rebuild — otherwise a single snapshot truncated by Ctrl-C blocks `bun run rebuild`,
      // which is exactly the command meant to repair it.
      const reading = getValueFromJsonText(await Bun.file(path.join(directory, file)).text());
      if (!reading.ok) {
        // The boundary with a file another process may have truncated (§9.5). Skipped with
        // a warning rather than fatal: a snapshot cut short by a Ctrl-C must not block
        // `bun run rebuild`, which is the command meant to repair it.
        console.warn(`⚠ skipped unreadable snapshot ${world}/${file}: ${reading.error.message}`);
        continue;
      }

      const filters = readFilterFile(reading.value);
      if (filters === null) {
        console.warn(`⚠ skipped ${world}/${file}: readable JSON, but not a snapshot`);
        continue;
      }
      snapshots.push({ id: getTimestampFromFileName(file), filters });
    }

    const trend = buildWorldTrend(snapshots);
    skipped += snapshots.length - trend.id.length;
    // A world without a single dated snapshot would have nothing to show on a time axis.
    if (trend.id.length === 0) continue;

    // What the next snapshot of this world will cost the client. Only the newest file is
    // compressed — 21 of them instead of 244, and within one world the sizes barely move.
    trend.bytes = getGzipSizeBytes(await Bun.file(path.join(directory, `${trend.id.at(-1)}${FILTER_SUFFIX}`)).arrayBuffer());
    worlds[world] = trend;
  }

  const trends: Trends = { schema: TRENDS_SCHEMA, builtAt: new Date().toISOString(), worlds };
  await writeAtomic(TRENDS_FILE, JSON.stringify(trends));
  return { trends, skipped };
}
