import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { isLegacySnapshot, timestampFromFileName } from "./snapshot.ts";

export const PUBLIC_DIR = "public";
export const WORLDS_DIR = path.join(PUBLIC_DIR, "worlds");
export const MANIFEST_FILE = path.join(PUBLIC_DIR, "manifest.json");

export type SnapshotEntry = {
  timestamp: string;
  /** Poziom/profesja/honor/dni — dashboard ładuje zawsze. */
  filters: string;
  /** Nicki i charId — dopiero przy wyszukiwarce gracza. */
  names?: string;
  /** Snapshot w starym, jednoplikowym formacie — tylko dopóki nie zmigrowany. */
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

    const timestamps = new Set(names.map(timestampFromFileName));
    const snapshots: SnapshotEntry[] = [];

    for (const timestamp of timestamps) {
      const filters = `${timestamp}.f.json`;
      const legacy = `${timestamp}.json`;
      if (!present.has(filters) && !present.has(legacy)) continue;

      snapshots.push({
        timestamp,
        filters: rel(present.has(filters) ? filters : legacy),
        ...(present.has(`${timestamp}.n.json`) ? { names: rel(`${timestamp}.n.json`) } : {}),
        ...(present.has(legacy) ? { file: rel(legacy) } : {}),
      });
    }

    snapshots.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    manifest.worlds.push({ name: worldName, files: snapshots });
  }

  manifest.worlds.sort((a, b) => a.name.localeCompare(b.name));
  await Bun.write(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
  return manifest;
}

export { isLegacySnapshot };
