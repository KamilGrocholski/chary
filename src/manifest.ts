import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { isLegacySnapshot, timestampFromFileName } from "./snapshot.ts";
import { writeAtomic } from "./atomic.ts";

export const PUBLIC_DIR = "public";
export const WORLDS_DIR = path.join(PUBLIC_DIR, "worlds");
export const MANIFEST_FILE = path.join(PUBLIC_DIR, "manifest.json");

export type SnapshotEntry = {
  /**
   * The snapshot's opaque identifier — also the stem of its filenames.
   * NOT a date: files from before August 2026 carry local time in the name and newer ones
   * UTC, so comparing these strings is off by a timezone.
   * Displaying a date and measuring intervals use `startedAt`.
   */
  id: string;
  /** When the scrape started, ISO 8601 in UTC — the only trustworthy source of time. */
  startedAt?: string;
  /** Level/profession/honor/days — the dashboard always loads it. */
  filters: string;
  /** Nicknames and charIds — only once a player search exists. */
  names?: string;
  /** A snapshot in the old, single-file format — only until it is migrated. */
  file?: string;
};

export type Manifest = {
  worlds: { name: string; files: SnapshotEntry[] }[];
};

export async function rebuildManifest(): Promise<Manifest> {
  await mkdir(WORLDS_DIR, { recursive: true });

  const worldDirs = await readdir(WORLDS_DIR, { withFileTypes: true });
  const manifest: Manifest = { worlds: [] };

  for (const worldDir of worldDirs) {
    if (!worldDir.isDirectory()) continue;

    const worldName = worldDir.name;
    const names = (await readdir(path.join(WORLDS_DIR, worldName), { withFileTypes: true }))
      .filter((f) => f.isFile() && f.name.endsWith(".json"))
      .map((f) => f.name);
    const present = new Set(names);
    const rel = (file: string) => path.posix.join("worlds", worldName, file);

    const ids = new Set(names.map(timestampFromFileName));
    const snapshots: SnapshotEntry[] = [];

    for (const id of ids) {
      const filters = `${id}.f.json`;
      const legacy = `${id}.json`;
      if (!present.has(filters) && !present.has(legacy)) continue;

      const source = present.has(filters) ? filters : legacy;
      // `startedAt` lives inside the snapshot itself; the manifest lifts it out so the
      // dashboard does not have to fetch a few hundred kilobytes just to show a date.
      //
      // One corrupted file must not take the other 201 with it: without this, `JSON.parse`
      // took down the whole rebuild — including the command meant to repair it. A snapshot
      // with no date is handled anyway (`startedAt` is optional).
      let startedAt: string | undefined;
      try {
        ({ startedAt } = JSON.parse(await Bun.file(path.join(WORLDS_DIR, worldName, source)).text()) as {
          startedAt?: string;
        });
      } catch (e) {
        console.warn(`⚠ skipped unreadable snapshot ${worldName}/${source}: ${e instanceof Error ? e.message : e}`);
        continue;
      }

      snapshots.push({
        id,
        ...(startedAt ? { startedAt } : {}),
        filters: rel(source),
        ...(present.has(`${id}.n.json`) ? { names: rel(`${id}.n.json`) } : {}),
        ...(present.has(legacy) ? { file: rel(legacy) } : {}),
      });
    }

    // By the real scrape time, not by filename — otherwise snapshots from the timezone
    // seam would sit 2 h away from the truth relative to each other.
    snapshots.sort((a, b) => (a.startedAt ?? a.id).localeCompare(b.startedAt ?? b.id));
    manifest.worlds.push({ name: worldName, files: snapshots });
  }

  manifest.worlds.sort((a, b) => a.name.localeCompare(b.name));
  await writeAtomic(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
  return manifest;
}

export { isLegacySnapshot };
