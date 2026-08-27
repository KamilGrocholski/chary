import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { stripComments } from "@/test/source-text.ts";

// AGENTS.md §9.4: an exported function's name starts with the action it performs, and a
// boolean carries a prefix that says what it answers.
//
// Read over exports only. A local helper is read together with its one caller and the name
// carries less; an exported name is read by somebody who will never open the file.

const SOURCE_GLOBS = ["src/**/*.ts", "tools/**/*.ts", "public/*.js", "public/lib/*.js", "test/**/*.ts"];

/**
 * Names that belong to somebody else's interface, where ours is not the vote that counts.
 *
 * `fetch` is the key Bun's server reads the handler from; the four DOM methods and Chart.js's
 * `update` are what `dom-smoke.ts` has to be called to be a stub of; `set` is the setter half
 * of a property descriptor. Renaming any of them would not improve a name, it would break a
 * contract — and each one is a method or a property, never a function we chose to name.
 */
const FOREIGN_INTERFACES = new Set([
  "fetch", "addEventListener", "appendChild", "querySelectorAll", "replaceState", "update", "set",
]);

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
  // The rest of the verbs this tree actually performs. Each one is precise where the table's
  // own would be vaguer: `scrapeWorld` is not `getWorld`, and `drawChart` is not `renderChart`
  // — the drawing is Chart.js's and we hand it the data. The list is closed, and it grows only
  // by a round adding a verb it can defend here.
  "apply",
  "clear",
  "draw",
  "dryRun",
  "ensure",
  "fill",
  "find",
  "log",
  "pad",
  "resolve",
  "run",
  "schedule",
  "scrape",
  "select",
  "show",
  "sleep",
  "start",
  "strip",
  "wait",
  "walk",
  "add",
];

/**
 * Verbs from the table above that this repository also uses as nouns.
 *
 * `count` is a field of the snapshot format itself — `{ "schema": 3, …, "count": 39037 }` —
 * so a variable holding it carries the data's own word and is named right. The exclusion is
 * evidence-driven and stays that short: no other verb in the table is spelled as a
 * declaration anywhere under the globs above.
 */
const ACTIONS_ALSO_NOUNS = ["count"];

/**
 * Names this repository does not get to choose: they are fields of the files it publishes.
 *
 * `byProf` is a column of `trends.json`, written by `src/trends.ts` and read by the browser,
 * and the shorthand `{ total, act, byProf }` is what puts it there. Spelling the local out
 * would either rename the published field — `[ASK]`, and it reaches every file ever written
 * (§9.2) — or add a mapping whose only purpose is to satisfy this test.
 */
const PUBLISHED_FIELDS = ["byProf"];

/** A boolean-shaped name says so before it says anything else. */
const BOOLEAN_PREFIXES = ["is", "has", "should", "min", "max", "prev", "next"];

/**
 * Abbreviations of words this repository spells out elsewhere. Only the ones this tree could
 * plausibly grow — `prof` earned its place the day `PROF` and `buildProfCheckboxes` were
 * spelled out, and it stays so they cannot come back.
 *
 * ⚠️ Matched as a whole camelCase word, never as a substring. Reading it as a substring
 * reported `getValueFromJsonText` for holding "Val" and `getFiniteNumberFromText` for holding
 * "Num" — three correct names, spelled out in full, flagged for containing the very
 * abbreviations they avoid.
 */
const CONTRACTIONS = ["btn", "idx", "cfg", "tmp", "val", "cnt", "msg", "arr", "obj", "str", "num", "el", "dec", "prof", "pct"];

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

/**
 * The source with its comments, strings and patterns removed, so the extractors below read
 * code and nothing else. Without this the guard read its own regex literals: `function\\s+(\\w+)`
 * inside a pattern looks exactly like a function declaration to another pattern.
 */
