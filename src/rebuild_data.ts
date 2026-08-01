import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { WORLDS_DIR, rebuildManifest } from "./manifest.ts";
import {
  filterPathFor,
  isLegacySnapshot,
  namesPathFor,
  normalizeLegacyRows,
  splitNormalized,
  timestampFromFileName,
} from "./snapshot.ts";

// Utrzymanie danych w public/:
//   - migracja snapshotów z jednego pliku do pary `.f.json` / `.n.json`,
//   - przebudowa manifestu.
// Bezpieczne do wielokrotnego uruchamiania.

const args = process.argv.slice(2);
const keepLegacy = args.includes("--keep-legacy");

function mb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

let before = 0;
let after = 0;
let migrated = 0;

const worldDirs = (await readdir(WORLDS_DIR, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

for (const world of worldDirs) {
  const dir = path.join(WORLDS_DIR, world);
  const files = (await readdir(dir)).sort();
  const legacy = files.filter(isLegacySnapshot);

  for (const name of legacy) {
    const file = path.join(dir, name);
    const timestamp = timestampFromFileName(name);
    before += (await stat(file)).size;

    const payload = JSON.parse(await Bun.file(file).text());
    const rows = normalizeLegacyRows(payload);
    const { filters, names } = splitNormalized(rows, {
      world,
      timestamp,
      startedAt: payload.startedAt,
      finishedAt: payload.finishedAt,
      pages: payload.pages,
      skippedRows: payload.skippedRows,
    });

    const filterFile = filterPathFor(dir, timestamp);
    const namesFile = namesPathFor(dir, timestamp);
    await Bun.write(filterFile, JSON.stringify(filters));
    await Bun.write(namesFile, JSON.stringify(names));
    after += (await stat(filterFile)).size + (await stat(namesFile)).size;

    if (!keepLegacy) await unlink(file);
    migrated++;
  }

  process.stdout.write(`✓ ${world.padEnd(9)} ${String(legacy.length).padStart(2)} zmigrowanych\n`);
}

const manifest = await rebuildManifest();

if (migrated > 0) {
  process.stdout.write(`\nZmigrowano ${migrated} snapshotów: ${mb(before)} → ${mb(after)}\n`);
} else {
  process.stdout.write(`\nNic do migracji — wszystkie snapshoty są już rozdzielone.\n`);
}
process.stdout.write(`Manifest: ${manifest.worlds.length} światów\n`);
