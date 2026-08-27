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
import { TRENDS_FILE, type Trends } from "@/src/trends.ts";
import { HISTORY_BUDGET_BYTES } from "@/public/history.js";
import { getValueFromJsonText } from "@/public/lib/json.js";
import { assert } from "@/public/lib/assert.js";
import { BYTES_IN_GIGABYTE, BYTES_IN_KILOBYTE, BYTES_IN_MEGABYTE } from "@/public/lib/byte-size.js";
import { getTextOrder } from "@/public/lib/text-order.js";
import { FILTER_SUFFIX } from "@/src/snapshot.ts";

/** GitHub Pages refuses to publish an artefact past this. Not ours to raise. */
const PAGES_LIMIT_BYTES = BYTES_IN_GIGABYTE;

async function getDirectorySizeBytes(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? await getDirectorySizeBytes(full) : (await stat(full)).size;
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
  snapshots += (await readdir(path.join(WORLDS_DIR, world))).filter((f) => f.endsWith(FILTER_SUFFIX)).length;
}

// The number of rounds is the longest history, not an average: a world that joined late
// has fewer snapshots without any round having been missed.
const rounds = Math.max(...worldNames.map((world) => trends.worlds[world]?.id.length ?? 0));

const artefactBytes = await getDirectorySizeBytes(PUBLIC_DIR);
const trendsGzipBytes = Bun.gzipSync(await Bun.file(TRENDS_FILE).bytes()).length;

const out = process.stdout;
out.write(`\nData in ${PUBLIC_DIR}/ — measured just now, not remembered\n\n`);
out.write(`  worlds     ${worldNames.length}\n`);
out.write(`  snapshots  ${snapshots}\n`);
out.write(`  rounds     ${rounds}  (the longest history; a world that joined late has fewer)\n`);
out.write(
  `  artefact   ${formatBytes(artefactBytes)} of ${formatBytes(PAGES_LIMIT_BYTES)}` +
    ` — ${((artefactBytes / PAGES_LIMIT_BYTES) * 100).toFixed(1)}% of the Pages limit\n`,
);
out.write(`  trends     ${formatBytes(trendsGzipBytes)} gzipped — what every visitor downloads\n`);

out.write(`\nWhat one snapshot costs a visitor, and how far a filtered history reaches\n`);
out.write(`(the transfer budget is ${formatBytes(HISTORY_BUDGET_BYTES)} — AGENTS.md §9.9)\n\n`);
out.write(`  world      snapshot     held   of   reach\n`);

const rows = worldNames
  .map((world) => {
    const trend = trends.worlds[world];
    assert(trend !== undefined, "a world listed in trends.json has a trend");
    // 0 means "not measured" — the client reads it the same way and falls back rather than
    // treating the world as free.
    const held = trend.bytes > 0 ? Math.floor(HISTORY_BUDGET_BYTES / trend.bytes) : trend.id.length;
    return { world, bytes: trend.bytes, held: Math.min(held, trend.id.length), of: trend.id.length };
  })
  .sort((a, b) => b.bytes - a.bytes);

for (const row of rows) {
  const trimmed = row.held < row.of;
  out.write(
    `  ${row.world.padEnd(9)} ${formatBytes(row.bytes).padStart(9)}` +
      ` ${String(row.held).padStart(6)} ${String(row.of).padStart(4)}` +
      `   ${trimmed ? "trimmed by the budget" : "whole history"}\n`,
  );
}

const trimmedWorlds = rows.filter((row) => row.held < row.of);
out.write(
  `\n  ${trimmedWorlds.length} of ${rows.length} worlds meet the ceiling` +
    `${trimmedWorlds.length > 0 ? `: ${trimmedWorlds.map((r) => r.world).join(", ")}` : ""}\n\n`,
);
