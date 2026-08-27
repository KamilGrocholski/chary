import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

// AGENTS.md §8 says the structure block reflects the tree as it is and is updated in the
// same commit that changes the tree. Nothing but this makes that true: prose describing a
// directory is the first thing to go stale, and a block listing a file nobody has is
// indistinguishable, to a reader, from a file they simply have not found yet.

const agents = await Bun.file("AGENTS.md").text();

/** The fenced block under "## 8. Structure". */
function readStructureBlock(): string[] {
  const section = agents.slice(agents.indexOf("## 8. Structure"));
  const open = section.indexOf("```");
  const close = section.indexOf("```", open + 3);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return section.slice(open + 3, close).split("\n").slice(1);
}

/**
 * The paths the block names, resolved through its indentation.
 *
 * An entry ending in `/` opens a directory for everything indented under it; anything else
 * is a file.
 *
 * ⚠️ A description continues on the next line indented to the description column, and such
 * a line can look exactly like an entry: `public/trends.json.` at the end of a sentence was
 * read as a file called `src/public/trends.json.`. Nesting in this block never goes past
 * two levels, so an indent deeper than that is prose, not a path.
 */
const MAX_NESTING_INDENT = 4;

function readListedPaths(): { files: string[]; directories: string[] } {
  const files: string[] = [];
  const directories: string[] = [];
  /** Open directories as `[indent, prefix]`, outermost first. */
  const stack: [number, string][] = [];

  for (const line of readStructureBlock()) {
    const match = /^(\s*)([\w.<>/-]+)(\s{2,}|$)/.exec(line);
    if (!match) continue;
    const [, spaces = "", name = ""] = match;
    const indent = spaces.length;
    if (name === "" || indent > MAX_NESTING_INDENT) continue;

    while (stack.length > 0 && indent <= (stack[stack.length - 1]?.[0] ?? -1)) stack.pop();
    const prefix = stack[stack.length - 1]?.[1] ?? "";
    const fullPath = prefix + name;

    if (name.endsWith("/")) {
      directories.push(fullPath);
      stack.push([indent, fullPath]);
    } else {
      files.push(fullPath);
    }
  }
  return { files, directories };
}

/** The sources §8 is expected to account for, file by file. */
const TRACKED_GLOBS = ["src/**/*.ts", "tools/**/*.ts", "test/**/*.ts", "public/*.js", "public/lib/*.js"];

const listed = readListedPaths();

describe("§8 — the structure block against the tree", () => {
  test("the block was found and holds entries", () => {
    expect(listed.files.length).toBeGreaterThan(20);
    expect(listed.directories.length).toBeGreaterThan(3);
  });

  test("every file it names exists", async () => {
    const missing: string[] = [];
    for (const file of listed.files) {
      // `<world>` stands for every world there is; the data is not enumerated here.
      if (file.includes("<")) continue;
      if (!(await Bun.file(file).exists())) missing.push(file);
    }
    expect(missing).toEqual([]);
  });

  test("every directory it names exists", async () => {
    const missing: string[] = [];
    for (const dir of listed.directories) {
      if (dir.includes("<")) continue;
      const [first] = await Array.fromAsync(new Glob("*").scan({ cwd: dir, onlyFiles: false }));
      if (first === undefined) missing.push(dir);
    }
    expect(missing).toEqual([]);
  });

  test("every source in the tree is named by it", async () => {
    const unlisted: string[] = [];
    const named = new Set(listed.files);
    for (const pattern of TRACKED_GLOBS) {
      for await (const file of new Glob(pattern).scan(".")) {
        const path = file.replaceAll("\\", "/");
        if (!named.has(path)) unlisted.push(path);
      }
    }
    expect(unlisted.sort()).toEqual([]);
  });
});
