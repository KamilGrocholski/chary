import { describe, expect, test } from "bun:test";

// AGENTS.md §7.2 over this history. Two things are held: the shape of a header, and that a
// round of data never travels in the same commit as a change to the code.
//
// Only commits from the rewrite onwards are read. The history before it was written under
// no such rule, and a guard that fails on somebody's finished work is a guard that gets
// deleted rather than one that gets obeyed.

const TYPES = ["feat", "fix", "perf", "refactor", "docs", "test", "build", "chore", "scrape"];
const SCOPES = ["scraper", "parser", "snapshot", "trends", "manifest", "dash", "lib", "tools", "docs", "ci"];

/**
 * The rule starts where this guard does.
 *
 * Anchoring on AGENTS.md instead reached back to the commit that first created it, which is
 * most of a history written under no such rule — and the first thing it reported was a
 * scope somebody chose correctly at the time.
 */
const RULES_LANDED_AT = "test/tools/commit-messages.test.ts";

type Commit = { hash: string; subject: string; files: string[] };

async function runGit(...args: string[]): Promise<string> {
  const result = Bun.spawnSync(["git", ...args]);
  expect(result.exitCode).toBe(0);
  return new TextDecoder().decode(result.stdout).trim();
}

/** Commits that touched AGENTS.md, newest first — the rewrite and everything after it. */
const commits: Commit[] = await (async () => {
  const first = (await runGit("log", "--format=%H", "--reverse", "--", RULES_LANDED_AT)).split("\n")[0] ?? "";
  if (first === "") return [];

  // Inclusive of `first`, and read by walking back from HEAD rather than with `first..HEAD`.
  // The exclusive range leaves out the very commit that lands this file — so the first run
  // of this guard would have judged nothing while looking exactly like a run that judged
  // everything, which is the failure the test below exists to make impossible.
  const parsed: Commit[] = [];
  for (const line of (await runGit("log", "--format=%H%x00%s", "HEAD")).split("\n")) {
    const [hash = "", subject = ""] = line.split("\0");
    if (hash === "") continue;
    const files = (await runGit("show", "--name-only", "--format=", hash)).split("\n").filter((file) => file !== "");
    parsed.push({ hash, subject, files });
    if (hash === first) break;
  }
  return parsed;
})();

describe("§7.2 — commit messages", () => {
  test("there is history to read, or this guard has not landed yet", async () => {
    // A range that resolved to nothing would let every assertion below pass over an empty
    // list, which is the quietest way for a guard to stop guarding. There is exactly one
    // honest reason for an empty range: the commit adding this file is the one being
    // written, so the rule has no history to judge yet.
    if (commits.length > 0) return;
    const tracked = await runGit("ls-files", RULES_LANDED_AT);
    expect(`${RULES_LANDED_AT} is tracked: ${tracked !== ""}`).toBe(`${RULES_LANDED_AT} is tracked: false`);
  });

  test("every header is `type(scope): effect`, with a type and a scope from the list", () => {
    const offenders: string[] = [];
    for (const { hash, subject } of commits) {
      const match = /^([a-z]+)(?:\(([a-z-]+)\))?: (.+)$/.exec(subject);
      if (!match) {
        offenders.push(`${hash.slice(0, 8)} ${subject}`);
        continue;
      }
      const [, type = "", scope, effect = ""] = match;
      if (!TYPES.includes(type)) offenders.push(`${hash.slice(0, 8)} unknown type "${type}"`);
      if (scope !== undefined && !SCOPES.includes(scope)) {
        offenders.push(`${hash.slice(0, 8)} unknown scope "${scope}"`);
      }
      // The header names an effect, and an effect is not one word.
      if (effect.trim().split(/\s+/).length < 2) offenders.push(`${hash.slice(0, 8)} header says too little`);
    }
    expect(offenders).toEqual([]);
  });

  test("a scrape round travels on its own", () => {
    const offenders: string[] = [];
    for (const { hash, subject, files } of commits) {
      const isScrape = subject.startsWith("scrape:") || subject.startsWith("scrape(");
      const touchesData = files.some((file) => file.startsWith("public/worlds/"));
      const touchesCode = files.some((file) => /^(src|tools|test|public\/(app|filters|history|shared|lib))/.test(file));

      // A round rewrites the manifest and the aggregate and adds tens of megabytes; a code
      // change hiding in that diff is a code change nobody will ever read.
      if (isScrape && touchesCode) offenders.push(`${hash.slice(0, 8)} scrape carries a source change`);
      if (touchesData && !isScrape) offenders.push(`${hash.slice(0, 8)} touches data without saying scrape`);
    }
    expect(offenders).toEqual([]);
  });
});
