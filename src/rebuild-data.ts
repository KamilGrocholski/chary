import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { WORLDS_DIR, rebuildManifest } from "@/src/manifest.ts";
import {
  composeFilterPath,
  isLegacySnapshot,
  composeNamesPath,
  normalizeLegacyRows,
  SnapshotReadError,
  splitNormalized,
  getTimestampFromFileName,
} from "@/src/snapshot.ts";
import { rebuildTrends } from "@/src/trends.ts";
import { getValueFromJsonText } from "@/src/lib/json.ts";
import { BYTES_IN_MEGABYTE } from "@/src/lib/byte-size.ts";
import { getIntegerFromValue } from "@/src/lib/number.ts";
import { writeAtomic } from "@/src/atomic.ts";

// Data maintenance in public/:
//   - migrating single-file snapshots into a `.f.json` / `.n.json` pair,
//   - rebuilding the manifest,
//   - rebuilding the trends (`public/trends.json`).
// Safe to run repeatedly.

type LegacySnapshot = {
  schema?: number;
  rows: unknown[][];
  startedAt?: string;
  finishedAt?: string;
  pages?: number;
  skippedRows?: number;
};

/**
 * A snapshot in the old single-file format, or `null` — never a cast.
 *
 * Only the fields the migration carries across are read, and each is read rather than
 * asserted: an old file that never had a `pages` count must come out the other side
 * without one, not with a zero somebody could mistake for a measurement.
 */
function readLegacySnapshot(value: unknown): LegacySnapshot | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;

  if (!Array.isArray(candidate.rows)) return null;
  if (!candidate.rows.every((row) => Array.isArray(row))) return null;

  const readOptionalText = (field: unknown) => (typeof field === "string" && field !== "" ? field : undefined);
  const readOptionalCount = (field: unknown) => getIntegerFromValue(field) ?? undefined;

  return {
    ...(getIntegerFromValue(candidate.schema) === null ? {} : { schema: getIntegerFromValue(candidate.schema) ?? undefined }),
    rows: candidate.rows as unknown[][],
    startedAt: readOptionalText(candidate.startedAt),
    finishedAt: readOptionalText(candidate.finishedAt),
    pages: readOptionalCount(candidate.pages),
    skippedRows: readOptionalCount(candidate.skippedRows),
  };
}

const argumentTexts = process.argv.slice(2);
const keepLegacy = argumentTexts.includes("--keep-legacy");

function formatMegabytes(bytes: number) {
  return `${(bytes / BYTES_IN_MEGABYTE).toFixed(1)} MB`;
}

let before = 0;
let after = 0;
let migrated = 0;

const worldDirs = (await readdir(WORLDS_DIR, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const world of worldDirs) {
  const directory = path.join(WORLDS_DIR, world);
  const files = (await readdir(directory)).sort();
  const legacy = files.filter(isLegacySnapshot);

  for (const name of legacy) {
    const file = path.join(directory, name);
    const timestamp = getTimestampFromFileName(name);
    before += (await stat(file)).size;

    const reading = getValueFromJsonText(await Bun.file(file).text());
    if (!reading.ok) {
      // Refused rather than skipped: this is the command that rewrites the only copy of a
      // snapshot, so a file it cannot read is a file it must not touch (§9.2).
      throw new SnapshotReadError(`${file}: ${reading.error.message}`);
    }
    const payload = readLegacySnapshot(reading.value);
    if (payload === null) throw new SnapshotReadError(`${file}: readable JSON, but not a snapshot`);

    const rows = normalizeLegacyRows(payload);
    const { filters, names } = splitNormalized(rows, {
      world,
      timestamp,
      // Carried across only where the old file actually held one. A migration that
      // invented a `startedAt` would put a snapshot on the time axis at a moment nobody
      // scraped it, and `trends.json` would look complete while being wrong (§9.2).
      ...(payload.startedAt === undefined ? {} : { startedAt: payload.startedAt }),
      ...(payload.finishedAt === undefined ? {} : { finishedAt: payload.finishedAt }),
      ...(payload.pages === undefined ? {} : { pages: payload.pages }),
      ...(payload.skippedRows === undefined ? {} : { skippedRows: payload.skippedRows }),
    });

    const filterFile = composeFilterPath(directory, timestamp);
    const namesFile = composeNamesPath(directory, timestamp);
    await writeAtomic(filterFile, JSON.stringify(filters));
    await writeAtomic(namesFile, JSON.stringify(names));
    after += (await stat(filterFile)).size + (await stat(namesFile)).size;

    if (!keepLegacy) await unlink(file);
    migrated++;
  }

  process.stdout.write(`✓ ${world.padEnd(9)} ${String(legacy.length).padStart(2)} migrated\n`);
}

const manifest = await rebuildManifest();
const { trends, skipped } = await rebuildTrends();

if (migrated > 0) {
  process.stdout.write(`\nMigrated ${migrated} snapshots: ${formatMegabytes(before)} → ${formatMegabytes(after)}\n`);
} else {
  process.stdout.write(`\nNothing to migrate — every snapshot is already split.\n`);
}
process.stdout.write(`Manifest: ${manifest.worlds.length} worlds\n`);

const points = Object.values(trends.worlds).reduce((sum, world) => sum + world.id.length, 0);
process.stdout.write(`Trends: ${Object.keys(trends.worlds).length} worlds, ${points} snapshots\n`);
if (skipped > 0) {
  // A snapshot without `startedAt` has nowhere to stand on a time axis — but it has to be
  // visible that it dropped out.
  process.stdout.write(`  ⚠ skipped ${skipped} snapshots with no startedAt\n`);
}
