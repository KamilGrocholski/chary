import { describe, expect, test } from "bun:test";

// A document that names a file which is not there is worse than one that names none: a
// reader takes the citation for a fact and goes looking. AGENTS.md and README.md are claims
// about the repository as it stands right now, so they are held to it.
//
// `docs/` is deliberately NOT held. Those notes are dated records of what was measured on a
// particular day, and a later rename must not be able to turn one red — the only remedy
// would be editing the record, which is the one thing a dated note is for not doing.

const HELD = ["AGENTS.md", "README.md"];

/**
 * Paths cited in prose: inside backticks, or as a Markdown link target.
 *
 * A citation counts as a path only where it carries a directory, or is a `.md` document at
 * the root. A bare filename is not a path in this repository and never was: `manifest.json`
 * and `trends.json` are the URLs the dashboard fetches, `.f.json` and `.n.json` are the
 * two halves of a snapshot's name. Holding those to the filesystem would fail on four
 * correct sentences, and the usual repair for a guard that cries wolf is to delete it.
 */
function readCitedPaths(text: string): string[] {
  const cited = new Set<string>();
  // A specifier is not a path either: §9.3 explains that the dashboard imports its
  // siblings as `./shared.js`, which is a spelling a browser resolves, not a file at the
  // root of this repository.
  const isRepoPath = (path: string) =>
    !path.startsWith("./") && !path.startsWith("../") && (path.includes("/") || path.endsWith(".md"));

  for (const [, path] of text.matchAll(/`([^`\n]+)`/g)) {
    if (path === undefined) continue;
    if (!/^[\w.][\w./-]*\.(ts|js|json|md|html|yml|lockb)$/.test(path)) continue;
    if (!isRepoPath(path)) continue;
    cited.add(path);
  }
  for (const [, path] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (path === undefined) continue;
    if (/^(https?:|#)/.test(path)) continue;
    cited.add(path);
  }
  return [...cited];
}

describe("every path these documents name is a path that exists", () => {
  for (const document of HELD) {
    test(`${document}`, async () => {
      // Fenced blocks are stripped first: §9.3 shows `import … from "./parser.ts"` as the
      // spelling to avoid, and a guard reading an example of a mistake as a claim about the
      // tree would make the document unable to show one.
      const text = (await Bun.file(document).text()).replace(/```[\s\S]*?```/g, "");
      const cited = readCitedPaths(text);

      // A document that cites nothing would pass silently, which is the failure this guard
      // exists to make impossible elsewhere.
      expect(cited.length).toBeGreaterThan(10);

      const missing: string[] = [];
      for (const path of cited) {
        // A world's directory stands for twenty-one of them, and a snapshot's name is an
        // identifier rather than a file anybody can name in advance.
        if (path.includes("<")) continue;
        if (!(await Bun.file(path).exists())) missing.push(path);
      }
      expect(missing.sort()).toEqual([]);
    });
  }
});
