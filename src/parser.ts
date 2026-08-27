import * as cheerio from "cheerio";
import { getIntegerFromText } from "@/public/lib/number.js";
import { MargoStatToolError } from "@/src/margostat-tool-error.ts";
import { getProfessionEntries } from "@/public/shared.js";

// ── The row schema (v2) ───────────────────────────────────────────────────────
//
// Snapshots from before August 2026 use schema v1:
//   [rank, name, level, profession, honor, lastOnlineText, lastOnlineISO]
// where lastOnlineISO was derived from the text and the scrape time — it faked a
// precision the source does not give. v2 stores the number of days outright:

export type PlayerRow = [
  rank: number,
  name: string,
  charId: number,
  level: number,
  profession: number,
  honor: number,
  // 0 = "less than 24 h ago", N = "N days ago", null = an account never used
  lastOnlineDays: number | null,
];

export const ROW_SCHEMA = 2;

// The ranking shows ~20655 days ("1969") for accounts that have never been online.
const NEVER_ONLINE_DAYS = 10_000;

// The letter appended to the level in the "Poziom" column (e.g. "378t").
const PROFESSION_BY_LETTER: Record<string, number> = {
  w: 1,
  m: 2,
  p: 3,
  t: 4,
  b: 5,
  h: 6,
};

// The column heading the ranking prints, folded the way `normalize` folds it, back to the
// id. Derived rather than written out: the names themselves are `PROFESSION_NAMES` in
// `public/shared.js` (§9.1), and this file used to hold two more copies of them — one to
// read a heading with and one nothing read at all.
const PROFESSION_BY_NAME: Record<string, number> = Object.fromEntries(
  getProfessionEntries().map(([id, name]) => [normalize(name), id]),
);

/**
 * The ranking page did not have the shape we can read.
 *
 * Thrown, not collected: a single unreadable row is data the caller decides about
 * (`ParsedTable.errors`), but a missing table or a page nothing parsed on means the markup
 * changed, and every world would fail the same way. Loud is correct here — §9.5.
 */
export class LadderMarkupError extends MargoStatToolError {
  constructor(message: string, readonly world: string, readonly page: number) {
    super("LadderMarkup", `${message} (world=${world}, page=${page})`);
  }
}

