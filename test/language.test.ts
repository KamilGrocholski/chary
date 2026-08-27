import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { commentBlocks, stringLiterals } from "@/test/source-text.ts";

// The guard for the language boundary in AGENTS.md: English everywhere except the text a
// player reads and the keys that match material captured from Margonem.
//
// It is a smoke guard, not a proof. Polish without diacritics passes it — its job is to catch
// drift, not to certify that every sentence is English.

const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

// The game's own names for its professions. They are proper nouns of somebody else's system,
// so a comment written in English may still have to spell one — `parser.ts` reads them out of
// the ranking's HTML and `shared.js` prints them on a chart.
const GAME_NAMES = ["Wojownik", "Mag", "Paladyn", "Tropiciel", "Tancerz ostrzy", "Łowca"];

/**
 * The files allowed to hold a Polish string literal, and why.
 *
 * ⚠️ Frozen as a list rather than a rule, and the list is the point. No pattern can tell a
 * label a player reads from a Polish sentence that slipped into a comment-free line, so what a
 * machine can hold is *which files are allowed to*. A further one appearing is a decision
 * somebody should have to make on purpose.
 *
 * `phrase` exists because a Polish string can carry no diacritic at all — `history.js` says
 * "≤ 7 dni", which the detector above is blind to. Without naming the phrase, that file would
 * silently drop out of the second direction of the check.
 */
const SPEAKS_POLISH: Array<{ file: string; phrase?: string }> = [
  // The dashboard — the text a player reads.
  { file: "public/app.js" },
  { file: "public/filters.js" },
  { file: "public/shared.js" },
  { file: "public/history.js", phrase: "≤ 7 dni" },
  // Keys that match Margonem's own HTML, and the sentence the scraper writes for a player.
  { file: "src/parser.ts" },
  { file: "src/snapshot.ts" },
  // Tests pinning the Polish interface, and samples of captured material.
  // This file is on the list because it spells the game's professions and the phrase it holds
  // `history.js` to — a guard exempting itself would be the first thing to go stale.
  { file: "test/language.test.ts" },
  { file: "test/dashboard.test.ts" },
  { file: "test/parser.test.ts" },
  { file: "test/snapshot.test.ts" },
];

// Every directory holding a source of ours. A new one that is not here is a whole layer
// the boundary stops being checked over, which is why the first test below counts.
const SCANNED = ["src/**/*.ts", "test/*.ts", "public/*.js", "public/lib/*.js", "tools/*.ts"];

const sources = new Map<string, string>();
for (const pattern of SCANNED) {
  for await (const file of new Glob(pattern).scan(".")) {
    sources.set(file, await Bun.file(file).text());
  }
}
const files = [...sources.keys()].sort();

describe("the language boundary", () => {
  test("the scan reaches every source file it claims to", () => {
    expect(files.length).toBeGreaterThan(15);
    for (const { file } of SPEAKS_POLISH) {
      expect(files).toContain(file);
    }
  });

  test("no comment is written in Polish", () => {
    // Quotations are exempt: a comment explaining why a bar said "Ładowanie…" has to be able
    // to say what it said. So is a profession's name, which is the game's and not ours.
    const prose = (comment: string) => {
      let text = comment.replace(/"[^"]*"/g, "").replace(/„[^”"]*[”"]/g, "");
      for (const name of GAME_NAMES) text = text.replaceAll(name, "");
      return text;
    };

    const offenders: string[] = [];
    for (const [file, src] of sources) {
      for (const comment of commentBlocks(src)) {
        if (POLISH.test(prose(comment))) offenders.push(`${file}: ${comment.trim().slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("only the listed files hold a Polish string", () => {
    const allowed = new Set(SPEAKS_POLISH.map((entry) => entry.file));
    const offenders: string[] = [];

    for (const [file, src] of sources) {
      if (allowed.has(file)) continue;
      for (const literal of stringLiterals(src)) {
        if (POLISH.test(literal)) offenders.push(`${file}: ${literal.slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("every listed file still holds one", () => {
    // The other direction. An entry that stops being true is a file whose Polish moved
    // somewhere else — and the list would go on guarding nothing while looking like it did.
    for (const { file, phrase } of SPEAKS_POLISH) {
      const src = sources.get(file)!;
      const speaks = phrase
        ? stringLiterals(src).some((literal) => literal.includes(phrase))
        : stringLiterals(src).some((literal) => POLISH.test(literal));
      expect(`${file} speaks Polish: ${speaks}`).toBe(`${file} speaks Polish: true`);
    }
  });
});
