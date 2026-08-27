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

/**
 * The history, read in ONE `git` call.
 *
 * It used to be one `git show` per commit behind a helper that asserted the exit code — and
 * the helper ran at module scope, so a single failed call reported itself as a failing test
 * with no offender to show for it. That is not hypothetical: this guard went red during a
 * run taken while commits were being written, because `git` was busy, and the message named
 * a rule nothing had broken. A guard that can cry about the wrong thing is worse than one
 * that is merely slow.
 *
 * The reading can still fail, and now it says so as data: the test below is the only place
 * that turns it into a failure, and it names `git` rather than §7.2.
 */
type HistoryReading = { ok: true; commits: Commit[] } | { ok: false; reason: string };

const RECORD = "\x1e";
const UNIT = "\x1f";

function readHistory(): HistoryReading {
  const read = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args]);
    return result.exitCode === 0
      ? { ok: true as const, text: new TextDecoder().decode(result.stdout) }
      : { ok: false as const, text: new TextDecoder().decode(result.stderr).trim() };
  };

  const anchor = read("log", "--format=%H", "--reverse", "--", RULES_LANDED_AT);
  if (!anchor.ok) return { ok: false, reason: `git log over ${RULES_LANDED_AT} failed: ${anchor.text}` };
  const first = anchor.text.trim().split("\n")[0] ?? "";
  if (first === "") return { ok: true, commits: [] };

  // Inclusive of `first`, and read by walking back from HEAD rather than with `first..HEAD`.
  // The exclusive range leaves out the very commit that lands this file — so the first run
  // of this guard would have judged nothing while looking exactly like a run that judged
  // everything, which is the failure the first test below exists to make impossible.
  const history = read("log", `--format=${RECORD}%H${UNIT}%s`, "--name-only", "HEAD");
  if (!history.ok) return { ok: false, reason: `git log over HEAD failed: ${history.text}` };

  const commits: Commit[] = [];
  for (const record of history.text.split(RECORD)) {
    if (record.trim() === "") continue;
    const [header = "", ...rest] = record.split("\n");
    const [hash = "", subject = ""] = header.split(UNIT);
    if (hash === "") continue;
    commits.push({ hash, subject, files: rest.filter((file) => file.trim() !== "") });
    if (hash === first) break;
  }
  return { ok: true, commits };
}

const reading = readHistory();
const commits = reading.ok ? reading.commits : [];

describe("§7.2 — commit messages", () => {
  test("git answered at all", () => {
    // Separate from the rule, and first: a failure here is about the reading, not about a
    // commit anybody wrote.
    expect(reading.ok ? "git read the history" : reading.reason).toBe("git read the history");
  });

  test("there is history to read, or this guard has not landed yet", () => {
    // A range that resolved to nothing would let every assertion below pass over an empty
    // list, which is the quietest way for a guard to stop guarding. There is exactly one
    // honest reason for an empty range: the commit adding this file is the one being
    // written, so the rule has no history to judge yet.
    if (commits.length > 0) return;
    const tracked = new TextDecoder().decode(Bun.spawnSync(["git", "ls-files", RULES_LANDED_AT]).stdout).trim();
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