export type ParsedTable = {
  rows: PlayerRow[];
  /** Rejected rows with the reason — the scraper decides whether the threshold was crossed. */
  errors: string[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/**
 * An integer as the ranking spells one: digits, optionally grouped by a space, and
 * optionally followed by the profession letter the "Poziom" column appends ("378t").
 *
 * Its own reader rather than `getIntegerFromText` alone, because those two shapes are the
 * ranking's and not JavaScript's — and its own reader rather than the blanket
 * `replace(/[^\d-]/g, "")` it replaces, which read "1-2" as 12 and "--5" as −5 by deleting
 * whatever it did not understand. What it strips now is named, and everything else is
 * `null`.
 *
 * Honor reaches six figures and can be negative (−35 observed), so neither a width limit
 * nor a floor at zero belongs here.
 */
export function getIntegerFromLadderText(text: string): number | null {
  const grouped = text.trim().replace(/[\u0020\u00A0\u2009\u202F]/g, "");
  const withoutProfessionLetter = grouped.replace(/[a-z]$/i, "");
  return getIntegerFromText(withoutProfessionLetter);
}

export function getProfessionId(title: string, levelText: string): number | null {
  const byName = PROFESSION_BY_NAME[normalize(title)];
  if (byName) return byName;

  const letter = levelText.trim().toLowerCase().match(/(\d+)\s*([a-z])\s*$/)?.[2];
  return letter ? PROFESSION_BY_LETTER[letter] ?? null : null;
}

/**
 * "Mniej niż 24h temu" → 0, "N dni temu" → N, an account never used → null.
 * Returns undefined for a format we do not recognise — a signal to report it.
 */
export function parseLastOnlineDays(text: string): number | null | undefined {
  const t = normalize(text);

  if (t.includes("mniej") && t.includes("24h")) return 0;

  const m = t.match(/(\d+)\s+(?:dni?|dzien)\s+temu/);
  if (!m) return undefined;

  // The capture proves the shape; it says nothing about the magnitude, and the reader is
  // what turns a run of digits past 2^53 into `null` rather than into a neighbour of itself.
  const days = getIntegerFromText(m[1] ?? "");
  if (days === null) return undefined;
  return days >= NEVER_ONLINE_DAYS ? null : days;
}

/** `/profile/view,6805038#char_729,aether` → 729 */
export function parseCharId(href: string): number | null {
  const digits = href.match(/#char_(\d+)/)?.[1];
  return digits === undefined ? null : getIntegerFromText(digits);
}

export function parseTotalPages($: cheerio.CheerioAPI): number {
  const fromTotal = getIntegerFromLadderText($(".pagination .total-pages").first().text());
  if (fromTotal && fromTotal > 0) return fromTotal;

  const fromInput = getIntegerFromLadderText($("input[name='page'][max]").attr("max") ?? "");
  if (fromInput && fromInput > 0) return fromInput;

  // The highest page number among the pagination links. Note: the numbers MUST be
  // parsed one at a time — joining them into one string produced figures like 234390.
  const fromLinks = $(".pagination a[href*='page=']")
    .map((_, el) => getIntegerFromLadderText($(el).attr("href")?.match(/page=(\d+)/)?.[1] ?? ""))
    .get()
    .filter((n): n is number => typeof n === "number" && n > 0);

  return fromLinks.length > 0 ? Math.max(...fromLinks) : 1;
}

// ── The ranking table ─────────────────────────────────────────────────────────

function findLadderTable($: cheerio.CheerioAPI) {
  return $("table")
    .filter((_, el) => {
      const txt = $(el).find("thead").text();
      return txt.includes("Gracz") && txt.includes("Poziom") && txt.includes("Ostatnio online");
    })
    .first();
}

/**
 * Parses one page of the ranking. Faulty rows go into `errors` instead of aborting the
 * whole page — the caller decides whether to abort, based on the threshold. Throws only
 * when it cannot find the table or cannot parse a single row.
 */
export function parseTable($: cheerio.CheerioAPI, world: string, page: number): ParsedTable {
  const table = findLadderTable($);
  if (table.length === 0) {
    throw new LadderMarkupError("ladder table not found (did the markup change?)", world, page);
  }

  const rows: PlayerRow[] = [];
  const errors: string[] = [];
  // Places 1-3 carry a portrait instead of a number in the "#" column — we reconstruct
  // the rank from the offset against the first row that does have a number.
  const parsed: { index: number; rank: number | null; row: PlayerRow }[] = [];

  table.find("tbody tr").each((index, tr) => {
    const $tr = $(tr);
    const tds = $tr.children("td");
    if (tds.length < 5) {
      errors.push(`row ${index}: ${tds.length} columns, expected 5`);
      return;
    }

    const cell = (className: string, fallbackIndex: number) => {
      const byClass = $tr.children(`td.${className}`).first();
      return byClass.length > 0 ? byClass : $(tds[fallbackIndex]);
    };

    const nameCell = cell("long-clan", 1);
    const levelCell = cell("long-level", 2);
    const honorCell = cell("long-ph", 3);
    const lastOnlineCell = cell("long-last-online", 4);

    const name = nameCell.text().trim();
    if (!name) {
      errors.push(`row ${index}: empty nickname`);
      return;
    }

    const charId = parseCharId(nameCell.find("a").first().attr("href") ?? "");
    if (charId === null) {
      errors.push(`row ${index} ("${name}"): no char_id in the profile link`);
      return;
    }

    const levelText = levelCell.text().trim();
    const level = getIntegerFromLadderText(levelText);
    if (level === null || level < 1) {
      errors.push(`row ${index} ("${name}"): invalid level ${JSON.stringify(levelText)}`);
      return;
    }

    const profession = getProfessionId(levelCell.find("[title]").first().attr("title") ?? "", levelText);
    if (profession === null) {
      errors.push(`row ${index} ("${name}"): unknown profession in ${JSON.stringify(levelText)}`);
      return;
    }

    const honorText = honorCell.text().trim();
    const honor = getIntegerFromLadderText(honorText);
    if (honor === null) {
      errors.push(`row ${index} ("${name}"): invalid honor ${JSON.stringify(honorText)}`);
      return;
    }

    const lastOnlineText = lastOnlineCell.text().trim();
    const lastOnlineDays = parseLastOnlineDays(lastOnlineText);
    if (lastOnlineDays === undefined) {
      errors.push(`row ${index} ("${name}"): unrecognised "last online" ${JSON.stringify(lastOnlineText)}`);
      return;
    }

    const rank = getIntegerFromLadderText($(tds[0]).text());
    parsed.push({
      index,
      rank: rank !== null && rank > 0 ? rank : null,
      row: [rank ?? 0, name, charId, level, profession, honor, lastOnlineDays],
    });
  });

  if (parsed.length === 0) {
    throw new LadderMarkupError(
      `not a single row parsed${errors.length ? `; first error: ${errors[0]}` : ""}`,
      world,
      page,
    );
  }

  // The anchor: the first row with an explicit rank number. When a page has none
  // (theoretically possible), we fall back to deriving it from the page number.
  const anchor = parsed.find((p) => p.rank !== null);
  const anchorRank = anchor?.rank ?? (page - 1) * 100 + (parsed[0]?.index ?? 0) + 1;
  const anchorIndex = anchor?.index ?? parsed[0]?.index ?? 0;

  for (const p of parsed) {
    p.row[0] = p.rank ?? anchorRank + (p.index - anchorIndex);
    rows.push(p.row);
  }

  return { rows, errors };
}
