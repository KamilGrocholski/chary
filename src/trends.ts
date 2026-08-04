import { readdir } from "node:fs/promises";
import path from "node:path";
import { PUBLIC_DIR, WORLDS_DIR } from "./manifest.ts";
import { timestampFromFileName, type FilterFile } from "./snapshot.ts";
import { writeAtomic } from "./atomic.ts";

// Zwinięta historia jednego świata: po jednej liczbie na migawkę zamiast setek tysięcy
// wierszy. Cała historia (202 migawki, 21 światów) mieści się w ~24 KB, czyli 9 KB po
// gzipie — wobec 14,9 MB, które kosztowałoby pobranie tych samych migawek z `.f.json`.
//
// Kształt jest podyktowany tym, co rysuje `public/trends.js`, i niczym więcej: bez
// rozkładu poziomów (43× większy plik) i bez koszyków honoru, których ten widok nie
// czyta. Poprzednik, `src/aggregate.ts`, został skasowany właśnie za produkowanie pól
// bez konsumenta — patrz docs/2026-08-04-spec-trendy.md.

export const TRENDS_SCHEMA = 1;
export const TRENDS_FILE = path.join(PUBLIC_DIR, "trends.json");

/**
 * Koszyk aktywności: 0 = <24h, 1 = 1-7 dni, 2 = 8-30 dni, 3 = >30 dni, 4 = nigdy.
 *
 * Koszyki są **rozłączne**, nie skumulowane — „aktywni ≤7 dni” to suma koszyków 0 i 1.
 * Musi zgadzać się co do wartości z `activityBucket` w `public/shared.js`; pilnuje tego
 * test, bo rozjazd tych dwóch funkcji dałby wykres niezgodny z dashboardem migawki.
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
  /** Liczności koszyków aktywności, indeksy jak w `activityBucket`. */
  act: number[];
  /** Liczności profesji 1-6. */
  byProf: number[];
};

export function summarizeSnapshot(filters: FilterFile): SnapshotSummary {
  const act = [0, 0, 0, 0, 0];
  const byProf = [0, 0, 0, 0, 0, 0];
  let total = 0;

  for (let i = 0; i < filters.count; i++) {
    const level = filters.level[i]!;
    const profession = filters.profession[i]!;
    // Ten sam warunek, co `matches` w public/app.js: wiersz bez poziomu albo z profesją
    // spoza 1-6 nie trafia na żaden wykres, więc nie może się liczyć do populacji.
    if (!level || level < 1 || profession < 1 || profession > 6) continue;

    total += 1;
    byProf[profession - 1]! += 1;
    act[activityBucket(filters.days[i])]! += 1;
  }

  return { total, act, byProf };
}

/** Historia jednego świata, kolumnowo. Wiersz i każdej kolumny to ta sama migawka. */
export type WorldTrend = {
  id: string[];
  startedAt: string[];
  total: number[];
  act: number[][];
  byProf: number[][];
  suspect: number[];
};

export type Trends = {
  schema: number;
  builtAt: string;
  worlds: Record<string, WorldTrend>;
};

/**
 * Migawki bez `startedAt` są pomijane: identyfikator nie jest datą (pliki sprzed
 * sierpnia 2026 mają w nazwie czas lokalny), więc nie ma ich gdzie postawić na osi
 * czasu. Ile ich wypadło, raportuje `rebuildTrends` — po cichu gubić danych nie wolno.
 */
export function buildWorldTrend(snapshots: { id: string; filters: FilterFile }[]): WorldTrend {
  const trend: WorldTrend = {
    id: [],
    startedAt: [],
    total: [],
    act: [[], [], [], [], []],
    byProf: [[], [], [], [], [], []],
    suspect: [],
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

/**
 * Przebudowuje `public/trends.json` w całości. Osobne przejście po `.f.json` niż
 * manifest — to ~0,9 s wobec ~1,6 h rundy scrapa, a cena za to, że trendy da się
 * odbudować bez ruszania manifestu i odwrotnie.
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
      // Nieczytelny plik pomijamy z ostrzeżeniem zamiast wywalać całą przebudowę —
      // inaczej jedna migawka obcięta przez Ctrl-C blokuje `bun run rebuild`, czyli
      // dokładnie to polecenie, którym miałoby się ją naprawić.
      let filters: FilterFile;
      try {
        filters = JSON.parse(await Bun.file(path.join(dir, file)).text()) as FilterFile;
      } catch (e) {
        console.warn(`⚠ pominięto nieczytelny snapshot ${world}/${file}: ${e instanceof Error ? e.message : e}`);
        continue;
      }
      snapshots.push({ id: timestampFromFileName(file), filters });
    }

    const trend = buildWorldTrend(snapshots);
    skipped += snapshots.length - trend.id.length;
    // Świat bez ani jednej datowanej migawki nie miałby czego pokazać na osi czasu.
    if (trend.id.length > 0) worlds[world] = trend;
  }

  const trends: Trends = { schema: TRENDS_SCHEMA, builtAt: new Date().toISOString(), worlds };
  await writeAtomic(TRENDS_FILE, JSON.stringify(trends));
  return { trends, skipped };
}