function getCode(source: string): string {
  return stripComments(source)
    .replace(/(?<=[(=,:[!&|?{};]\s*)\/(?![*/])(?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[dgimsuvy]*/g, " ")
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
}

/** Whether a name opens with a prefix as a whole word: `getWorld` does, `getting` does not. */
function hasPrefix(name: string, prefix: string): boolean {
  return name === prefix || name.startsWith(prefix + name.charAt(prefix.length).toUpperCase());
}

/** Exported function names, by file. */
function getExportedFunctions(source: string): string[] {
  return [...getCode(source).matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(
    ([, name]) => name ?? "",
  );
}

const exported = [...sources].flatMap(([file, source]) =>
  getExportedFunctions(source).map((name) => ({ file, name })),
);

/**
 * Every function name, by file — declared, exported or not, and the arrow functions held in a
 * `const`. Wider than `exportedFunctions` on purpose, and only two of §9.4's three rules run
 * over it: see the block at the bottom for the measurement that decided which.
 */
function getFunctionNames(source: string): string[] {
  const code = getCode(source);
  return [
    ...[...code.matchAll(/\b(?:async\s+)?function\s+(\w+)/g)],
    ...[...code.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=\n]+?)?\s*=>/g)],
  ].map(([, name]) => name ?? "");
}

/** Declared variable names, by file. `for (const page of …)` counts — it declares one too. */
function getDeclaredNames(source: string): string[] {
  return [...getCode(source).matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map(
    ([, name]) => name ?? "",
  );
}

const declared = [...sources].flatMap(([file, source]) =>
  getDeclaredNames(source).map((name) => ({ file, name })),
);

const functions = [...sources].flatMap(([file, source]) =>
  getFunctionNames(source).map((name) => ({ file, name })),
);

describe("§9.4 — an exported function name starts with its action", () => {
  test("there are exported functions to read", () => {
    expect(exported.length).toBeGreaterThan(20);
  });

  test("every one begins with an action or a boolean prefix", () => {
    const offenders: string[] = [];
    for (const { file, name } of exported) {
      const named =
        ACTIONS.some((action) => name === action || hasPrefix(name, action)) ||
        BOOLEAN_PREFIXES.some((prefix) => hasPrefix(name, prefix));
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
    const offenders: string[] = [];
    for (const { file, name } of exported) {
      const words = name.split(/(?=[A-Z])/).map((word) => word.toLowerCase());
      if (words.some((word) => CONTRACTIONS.includes(word))) offenders.push(`${file}: ${name}`);
    }
    expect(offenders.sort()).toEqual([]);
  });
});

// The rule the guard above could not see. `naming.test.ts` reads exported functions, so a
// local name is held by nobody — and a dry-run written under it grew `const read: string[]`
// for a list of lines, `head` for text appended at the end of one, and `pages` for a string.
// The narrow half of that is checkable: a declaration named *exactly* an action from the
// table is never right, because §9.4 spends those words on what a function does.
//
// Deliberately only the exact match. Requiring more of a variable than that — that it be a
// noun, that it not open with a verb — is a judgment call a regex loses, and a guard that
// cries at `const parsedRows` would be turned off within a round.
describe("§9.4 — a variable is not named for an action", () => {
  test("there are declarations to read", () => {
    expect(declared.length).toBeGreaterThan(100);
  });

  test("no declaration is named exactly an action from the table", () => {
    // A `const` holding a function is judged by the rule above instead: `const walk = …` is
    // named for what it does, which is the whole point there and the mistake here.
    const functionNames = new Set(functions.map(({ file, name }) => `${file}:${name}`));
    const offenders: string[] = [];
    for (const { file, name } of declared) {
      if (ACTIONS_ALSO_NOUNS.includes(name) || functionNames.has(`${file}:${name}`)) continue;
      if (ACTIONS.includes(name)) offenders.push(`${file}: ${name} — an action, not a value`);
    }
    expect(offenders.sort()).toEqual([]);
  });
});

// Two of the three rules above reach every function, not only the exported ones — and the
// third deliberately does not.
//
// Measured before it was written: over `src/`, `tools/` and `public/`, the "starts with an
// action" rule read across every function reports 59 names. Most are right — `scrapeWorld`,
// `drawChart`, `sleep`, `showSuspect` are the precise verbs §9.4 invites, and the accessor
// locals of `app.js` (`baseTrend`, `currentSnapshot`, `selectedEntry`) read as values because
// they are read as values. Making that guard pass would mean either a verb list so long it
// holds nothing, or renaming a third of `app.js` to satisfy a regex. So the action rule stays
// on the exported surface, where a name is read by somebody who will never open the file.
//
// The other two carry no such judgment — an abbreviation is an abbreviation and a synonym is
// a synonym wherever it is written — and the export-only reading was hiding real breaches:
// `fetchMissing` and `fetchPage` (the verb §9.4 names first among the forbidden), `el`, `num`
// and `dec` in `app.js`, and `buildProfCheckboxes` beside a `PROF` that is now spelled out.
describe("§9.4 — every function, not only the exported ones", () => {
  test("there are functions to read", () => {
    expect(functions.length).toBeGreaterThan(80);
    // The widening is the point: locals outnumber the exported surface it used to read.
    expect(functions.length).toBeGreaterThan(exported.length);
  });

  test("every function name begins with the action it performs", () => {
    // Widened after a round that renamed the accessors the earlier measurement excused:
    // `baseTrend` and `currentSnapshot` in app.js read as values because they were named
    // like values, and they are functions. What that measurement got right is that the
    // table alone is too narrow — so the verbs this tree performs are listed beside it,
    // each one defended there, rather than the rule being dropped.
    const offenders: string[] = [];
    for (const { file, name } of functions) {
      if (FOREIGN_INTERFACES.has(name)) continue;
      const named =
        ACTIONS.some((action) => name === action || hasPrefix(name, action)) ||
        BOOLEAN_PREFIXES.some((prefix) => hasPrefix(name, prefix));
      if (!named) offenders.push(`${file}: ${name}`);
    }
    expect(offenders.sort()).toEqual([]);
  });

  test("no function name uses a synonym for a verb the table already has", () => {
    const offenders: string[] = [];
    for (const { file, name } of functions) {
      for (const [synonym, instead] of Object.entries(FORBIDDEN_SYNONYMS)) {
        if (name.startsWith(synonym) && name !== synonym) {
          offenders.push(`${file}: ${name} — use "${instead}"`);
        }
      }
    }
    expect(offenders.sort()).toEqual([]);
  });

  test("no name carries a contraction of a word spelled out elsewhere", () => {
    // Functions and declarations alike: `const lbl` is the same fault as `buildProfCheckboxes`
    // and neither is easier to read for being shorter. Parameters are not read here — a
    // regex cannot tell a parameter list from a call — so they are held by review.
    const offenders: string[] = [];
    for (const { file, name } of [...functions, ...declared]) {
      if (PUBLISHED_FIELDS.includes(name)) continue;
      const words = name.split(/(?=[A-Z])/).map((word) => word.toLowerCase());
      if (words.some((word) => CONTRACTIONS.includes(word))) offenders.push(`${file}: ${name}`);
    }
    expect(offenders.sort()).toEqual([]);
  });
});
