// Polityka ponawiania — czyste funkcje, żeby dały się przetestować.
//
// `world_scraper.ts` wykonuje CLI i cały scrape na najwyższym poziomie modułu, więc
// zaimportowanie go z testu uruchomiłoby rundę. Tu mieszka to, co musi być sprawdzone
// bez sieci: nieprzetestowany backoff jest dokładnie tym, przez co `Retry-After: 0`
// przez wiele miesięcy kasował pauzę między próbami.

export const MAX_PAGE_RETRIES = 3;
export const BACKOFF_BASE_MS = 5_000;
export const MAX_BACKOFF_MS = 120_000;

/** `Retry-After` w milisekundach — nagłówek bywa liczbą sekund albo datą HTTP. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * Ile czekać przed kolejną próbą. `suggested` to `Retry-After` z odpowiedzi.
 *
 * Podpowiedź serwera może pauzę **przedłużyć**, ale nigdy jej nie skraca poniżej
 * własnego progu wykładniczego. Wcześniej `suggested ?? …` przepuszczało
 * `Retry-After: 0` — bo `0 ?? x` to `0`, nie `x` — i cztery żądania szły pod rząd
 * bez żadnej pauzy, wprost przeciw zasadzie „szanuj serwis”.
 */
export function backoffFor(attempt: number, suggested?: number): number {
  const own = BACKOFF_BASE_MS * 2 ** (attempt - 1);
  return Math.min(Math.max(suggested ?? 0, own), MAX_BACKOFF_MS);
}
