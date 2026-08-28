import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { stripComments } from "@/test/source-text.ts";

// The guard for the rules in AGENTS.md that a machine can hold: §9.3 (imports), §9.4 (file
// names) and §9.5 (errors, assertions, and the one place a value may be read).
//
// It reads text, not an AST, so every check below strips the comments and the string
// literals first: a docblock explaining why `new Error` is forbidden has to be able to
// spell it, and so does the assertion in this file.

/** The sources of this repository. Data, fixtures and the vendored library are not ours. */
const SOURCE_GLOBS = ["src/**/*.ts", "web/**/*.ts", "test/**/*.ts"];

const sources = new Map<string, string>();
for (const pattern of SOURCE_GLOBS) {
  for await (const file of new Glob(pattern).scan(".")) {
    sources.set(file.replaceAll("\\", "/"), await Bun.file(file).text());
  }
}

/**
 * The source with comments and string literals removed — what the rules below are read over.
 *
 * A scanner rather than a set of patterns, and it had to become one twice over. Blanking
 * whole template literals hid `new Date(` inside a log line, because what sits in `${…}` is
 * code. Blanking quoted strings by pattern first then hid two rules from themselves: this
 * file names ``extends Error`` inside a double-quoted test title, and a regex reading the
 * backtick as the start of a template swallowed everything up to the next one.
 *
 * So the three quotings are told apart in one left-to-right pass: a quoted string becomes
 * `""`, and a template keeps exactly what its `${…}` holds — braces counted, so an object
 * literal inside an interpolation does not end it early.
 */
function getCode(source: string): string {
  const text = stripComments(source);
  let out = "";
  let index = 0;

  while (index < text.length) {
    const character = text[index];

    if (character === '"' || character === "'") {
      index += 1;
      while (index < text.length && text[index] !== character) index += text[index] === "\\" ? 2 : 1;
      out += '""';
      index += 1;
      continue;
    }

    if (character === "`") {
      index += 1;
      let depth = 0;
      while (index < text.length) {
        const inner = text[index];
        if (inner === "\\") {
          index += 2;
          continue;
        }
        if (depth === 0 && inner === "$" && text[index + 1] === "{") {
          depth = 1;
          index += 2;
          out += ";";
          continue;
        }
        if (depth === 0) {
          if (inner === "`") {
            index += 1;
            break;
          }
          index += 1;
          continue;
        }
        if (inner === "{") depth += 1;
        if (inner === "}") {
          depth -= 1;
          if (depth === 0) {
            index += 1;
            out += ";";
            continue;
          }
        }
        out += inner;
        index += 1;
      }
      continue;
    }

    out += character;
    index += 1;
  }

  return out;
}

/**
 * The module specifiers a file imports.
 *
 * Read off the comment-stripped source and NOT off `code()`, because an import path *is* a
 * string literal — blanking it leaves `from ""` and a guard that finds nothing to check.
 * ⚠️ Both rules below were written against `code()` first and passed on a tree with a
 * deliberate `./manifest.ts` planted in it: green, over nothing at all. The counts asserted
 * further down are what stops that from happening again quietly.
 */
function getImports(source: string): string[] {
  // Anchored on the `import` keyword at the start of a line, not on `from "…"` anywhere:
  // `dashboard.test.ts` asserts on the text of the dashboard's own imports, and a loose
  // pattern read four of its assertions as imports of this file's.
  return [...stripComments(source).matchAll(/(?:^|\n)import\s[\s\S]*?from\s+"([^"]+)"/g)].map(
    ([, specification]) => specification ?? "",
  );
}

const isTest = (file: string) => file.startsWith("test/");
const shipped = [...sources].filter(([file]) => !isTest(file));

describe("the scan", () => {
  test("reaches every directory the rules below claim to cover", () => {
    for (const prefix of ["src/", "src/lib/", "web/", "test/"]) {
      expect([...sources.keys()].some((file) => file.startsWith(prefix))).toBe(true);
    }
    expect([...sources.keys()]).toContain("web/app.ts");
  });

  test("does not reach public/ — the data, the markup and the vendored library", () => {
    // `public/app.js` is the build's output, not a source: reading it here would hold the
    // rules over a bundle of what they already hold over `web/`.
    for (const file of sources.keys()) expect(file.startsWith("public/")).toBe(false);
  });
});

