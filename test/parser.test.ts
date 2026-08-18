import { describe, expect, test } from "bun:test";
import * as cheerio from "cheerio";
import {
  ParseError,
  parseCharId,
  parseIntStrict,
  parseLastOnlineDays,
  parseTable,
  parseTotalPages,
  professionToId,
} from "../src/parser.ts";

const fixture = await Bun.file(
  new URL("./fixtures/ladder-aether-p1.html", import.meta.url).pathname,
).text();
const $ = cheerio.load(fixture);

describe("parseTotalPages", () => {
  test("czyta liczbę stron z .total-pages", () => {
    expect(parseTotalPages($)).toBe(390);
  });

  test("spada na input[max], gdy brak .total-pages", () => {
    const html = `<div class="pagination"></div>
      <input name="page" max="123" type="number">`;
    expect(parseTotalPages(cheerio.load(html))).toBe(123);
  });

  test("bierze maksimum z linków, a nie sklejone cyfry", () => {
    const html = `<div class="pagination">
      <a href="?page=2">2</a><a href="?page=3">3</a><a href="?page=390">390</a>
    </div>`;
    // Stara implementacja sklejała "2 3 390" → 23390.
    expect(parseTotalPages(cheerio.load(html))).toBe(390);
  });

  test("bez paginacji zwraca 1", () => {
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

  test("konto nigdy nieużywane → null zamiast daty w 1969 r.", () => {
    expect(parseLastOnlineDays("20655 dni temu")).toBeNull();
  });

  test("nieznany format → undefined", () => {
    expect(parseLastOnlineDays("kiedyś tam")).toBeUndefined();
    expect(parseLastOnlineDays("")).toBeUndefined();
  });
});

describe("professionToId", () => {
  test.each([
    ["Wojownik", "306w", 1],
    ["Mag", "331m", 2],
    ["Paladyn", "362p", 3],
    ["Tropiciel", "378t", 4],
    ["Tancerz ostrzy", "335b", 5],
    ["Łowca", "316h", 6],
  ] as const)("%s → %p", (title, level, expected) => {
    expect(professionToId(title, level)).toBe(expected);
  });

  test("radzi sobie z rozjechanym kodowaniem nazwy (owca ← Łowca)", () => {
    expect(professionToId("owca", "316h")).toBe(6);
  });

  test("spada na literę przy poziomie, gdy brak title", () => {
    expect(professionToId("", "378t")).toBe(4);
  });

  test("nieznana profesja → null", () => {
    expect(professionToId("Nekromanta", "300")).toBeNull();
  });
});

describe("parseCharId", () => {
  test("wyciąga id postaci z linku profilu", () => {
    expect(parseCharId("/profile/view,6805038#char_729,aether")).toBe(729);
  });

  test("brak fragmentu → null", () => {
    expect(parseCharId("/profile/view,6805038")).toBeNull();
  });
});

describe("parseIntStrict", () => {
  test.each([
    ["378t", 378],
    [" 9550 ", 9550],
    ["-20", -20],
    ["", null],
    ["-", null],
    ["brak", null],
  ] as const)("%p → %p", (text, expected) => {
    expect(parseIntStrict(text)).toBe(expected);
  });
});

describe("parseTable na prawdziwej stronie rankingu", () => {
  const { rows, errors } = parseTable($, "aether", 1);

  test("parsuje wszystkie 100 wierszy bez błędów", () => {
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(100);
  });

  test("odtwarza rangi 1-3, które mają portret zamiast numeru", () => {
    expect(rows.map((r) => r[0]).slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[99]?.[0]).toBe(100);
  });

  test("pierwszy wiersz zgadza się z tym, co pokazuje ranking", () => {
    const [rank, name, charId, level, profession, honor, lastOnlineDays] = rows[0]!;
    expect(rank).toBe(1);
    expect(name).toBe("essobe");
    expect(charId).toBe(729);
    expect(level).toBe(378);
    expect(profession).toBe(4); // Tropiciel
    expect(honor).toBeGreaterThan(0);
    expect(lastOnlineDays).toBe(0);
  });

  test("wszystkie wiersze mają sensowne wartości", () => {
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

  test("nicki i id postaci są unikalne", () => {
    expect(new Set(rows.map((r) => r[1])).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r[2])).size).toBe(rows.length);
  });
});

describe("odporność parseTable", () => {
  const header = `<table><thead><tr><th>#</th><th>Gracz</th><th>Poziom</th><th>PH</th><th>Ostatnio online</th></tr></thead>`;
  const goodRow = `<tr>
    <td class="dark-cell id">1</td>
    <td class="long-clan"><a href="/profile/view,1#char_11,aether">Ktoś</a></td>
    <td class="long-level"><span title="Mag">300m</span></td>
    <td class="long-ph">42</td>
    <td class="long-last-online">3 dni temu</td>
  </tr>`;

  test("pomija wadliwy wiersz zamiast zabijać całą stronę", () => {
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

  test("brak tabeli rankingu → ParseError", () => {
    expect(() => parseTable(cheerio.load("<table><thead><tr><th>Coś</th></tr></thead></table>"), "aether", 1))
      .toThrow(ParseError);
  });

  test("tabela bez sparsowanych wierszy → ParseError", () => {
    const brokenRow = `<tr><td class="dark-cell id">1</td><td class="long-clan"></td><td class="long-level"></td><td class="long-ph"></td><td class="long-last-online"></td></tr>`;
    expect(() => parseTable(cheerio.load(`${header}<tbody>${brokenRow}</tbody></table>`), "aether", 1))
      .toThrow(ParseError);
  });
});
