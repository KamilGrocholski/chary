import { describe, expect, test } from "bun:test";
import * as cheerio from "cheerio";
import {
  LadderMarkupError,
  parseCharId,
  getIntegerFromLadderText,
  parseLastOnlineDays,
  parseTable,
  parseTotalPages,
  getProfessionId,
} from "@/src/parser.ts";

const fixture = await Bun.file(
  new URL("./fixtures/ladder-aether-p1.html", import.meta.url).pathname,
).text();
const $ = cheerio.load(fixture);

describe("parseTotalPages", () => {
  test("reads the page count from .total-pages", () => {
    expect(parseTotalPages($)).toBe(390);
  });

  test("falls back to input[max] when .total-pages is missing", () => {
    const html = `<div class="pagination"></div>
      <input name="page" max="123" type="number">`;
    expect(parseTotalPages(cheerio.load(html))).toBe(123);
  });

  test("takes the maximum of the links, not their digits joined", () => {
    const html = `<div class="pagination">
      <a href="?page=2">2</a><a href="?page=3">3</a><a href="?page=390">390</a>
    </div>`;
    // The old implementation joined "2 3 390" → 23390.
    expect(parseTotalPages(cheerio.load(html))).toBe(390);
  });

  test("returns 1 when there is no pagination", () => {
    expect(parseTotalPages(cheerio.load("<div></div>"))).toBe(1);
  });
});

describe("parseLastOnlineDays", () => {
  test.each([
    ["Mniej niż 24h temu", 0],
    ["1 dzień temu", 1],
    ["1 dni temu", 1],
    ["7 dni temu", 7],
    ["209 dni temu", 209],
  ] as const)("%s → %p", (text, expected) => {
    expect(parseLastOnlineDays(text)).toBe(expected);
  });

  test("an account never used → null instead of a date in 1969", () => {
    expect(parseLastOnlineDays("20655 dni temu")).toBeNull();
  });

  test("an unrecognised format → undefined", () => {
    expect(parseLastOnlineDays("kiedyś tam")).toBeUndefined();
    expect(parseLastOnlineDays("")).toBeUndefined();
  });
});

describe("getProfessionId", () => {
  test.each([
    ["Wojownik", "306w", 1],
    ["Mag", "331m", 2],
    ["Paladyn", "362p", 3],
    ["Tropiciel", "378t", 4],
    ["Tancerz ostrzy", "335b", 5],
    ["Łowca", "316h", 6],
  ] as const)("%s → %p", (title, level, expected) => {
    expect(getProfessionId(title, level)).toBe(expected);
  });

  test("copes with a mangled encoding of the name (owca ← Łowca)", () => {
    expect(getProfessionId("owca", "316h")).toBe(6);
  });

  test("falls back to the letter next to the level when title is missing", () => {
    expect(getProfessionId("", "378t")).toBe(4);
  });

  test("an unknown profession → null", () => {
    expect(getProfessionId("Nekromanta", "300")).toBeNull();
  });
});

describe("parseCharId", () => {
  test("extracts the character id from a profile link", () => {
    expect(parseCharId("/profile/view,6805038#char_729,aether")).toBe(729);
  });

  test("no fragment → null", () => {
    expect(parseCharId("/profile/view,6805038")).toBeNull();
  });
});

describe("getIntegerFromLadderText", () => {
  test.each([
    ["378t", 378],
    [" 9550 ", 9550],
    ["-20", -20],
    ["0", 0],
    ["-35", -35],
    ["600630", 600630],
    // The ranking groups long numbers with a space on some worlds; every space it is known
    // to use folds away, and nothing else does.
    ["600 630", 600630],
    ["600\u00A0630", 600630],
    ["", null],
    ["-", null],
    ["brak", null],
  ] as const)("%p → %p", (text, expected) => {
    expect(getIntegerFromLadderText(text)).toBe(expected);
  });

  // What the blanket `replace(/[^\d-]/g, "")` this reader replaced used to answer. It
  // deleted whatever it did not understand, so a cell holding two numbers read as one.
  test.each([
    ["1-2", null],
    ["--5", null],
    ["12abc", null],
    ["3.5", null],
    ["1e3", null],
    ["0x10", null],
  ] as const)("%p is refused rather than repaired → %p", (text, expected) => {
    expect(getIntegerFromLadderText(text)).toBe(expected);
  });
});

