import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { isLegacySnapshot, timestampFromFileName } from "./snapshot.ts";
import { writeAtomic } from "./atomic.ts";

export const PUBLIC_DIR = "public";
export const WORLDS_DIR = path.join(PUBLIC_DIR, "worlds");
export const MANIFEST_FILE = path.join(PUBLIC_DIR, "manifest.json");

export type SnapshotEntry = {
  /**
   * Nieprzezroczysty identyfikator migawki — zarazem trzon nazw plików.
   * NIE jest datą: pliki sprzed sierpnia 2026 mają w nazwie czas lokalny,
   * nowsze UTC, więc porównywanie tych stringów myli o strefę czasową.
   * Do wyświetlania i liczenia odstępów służy `startedAt`.
   */
  id: string;
  /** Moment rozpoczęcia scrapu, ISO 8601 w UTC — jedyne wiarygodne źródło czasu. */
  startedAt?: string;
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

    const ids = new Set(names.map(timestampFromFileName));
    const snapshots: SnapshotEntry[] = [];

    for (const id of ids) {
      const filters = `${id}.f.json`;
      const legacy = `${id}.json`;
      if (!present.has(filters) && !present.has(legacy)) continue;

      const source = present.has(filters) ? filters : legacy;
      // `startedAt` mieszka w samym snapshocie; manifest go wyciąga, żeby dashboard
      // nie musiał pobierać kilkuset kilobajtów tylko po to, by pokazać datę.
      //
      // Jeden uszkodzony plik nie może zabrać ze sobą pozostałych 201: bez tego
      // `JSON.parse` wywalał całą przebudowę, czyli także polecenie, którym miałoby
      // się to naprawić. Migawka bez daty i tak jest obsłużona (`startedAt` opcjonalne).
      let startedAt: string | undefined;
      try {
        ({ startedAt } = JSON.parse(await Bun.file(path.join(WORLDS_DIR, worldName, source)).text()) as {
          startedAt?: string;
        });
      } catch (e) {
        console.warn(`⚠ pominięto nieczytelny snapshot ${worldName}/${source}: ${e instanceof Error ? e.message : e}`);
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

    // Po realnym czasie scrapu, nie po nazwie pliku — inaczej migawki ze szwu
    // stref czasowych ustawiłyby się względem siebie o 2 h obok prawdy.
    snapshots.sort((a, b) => (a.startedAt ?? a.id).localeCompare(b.startedAt ?? b.id));
    manifest.worlds.push({ name: worldName, files: snapshots });
  }

  manifest.worlds.sort((a, b) => a.name.localeCompare(b.name));
  await writeAtomic(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
  return manifest;
}

export { isLegacySnapshot };
