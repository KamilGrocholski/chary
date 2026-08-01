import * as cheerio from "cheerio";

// ── Schemat wiersza (v2) ──────────────────────────────────────────────────────
//
// Snapshoty sprzed sierpnia 2026 mają schemat v1:
//   [rank, name, level, profession, honor, lastOnlineText, lastOnlineISO]
// gdzie lastOnlineISO był wyliczany z tekstu i czasu scrape'u — udawał precyzję,
// której źródło nie podaje. v2 zapisuje wprost liczbę dni:

export type PlayerRow = [
  rank: number,
  name: string,
  charId: number,
  level: number,
  profession: number,
  honor: number,
  // 0 = „Mniej niż 24h temu”, N = „N dni temu”, null = konto nigdy nieużywane
  lastOnlineDays: number | null,
];

export const ROW_SCHEMA = 2;

// Ranking pokazuje ~20655 dni („1969 r.”) dla kont, które nigdy nie były online.
const NEVER_ONLINE_DAYS = 10_000;

export const PROFESSIONS: Record<number, string> = {
  1: "Wojownik",
  2: "Mag",
  3: "Paladyn",
  4: "Tropiciel",
  5: "Tancerz ostrzy",
  6: "Łowca",
};

// Litera doklejana do poziomu w kolumnie „Poziom” (np. „378t”).
const PROFESSION_BY_LETTER: Record<string, number> = {
  w: 1,
  m: 2,
  p: 3,
  t: 4,
  b: 5,
  h: 6,
};

const PROFESSION_BY_NAME: Record<string, number> = {
  wojownik: 1,
  mag: 2,
  paladyn: 3,
  tropiciel: 4,
  "tancerz ostrzy": 5,
  lowca: 6,
};

export class ParseError extends Error {
  readonly type = "ParseError";
  constructor(message: string, readonly world: string, readonly page: number) {
    super(`${message} (world=${world}, page=${page})`);
  }
}

export type ParsedTable = {
  rows: PlayerRow[];
  /** Wiersze odrzucone wraz z powodem — scraper decyduje, czy próg został przekroczony. */
  errors: string[];
};