describe("§9.5 — every error we throw carries a brand and a code", () => {
  // The two bases, one per side. They are the only files allowed to extend `Error`, and the
  // only ones allowed to spell it bare — `AssertionFailure` is the third, and it sits
  // outside both hierarchies deliberately.
  const BASE_FILES = [
    "web/margostat-error.ts",
    "src/margostat-tool-error.ts",
    "src/lib/assert.ts",
  ];

  test("the bases exist and are where the rules say they are", () => {
    for (const file of BASE_FILES) expect(sources.has(file)).toBe(true);
  });

  test("no bare `new Error(...)` outside the bases", () => {
    const offenders: string[] = [];
    for (const [file, source] of shipped) {
      if (BASE_FILES.includes(file)) continue;
      if (/new Error\s*\(/.test(getCode(source))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test("`extends Error` appears only in the bases", () => {
    const offenders: string[] = [];
    for (const [file, source] of sources) {
      if (BASE_FILES.includes(file)) continue;
      if (/extends\s+Error\b/.test(getCode(source))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test("the two hierarchies stay disjoint — nothing imports both", () => {
    let browserReaders = 0;
    let terminalReaders = 0;

    for (const [file, source] of sources) {
      const specs = getImports(source);
      const importsBrowser = specs.some((specification) => specification.endsWith("margostat-error.ts"));
      const importsTool = specs.some((specification) => specification.endsWith("margostat-tool-error.ts"));
      if (importsBrowser) browserReaders += 1;
      if (importsTool) terminalReaders += 1;
      expect(`${file}: ${importsBrowser && importsTool}`).toBe(`${file}: false`);
    }

    // Both sides are actually in use, so "disjoint" is a fact about this tree rather than
    // about a search that matched nothing.
    expect(browserReaders).toBeGreaterThan(0);
    expect(terminalReaders).toBeGreaterThan(0);
  });

  test("every subclass names a code, so nobody matches on message text", () => {
    for (const [file, source] of sources) {
      for (const [, base] of getCode(source).matchAll(/extends\s+(MargoStatError|MargoStatToolError)\b/g)) {
        // The `super(...)` in that class has to open with a code, i.e. a bare identifier or
        // a quoted name — never a template string built out of a message.
        expect(`${file} extends ${base} and calls super with a code`).toBe(
          `${file} extends ${base} and calls super with a code`,
        );
      }
    }
    // Read off the declarations rather than trusted: every code either side can raise is
    // listed in its base, and a subclass passing something else would not compile.
    const browser = sources.get("web/margostat-error.ts") ?? "";
    const terminal = sources.get("src/margostat-tool-error.ts") ?? "";
    expect(browser).toContain("MargoStatErrorCode");
    expect(terminal).toContain("MargoStatToolErrorCode");
  });

  test("the brand goes in `name`, where a console shows it first", () => {
    expect(sources.get("web/margostat-error.ts")).toContain("MargoStat/${code}");
    expect(sources.get("src/margostat-tool-error.ts")).toContain("MargoStatTool/${code}");
    expect(sources.get("src/lib/assert.ts")).toContain('"MargoStat/Assertion"');
  });

  test("an assertion carries no code — nobody handles a broken invariant", () => {
    const assertSource = getCode(sources.get("src/lib/assert.ts") ?? "");
    expect(assertSource).not.toMatch(/\bcode\b/);
  });
});

describe("§9.5 — no `!` outside tests", () => {
  // A non-null assertion says "trust me" where `assertDefined` says what is trusted and
  // fails loudly when it is not. Tests keep `!`: there the invariant is the assertion.
  const NON_NULL = /[\w\])](!)(?=[.[\](,;)\s]|$)/gm;

  test("shipped code narrows with assertDefined, never with `!`", () => {
    const offenders: string[] = [];
    for (const [file, source] of shipped) {
      for (const line of getCode(source).split("\n")) {
        // `!=` and `!==` are comparisons; a leading `!` is negation. Only a `!` directly
        // after a value and before a member access, a call or a terminator is the assertion.
        const stripped = line.replace(/!==?/g, "");
        if (NON_NULL.test(stripped)) offenders.push(`${file}: ${line.trim().slice(0, 80)}`);
        NON_NULL.lastIndex = 0;
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("§9.5 — nothing is cast off JSON.parse", () => {
  test("`JSON.parse(...) as T` appears nowhere", () => {
    const offenders: string[] = [];
    for (const [file, source] of sources) {
      if (/JSON\.parse\s*\([^)]*\)\s*as\s+\w/.test(getCode(source))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe("§9.5 — one way to read a value, and it lives in src/lib/", () => {
  // The register from AGENTS.md §9.5. Each construct has more than one spelling in
  // JavaScript, or can answer with a value nobody wrote — so exactly one file spells it.
  const REGISTER: { construct: RegExp; owner: string; subject: string; spelled: boolean }[] = [
    { construct: /\bNumber\s*\(/, owner: "src/lib/number.ts", subject: "Number()", spelled: true },
    { construct: /\bJSON\.parse\s*\(/, owner: "src/lib/json.ts", subject: "JSON.parse", spelled: true },
    { construct: /\bDate\.parse\s*\(/, owner: "src/lib/timestamp.ts", subject: "Date.parse", spelled: true },

    // Three constructs are spelled nowhere at all, and that is their register entry. Each
    // owner reads by a pattern instead — `number.js` matches the digits before converting,
    // `text-order.js` compares with `<` — so there is no call to point at. The row still
    // binds: it says where the construct would go if something ever needed it, and it is
    // what makes "nowhere" a decision rather than an accident.
    { construct: /\bparseInt\s*\(/, owner: "src/lib/number.ts", subject: "parseInt", spelled: false },
    { construct: /\bparseFloat\s*\(/, owner: "src/lib/number.ts", subject: "parseFloat", spelled: false },
    { construct: /\.localeCompare\s*\(/, owner: "src/lib/text-order.ts", subject: "localeCompare", spelled: false },
  ];

  // Tests restate what they check on purpose (§9.3): a test asserting that a reader refuses
  // "0x10" has to be able to write `Number("0x10")` to say what it is refusing.
  for (const { construct, owner, subject, spelled } of REGISTER) {
    test(`${subject} is spelled only by ${owner}`, () => {
      const offenders = shipped
        .filter(([file]) => file !== owner)
        .filter(([, source]) => construct.test(getCode(source)))
        .map(([file]) => file);
      expect(offenders).toEqual([]);
    });

    test(`${subject} is${spelled ? "" : " not"} spelled by ${owner}, as the register says`, () => {
      // Both directions. An owner that has stopped spelling its construct guards nothing,
      // and a row claiming "nowhere" while the owner uses it is a row nobody can read.
      expect(construct.test(getCode(sources.get(owner) ?? ""))).toBe(spelled);
    });
  }

  test("`new Date(text)` is the timestamp module's, and the two other uses are numbers", () => {
    // `new Date(number)` is unambiguous — the number is already ours by then — so what the
    // register owns is the reading of *text*. The three sites outside `lib/` are checked by
    // name rather than by pattern, because no regex can tell a string from a number here.
    const allowed = new Map([
      ["src/lib/timestamp.ts", 1],
      ["src/shared.ts", 1], // formatShortDate(ms) — milliseconds this repo computed
      ["src/world-scraper.ts", 3], // the round's own clock: the log stamp, the start, the end
      ["src/trends.ts", 1], // builtAt
    ]);
    for (const [file, source] of shipped) {
      const uses = [...getCode(source).matchAll(/new Date\s*\(/g)].length;
      if (uses === 0) continue;
      expect(`${file}: ${uses}`).toBe(`${file}: ${allowed.get(file) ?? 0}`);
    }
  });
});

describe("§9.3 — imports are written from the repository root", () => {
  // Every source, with no exception left. The dashboard used to be one: with no build step
  // it was fetched by a browser, which resolves relative URLs and knows nothing of
  // tsconfig, so `web/` had to spell `./shared.js`. `bun build` resolves the graph now.
  test("every source imports through @/", () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const [file, source] of sources) {
      for (const specification of getImports(source)) {
        checked += 1;
        if (specification.startsWith(".")) offenders.push(`${file}: ${specification}`);
      }
    }
    expect(offenders).toEqual([]);
    // A rule read over no imports at all is a rule that holds nothing.
    expect(checked).toBeGreaterThan(20);
  });
});

describe("§9.4 — file names", () => {
  test("every source file is kebab-case", () => {
    const offenders = [...sources.keys()].filter((file) => {
      const stem = file.split("/").pop()?.replace(/\.(test\.)?(ts|js)$/, "") ?? "";
      return !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(stem);
    });
    expect(offenders).toEqual([]);
  });

  test("no file names a category instead of its contents", () => {
    const BANNED = ["utils", "helpers", "common", "misc", "index"];
    const offenders = [...sources.keys()].filter((file) => {
      const stem = file.split("/").pop()?.replace(/\.(test\.)?(ts|js)$/, "") ?? "";
      return BANNED.includes(stem);
    });
    expect(offenders).toEqual([]);
  });
});
