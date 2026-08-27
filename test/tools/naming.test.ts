import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { stripComments } from "@/test/source-text.ts";

// AGENTS.md §9.4: an exported function's name starts with the action it performs, and a
// boolean carries a prefix that says what it answers.
//
// Read over exports only. A local helper is read together with its one caller and the name
// carries less; an exported name is read by somebody who will never open the file.

const SOURCE_GLOBS = ["src/**/*.ts", "tools/**/*.ts", "public/*.js", "public/lib/*.js"];

/** The action table from §9.4, plus the verbs that table leaves open. */
const ACTIONS = [
  "get",
  "set",
  "reset",
  "remove",
  "delete",
  "compose",
  "handle",
  "parse",
  "read",
  "build",
  "summarize",
  "require",
  "expect",
  // Named in §9.4 as allowed where they are more precise than the table's own.
  "write",
  "render",
  "check",
  "count",
  "describe",
  "assert",
  "split",
  "normalize",
  "format",
  "load",
  "rebuild",
  "capitalize",
];

/** A boolean-shaped name says so before it says anything else. */
const BOOLEAN_PREFIXES = ["is", "has", "should", "min", "max", "prev", "next"];

/** Synonyms §9.4 forbids outright, each with the table entry it duplicates. */
const FORBIDDEN_SYNONYMS: Record<string, string> = {
  fetch: "get",
  update: "set",
  make: "compose",
  create: "compose",
  calc: "compose",
  init: "compose",
};

const sources = new Map<string, string>();
for (const pattern of SOURCE_GLOBS) {
  for await (const file of new Glob(pattern).scan(".")) {
    sources.set(file.replaceAll("\\", "/"), await Bun.file(file).text());
  }
}

/** Exported function names, by file. */
function exportedFunctions(src: string): string[] {
  return [...stripComments(src).matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(
    ([, name]) => name ?? "",
  );
}

const exported = [...sources].flatMap(([file, src]) =>
  exportedFunctions(src).map((name) => ({ file, name })),
);

describe("§9.4 — an exported function name starts with its action", () => {
  test("there are exported functions to read", () => {
    expect(exported.length).toBeGreaterThan(20);
  });

  test("every one begins with an action or a boolean prefix", () => {
    const offenders: string[] = [];
    for (const { file, name } of exported) {
      const opens = (prefix: string) =>
        name === prefix || name.startsWith(prefix + name.charAt(prefix.length).toUpperCase());
      const named =
        ACTIONS.some((action) => name === action || opens(action)) ||
        BOOLEAN_PREFIXES.some((prefix) => opens(prefix));
      if (!named) offenders.push(`${file}: ${name}`);
    }
    expect(offenders.sort()).toEqual([]);
  });

  test("no name uses a synonym for a verb the table already has", () => {
    const offenders: string[] = [];
    for (const { file, name } of exported) {
      for (const [synonym, instead] of Object.entries(FORBIDDEN_SYNONYMS)) {
        if (name.startsWith(synonym) && name !== synonym) {
          offenders.push(`${file}: ${name} — use "${instead}"`);
        }
      }
    }
    expect(offenders.sort()).toEqual([]);
  });

  test("no contraction of a word the repository spells out elsewhere", () => {
    // §9.4: `button`, not `btn`. Only the abbreviations this tree could plausibly grow.
    //
    // ⚠️ Matched as a whole camelCase word, never as a substring. Reading it as a substring
    // reported `getValueFromJsonText` for holding "Val" and `getFiniteNumberFromText` for
    // holding "Num" — three correct names, spelled out in full, flagged for containing the
    // very abbreviations they avoid.
    const CONTRACTIONS = ["btn", "idx", "cfg", "tmp", "val", "cnt", "msg", "arr", "obj", "str", "num"];
    const offenders: string[] = [];
    for (const { file, name } of exported) {
      const words = name.split(/(?=[A-Z])/).map((word) => word.toLowerCase());
      if (words.some((word) => CONTRACTIONS.includes(word))) offenders.push(`${file}: ${name}`);
    }
    expect(offenders.sort()).toEqual([]);
  });
});