// ── Helpery ───────────────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/** Zwraca null, gdy tekst nie zawiera poprawnej liczby całkowitej. */
export function parseIntStrict(text: string): number | null {
  const cleaned = text.replace(/[^\d-]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isInteger(n) ? n : null;
}

export function professionToId(title: string, levelText: string): number | null {
  const byName = PROFESSION_BY_NAME[normalize(title)];
  if (byName) return byName;

  const letter = levelText.trim().toLowerCase().match(/(\d+)\s*([a-z])\s*$/)?.[2];
  return letter ? PROFESSION_BY_LETTER[letter] ?? null : null;
}

/**
 * „Mniej niż 24h temu” → 0, „N dni temu” → N, konto nigdy nieużywane → null.
 * Zwraca undefined dla formatu, którego nie rozpoznajemy (sygnał do zgłoszenia).
 */
export function parseLastOnlineDays(text: string): number | null | undefined {
  const t = normalize(text);

  if (t.includes("mniej") && t.includes("24h")) return 0;

  const m = t.match(/(\d+)\s+(?:dni?|dzien)\s+temu/);
  if (!m) return undefined;

  const days = Number(m[1]);
  return days >= NEVER_ONLINE_DAYS ? null : days;
}

/** `/profile/view,6805038#char_729,aether` → 729 */
export function parseCharId(href: string): number | null {
  const m = href.match(/#char_(\d+)/);
  return m ? Number(m[1]) : null;
}

export function parseTotalPages($: cheerio.CheerioAPI): number {
  const fromTotal = parseIntStrict($(".pagination .total-pages").first().text());
  if (fromTotal && fromTotal > 0) return fromTotal;

  const fromInput = parseIntStrict($("input[name='page'][max]").attr("max") ?? "");
  if (fromInput && fromInput > 0) return fromInput;

  // Najwyższy numer strony wśród linków paginacji. Uwaga: numery MUSZĄ być
  // parsowane osobno — sklejenie ich w jeden string dawało liczby typu 234390.
  const fromLinks = $(".pagination a[href*='page=']")
    .map((_, el) => parseIntStrict($(el).attr("href")?.match(/page=(\d+)/)?.[1] ?? ""))
    .get()
    .filter((n): n is number => typeof n === "number" && n > 0);

  return fromLinks.length > 0 ? Math.max(...fromLinks) : 1;
}

// ── Tabela rankingu ───────────────────────────────────────────────────────────

function findLadderTable($: cheerio.CheerioAPI) {
  return $("table")
    .filter((_, el) => {
      const txt = $(el).find("thead").text();
      return txt.includes("Gracz") && txt.includes("Poziom") && txt.includes("Ostatnio online");
    })
    .first();
}

/**
 * Parsuje jedną stronę rankingu. Wadliwe wiersze trafiają do `errors` zamiast
 * przerywać całą stronę — o przerwaniu decyduje wywołujący na podstawie progu.
 * Rzuca tylko wtedy, gdy nie znajdzie tabeli albo nie sparsuje ani jednego wiersza.
 */
export function parseTable($: cheerio.CheerioAPI, world: string, page: number): ParsedTable {
  const table = findLadderTable($);
  if (table.length === 0) {
    throw new ParseError("Nie znaleziono tabeli rankingu (zmiana markupu?)", world, page);
  }

  const rows: PlayerRow[] = [];
  const errors: string[] = [];
  // Miejsca 1-3 mają w kolumnie „#” portret zamiast liczby — rangę odtwarzamy
  // z pozycji względem pierwszego wiersza, w którym numer faktycznie jest.
  const parsed: { index: number; rank: number | null; row: PlayerRow }[] = [];

  table.find("tbody tr").each((index, tr) => {
    const $tr = $(tr);
    const tds = $tr.children("td");
    if (tds.length < 5) {
      errors.push(`wiersz ${index}: ${tds.length} kolumn, oczekiwano 5`);
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
      errors.push(`wiersz ${index}: pusty nick`);
      return;
    }

    const charId = parseCharId(nameCell.find("a").first().attr("href") ?? "");
    if (charId === null) {
      errors.push(`wiersz ${index} ("${name}"): brak char_id w linku profilu`);
      return;
    }

    const levelText = levelCell.text().trim();
    const level = parseIntStrict(levelText);
    if (level === null || level < 1) {
      errors.push(`wiersz ${index} ("${name}"): błędny poziom ${JSON.stringify(levelText)}`);
      return;
    }

    const profession = professionToId(levelCell.find("[title]").first().attr("title") ?? "", levelText);
    if (profession === null) {
      errors.push(`wiersz ${index} ("${name}"): nieznana profesja w ${JSON.stringify(levelText)}`);
      return;
    }

    const honorText = honorCell.text().trim();
    const honor = parseIntStrict(honorText);
    if (honor === null) {
      errors.push(`wiersz ${index} ("${name}"): błędne PH ${JSON.stringify(honorText)}`);
      return;
    }

    const lastOnlineText = lastOnlineCell.text().trim();
    const lastOnlineDays = parseLastOnlineDays(lastOnlineText);
    if (lastOnlineDays === undefined) {
      errors.push(`wiersz ${index} ("${name}"): nierozpoznane "ostatnio online" ${JSON.stringify(lastOnlineText)}`);
      return;
    }

    const rank = parseIntStrict($(tds[0]).text());
    parsed.push({
      index,
      rank: rank !== null && rank > 0 ? rank : null,
      row: [rank ?? 0, name, charId, level, profession, honor, lastOnlineDays],
    });
  });

  if (parsed.length === 0) {
    throw new ParseError(
      `Nie sparsowano żadnego wiersza${errors.length ? `; pierwszy błąd: ${errors[0]}` : ""}`,
      world,
      page,
    );
  }

  // Kotwica: pierwszy wiersz z jawnym numerem rangi. Gdy strona nie ma żadnego
  // (teoretycznie możliwe), wracamy do wyliczenia z numeru strony.
  const anchor = parsed.find((p) => p.rank !== null);
  const anchorRank = anchor?.rank ?? (page - 1) * 100 + (parsed[0]?.index ?? 0) + 1;
  const anchorIndex = anchor?.index ?? parsed[0]?.index ?? 0;

  for (const p of parsed) {
    p.row[0] = p.rank ?? anchorRank + (p.index - anchorIndex);
    rows.push(p.row);
  }

  return { rows, errors };
}
