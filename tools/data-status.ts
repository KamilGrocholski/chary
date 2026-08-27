/**
 * What is in `public/` right now.
 *
 * Every figure this prints used to sit in AGENTS.md as prose — the snapshot count, the
 * number of rounds, the size of the artefact against the Pages limit, what one snapshot
 * costs a visitor. Each of them goes stale on the next scrape, and a stale number in a
 * document reads exactly like a measured one: the last drift stood for two rounds before
 * anybody noticed. AGENTS.md §5 says the numbers live here instead, and this is here.
 *
 * Reads and prints. It writes nothing, so it is safe to run at any point in a round.
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { PUBLIC_DIR, WORLDS_DIR } from "@/src/manifest.ts";
import { TRENDS_FILE, readFilterFile, type Trends } from "@/src/trends.ts";
import { HISTORY_BUDGET_BYTES } from "@/public/history.js";
import { getValueFromJsonText } from "@/public/lib/json.js";
import { assert } from "@/public/lib/assert.js";
import { BYTES_IN_GIGABYTE, BYTES_IN_KILOBYTE, BYTES_IN_MEGABYTE } from "@/public/lib/byte-size.js";
import { getTextOrder } from "@/public/lib/text-order.js";
import { FILTER_SUFFIX, getTimestampFromFileName } from "@/src/snapshot.ts";

/** GitHub Pages refuses to publish an artefact past this. Not ours to raise. */
const PAGES_LIMIT_BYTES = BYTES_IN_GIGABYTE;

async function getDirectorySizeBytes(directory: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    total += entry.isDirectory() ? await getDirectorySizeBytes(fullPath) : (await stat(fullPath)).size;
  }
  return total;
}

function formatBytes(bytes: number): string {
  if (bytes >= BYTES_IN_GIGABYTE) return `${(bytes / BYTES_IN_GIGABYTE).toFixed(2)} GB`;
  if (bytes >= BYTES_IN_MEGABYTE) return `${(bytes / BYTES_IN_MEGABYTE).toFixed(1)} MB`;
  if (bytes >= BYTES_IN_KILOBYTE) return `${(bytes / BYTES_IN_KILOBYTE).toFixed(1)} KB`;
  return `${bytes} B`;
}

const trendsReading = getValueFromJsonText(await Bun.file(TRENDS_FILE).text());
assert(trendsReading.ok, "public/trends.json is readable — run `bun run rebuild` if it is not");
const trends = trendsReading.value as Trends;

const worldNames = Object.keys(trends.worlds).sort(getTextOrder);
let snapshots = 0;
for (const world of worldNames) {
  snapshots += (await readdir(path.join(WORLDS_DIR, world))).filter((file) => file.endsWith(FILTER_SUFFIX)).length;
}

// The number of rounds is the longest history, not an average: a world that joined late
// has fewer snapshots without any round having been missed.
const rounds = Math.max(...worldNames.map((world) => trends.worlds[world]?.id.length ?? 0));

const artefactBytes = await getDirectorySizeBytes(PUBLIC_DIR);
const trendsGzipBytes = Bun.gzipSync(await Bun.file(TRENDS_FILE).bytes()).length;

const output = process.stdout;
output.write(`\nData in ${PUBLIC_DIR}/ — measured just now, not remembered\n\n`);
output.write(`  worlds     ${worldNames.length}\n`);
output.write(`  snapshots  ${snapshots}\n`);
output.write(`  rounds     ${rounds}  (the longest history; a world that joined late has fewer)\n`);
output.write(
  `  artefact   ${formatBytes(artefactBytes)} of ${formatBytes(PAGES_LIMIT_BYTES)}` +
    ` — ${((artefactBytes / PAGES_LIMIT_BYTES) * 100).toFixed(1)}% of the Pages limit\n`,
);
output.write(`  trends     ${formatBytes(trendsGzipBytes)} gzipped — what every visitor downloads\n`);

output.write(`\nWhat one snapshot costs a visitor, and how far a filtered history reaches\n`);
output.write(`(the transfer budget is ${formatBytes(HISTORY_BUDGET_BYTES)} — AGENTS.md §9.9)\n\n`);
output.write(`  world      snapshot     held   of   reach\n`);

const rows = worldNames
  .map((world) => {
    const trend = trends.worlds[world];
    assert(trend !== undefined, "a world listed in trends.json has a trend");
    // 0 means "not measured" — the client reads it the same way and falls back rather than
    // treating the world as free.
    const held = trend.bytes > 0 ? Math.floor(HISTORY_BUDGET_BYTES / trend.bytes) : trend.id.length;
    return { world, bytes: trend.bytes, held: Math.min(held, trend.id.length), of: trend.id.length };
  })
  .sort((left, right) => right.bytes - left.bytes);

for (const row of rows) {
  const trimmed = row.held < row.of;
  output.write(
    `  ${row.world.padEnd(9)} ${formatBytes(row.bytes).padStart(9)}` +
      ` ${String(row.held).padStart(6)} ${String(row.of).padStart(4)}` +
      `   ${trimmed ? "trimmed by the budget" : "whole history"}\n`,
  );
}

const trimmedWorlds = rows.filter((row) => row.held < row.of);
output.write(
  `\n  ${trimmedWorlds.length} of ${rows.length} worlds meet the ceiling` +
    `${trimmedWorlds.length > 0 ? `: ${trimmedWorlds.map((row) => row.world).join(", ")}` : ""}\n\n`,
);

// What the ranking moving under a walk cost that walk. Reading every `.f.json` in full
// costs ~0.6 s against the whole tree, which is cheaper than a prefix and a pattern that
// would go quietly wrong the day a field moves.
const overlaps: { world: string; id: string; overlapRows: number }[] = [];
let counted = 0;

for (const world of worldNames) {
  const directory = path.join(WORLDS_DIR, world);
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(FILTER_SUFFIX)).sort()) {
    const reading = getValueFromJsonText(await Bun.file(path.join(directory, file)).text());
    if (!reading.ok) continue;
    const filters = readFilterFile(reading.value);
    // Absent is not zero — a snapshot written before anything counted repeats says nothing
    // about how many it had, and printing it as 0 would be a measurement nobody took (§5).
    if (filters === null || typeof filters.overlapRows !== "number") continue;
    counted++;
    if (filters.overlapRows > 0) {
      overlaps.push({ world, id: getTimestampFromFileName(file), overlapRows: filters.overlapRows });
    }
  }
}

output.write(`Rows a walk fetched twice and dropped before writing — AGENTS.md §9.2\n\n`);
output.write(`  counted in  ${counted} of ${snapshots} snapshots`);
output.write(counted < snapshots ? `; the rest were written before anything counted\n` : `\n`);

if (counted === 0) {
  output.write(`\n`);
} else if (overlaps.length === 0) {
  output.write(`  carrying    none — every counted walk read a ranking that held still\n\n`);
} else {
  const total = overlaps.reduce((sum, entry) => sum + entry.overlapRows, 0);
  output.write(`  carrying    ${overlaps.length} snapshots, ${total} rows in total\n\n`);
  for (const entry of overlaps.sort((left, right) => right.overlapRows - left.overlapRows)) {
    output.write(`  ${entry.world.padEnd(9)} ${entry.id.padEnd(21)} ${String(entry.overlapRows).padStart(5)} rows\n`);
  }
  // The other direction of the same movement leaves nothing on the page to count, so this
  // is a floor under how far the ranking moved — never a count of what the walk missed.
  output.write(`\n  A walk that repeated rows also stepped over some. Those leave no trace.\n\n`);
}
