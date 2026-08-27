import { describe, expect, test } from "bun:test";
import path from "node:path";
import { MANIFEST_FILE, type SnapshotEntry as WrittenEntry } from "@/src/manifest.ts";
import { getValueFromJsonText } from "@/public/lib/json.js";

type ReadEntry = import("@/public/shared.js").ManifestEntry;

// One side writes `manifest.json` and the other reads it, and after §9.1 was opened the
// shapes that could be stated once are: `SnapshotSummary` and `WorldTrend` now live in
// `public/shared.js` and `src/trends.ts` imports them.
//
// A manifest entry cannot go the same way, and the difference is deliberate: the writer
// carries `file?` for a snapshot in the old single-file format that has not been migrated,
// which the dashboard never sees, and the reader carries `suspect?`, which it takes from the
// snapshot rather than from the manifest. So the two stay separate — and this holds the
// fields they DO share to the same types, without anybody restating a field list.

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

type SharedFields = Extract<keyof WrittenEntry, keyof ReadEntry>;

// If the writer renames `startedAt`, changes `filters` to a number, or makes a required
// field optional, this line stops compiling — and `bun run typecheck` is half the gate.
export type SharedFieldsAgree = Assert<Equal<Pick<WrittenEntry, SharedFields>, Pick<ReadEntry, SharedFields>>>;

// Every field the reader needs is one the writer promises. Assignability, not equality: the
// writer may carry more (`file`), never less.
export type WriterSatisfiesReader = Assert<Equal<WrittenEntry extends Omit<ReadEntry, "suspect"> ? true : false, true>>;

describe("manifest.json against the types on both sides", () => {
  test("every world's newest entry has the fields the dashboard reads", async () => {
    const reading = getValueFromJsonText(await Bun.file(MANIFEST_FILE).text());
    expect(reading.ok).toBe(true);
    if (!reading.ok) return;

    const manifest = reading.value as { worlds: { name: string; files: unknown[] }[] };
    expect(manifest.worlds.length).toBeGreaterThan(0);

    for (const world of manifest.worlds) {
      const newest = world.files.at(-1) as Record<string, unknown> | undefined;
      expect(typeof newest?.["id"]).toBe("string");
      expect(typeof newest?.["filters"]).toBe("string");
      // The path the dashboard fetches is composed from this field alone, so it has to point
      // at the pair's filter half and to sit under the world it is listed for.
      expect(String(newest?.["filters"])).toContain(`${path.posix.join("worlds", world.name)}/`);
    }
  });
});