describe("parseTable against a real ranking page", () => {
  const { rows, errors } = parseTable($, "aether", 1);

  test("parses all 100 rows with no errors", () => {
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(100);
  });

  test("reconstructs ranks 1-3, which carry a portrait instead of a number", () => {
    expect(rows.map((r) => r[0]).slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[99]?.[0]).toBe(100);
  });

  test("the first row agrees with what the ranking shows", () => {
    const [rank, name, charId, level, profession, honor, lastOnlineDays] = rows[0]!;
    expect(rank).toBe(1);
    expect(name).toBe("essobe");
    expect(charId).toBe(729);
    expect(level).toBe(378);
    expect(profession).toBe(4); // Tropiciel
    expect(honor).toBeGreaterThan(0);
    expect(lastOnlineDays).toBe(0);
  });

  test("every row holds sensible values", () => {
    for (const [rank, name, charId, level, profession, honor, days] of rows) {
      expect(rank).toBeGreaterThan(0);
      expect(name.length).toBeGreaterThan(0);
      expect(charId).toBeGreaterThan(0);
      expect(level).toBeGreaterThan(0);
      expect(profession).toBeGreaterThanOrEqual(1);
      expect(profession).toBeLessThanOrEqual(6);
      expect(honor).toBeGreaterThanOrEqual(0);
      expect(days === null || days >= 0).toBe(true);
    }
  });

  test("nicknames and character ids are unique", () => {
    expect(new Set(rows.map((r) => r[1])).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r[2])).size).toBe(rows.length);
  });
});

describe("parseTable resilience", () => {
  const header = `<table><thead><tr><th>#</th><th>Gracz</th><th>Poziom</th><th>PH</th><th>Ostatnio online</th></tr></thead>`;
  const goodRow = `<tr>
    <td class="dark-cell id">1</td>
    <td class="long-clan"><a href="/profile/view,1#char_11,aether">Ktoś</a></td>
    <td class="long-level"><span title="Mag">300m</span></td>
    <td class="long-ph">42</td>
    <td class="long-last-online">3 dni temu</td>
  </tr>`;

  test("skips a faulty row instead of killing the whole page", () => {
    const badRow = `<tr>
      <td class="dark-cell id">2</td>
      <td class="long-clan"><a href="/profile/view,2#char_12,aether">Zły</a></td>
      <td class="long-level"><span title="Nekromanta">300x</span></td>
      <td class="long-ph">7</td>
      <td class="long-last-online">3 dni temu</td>
    </tr>`;
    const { rows, errors } = parseTable(cheerio.load(`${header}<tbody>${goodRow}${badRow}</tbody></table>`), "aether", 1);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.[1]).toBe("Ktoś");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("unknown profession");
  });

  test("no ladder table → LadderMarkupError", () => {
    expect(() => parseTable(cheerio.load("<table><thead><tr><th>Coś</th></tr></thead></table>"), "aether", 1))
      .toThrow(LadderMarkupError);
  });

  test("a table with no parsed rows → LadderMarkupError", () => {
    const brokenRow = `<tr><td class="dark-cell id">1</td><td class="long-clan"></td><td class="long-level"></td><td class="long-ph"></td><td class="long-last-online"></td></tr>`;
    expect(() => parseTable(cheerio.load(`${header}<tbody>${brokenRow}</tbody></table>`), "aether", 1))
      .toThrow(LadderMarkupError);
  });
});
