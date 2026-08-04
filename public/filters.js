// Filtr i zliczanie — rdzeń, którego używa i przekrój jednej migawki, i historia
// wszystkich. Bez DOM-u, bez `fetch`-a, bez niczego uruchamianego przy imporcie.
//
// Działa na dwóch reprezentacjach migawki naraz i musi tak zostać:
//   • surowy `.f.json` — `level/profession/honor` to `number[]`, `days` to `(number|null)[]`
//   • migawka po konwersji w `history.js` — tablice typowane, `null` zapisany jako −1
// Różnicę zna wyłącznie `isNeverOnline` z `shared.js`, więc jest tu jedna ścieżka kodu.

import { activityBucket, isNeverOnline } from "./shared.js";

// Zakresy koszyków aktywności (w dniach). Koszyk 4 to konta nigdy nieużywane.
// Koszyki są rozłączne, nie skumulowane — etykiety muszą to oddawać, bo „≤ 7 dni”
// przy koszyku 1-7 sugerowało, że to wszyscy z ostatniego tygodnia, a to tylko ci,
// których nie ma w koszyku „< 24h”.
export const ACTIVITY_BOUNDS = [
  [0, 0],
  [1, 7],
  [8, 30],
  [31, Infinity],
];

/**
 * Etykieta koszyka przycięta do aktywnego progu — przy filtrze „14 dni” koszyk
 * 8-30 zawiera realnie 8-14 dni i tak ma być podpisany.
 */
export function activityLabel(bucket, maxDays = Infinity) {
  if (bucket === 4) return "nigdy";

  const [from, to] = ACTIVITY_BOUNDS[bucket];
  const hi = Math.min(to, maxDays);
  if (from === 0) return "< 24h";
  if (hi === Infinity) return `> ${from - 1} dni`;
  if (from === hi) return from === 1 ? "1 dzień" : `${from} dni`;
  return `${from}-${hi} dni`;
}

/**
 * Koszyki, które przy danym progu mogą być niepuste. Bez tego widok pokazywał
 * „> 30 dni: 0 · nigdy: 0” — zera z definicji, wyglądające jak zepsute dane.
 */
export function visibleActivityBuckets(maxDays = Infinity) {
  if (maxDays === Infinity) return [0, 1, 2, 3, 4];
  return ACTIVITY_BOUNDS.map(([from], bucket) => (from <= maxDays ? bucket : null)).filter((b) => b !== null);
}

// ── Filtry ──────────────────────────────────────────────────────────────────

export function emptyFilters() {
  return {
    minLevel: -Infinity,
    maxLevel: Infinity,
    minHonor: -Infinity,
    maxHonor: Infinity,
    maxDays: Infinity,
    professions: new Set([1, 2, 3, 4, 5, 6]),
  };
}

/**
 * Czy filtr niczego nie odrzuca. To nie jest kosmetyka: przy filtrze domyślnym widok
 * historii bierze gotowy `trends.json` (9 KB) zamiast pobierać migawki jednego świata
 * (do 1,9 MB). Cała leniwa ścieżka pobierania wisi na tej funkcji.
 */
export function isDefaultFilters(f) {
  return (
    f.minLevel === -Infinity &&
    f.maxLevel === Infinity &&
    f.minHonor === -Infinity &&
    f.maxHonor === Infinity &&
    f.maxDays === Infinity &&
    f.professions.size === 6
  );
}

export function matches(data, i, f) {
  const level = data.level[i];
  if (!level || level < f.minLevel || level > f.maxLevel) return false;
  if (!f.professions.has(data.profession[i])) return false;

  const honor = data.honor[i];
  if (honor < f.minHonor || honor > f.maxHonor) return false;

  // „nigdy online” wypada przy każdym progu aktywności — i musi być sprawdzone
  // przed progiem, bo wartownik −1 przechodzi każde porównanie `>`.
  const days = data.days[i];
  if (f.maxDays !== Infinity && (isNeverOnline(days) || days > f.maxDays)) return false;
  return true;
}

// ── Zliczanie ───────────────────────────────────────────────────────────────

/** Mapa poziom → [liczba dla profesji 1..6]. Potrzebna tylko przekrojowi jednej migawki. */
export function countByLevel(data, f) {
  const counts = new Map();
  for (let i = 0; i < data.count; i++) {
    if (!matches(data, i, f)) continue;

    const level = data.level[i];
    let bucket = counts.get(level);
    if (!bucket) {
      bucket = [0, 0, 0, 0, 0, 0];
      counts.set(level, bucket);
    }
    bucket[data.profession[i] - 1] += 1;
  }
  return counts;
}

export function countByActivity(data, f) {
  const buckets = [0, 0, 0, 0, 0];
  for (let i = 0; i < data.count; i++) {
    if (!matches(data, i, f)) continue;
    buckets[activityBucket(data.days[i])] += 1;
  }
  return buckets.map((count, bucket) => [bucket, count]);
}

export function totalsFromCounts(counts) {
  const perProfession = [0, 0, 0, 0, 0, 0];
  let total = 0;
  for (const row of counts.values()) {
    for (let p = 0; p < 6; p++) {
      perProfession[p] += row[p];
      total += row[p];
    }
  }
  return { total, perProfession };
}

/**
 * Podsumowanie migawki pod filtrem — **kształt wiersza `trends.json`**, tyle że
 * policzony u klienta i z filtrem. Dzięki temu wykresy historii dostają dokładnie
 * te dane, które rysowały wcześniej z agregatu, i nie potrzebują ani linijki
 * nowego kodu rysującego.
 *
 * Jeden przelot, nie trzy: dla całej historii świata `countByLevel` i `countByActivity`
 * osobno oznaczałyby 2N przejść po tablicy zamiast N.
 *
 * Przy filtrze domyślnym musi dawać co do liczby to samo, co `summarizeSnapshot`
 * z `src/trends.ts` policzył na serwerze — pilnuje tego test na wszystkich migawkach.
 */
export function summarizeFiltered(data, f) {
  const act = [0, 0, 0, 0, 0];
  const byProf = [0, 0, 0, 0, 0, 0];
  let total = 0;

  for (let i = 0; i < data.count; i++) {
    if (!matches(data, i, f)) continue;
    total += 1;
    act[activityBucket(data.days[i])] += 1;
    byProf[data.profession[i] - 1] += 1;
  }
  return { total, act, byProf };
}

// ── Stan filtrów w URL-u ────────────────────────────────────────────────────
//
// Bez tego przycisk „kopiuj link do tego widoku” wysyłał widok domyślny —
// ktoś, kto ustawił poziom 250-320 i honor > 100k, dzielił się czymś innym,
// niż miał na ekranie.

export function filtersToParams(f) {
  const params = new URLSearchParams();
  const put = (key, value) => {
    if (Number.isFinite(value)) params.set(key, String(value));
  };

  put("minLevel", f.minLevel);
  put("maxLevel", f.maxLevel);
  put("minHonor", f.minHonor);
  put("maxHonor", f.maxHonor);
  put("maxDays", f.maxDays);

  const profs = [...f.professions].sort((a, b) => a - b);
  if (profs.length !== 6) params.set("prof", profs.join(","));

  return params;
}

export function filtersFromParams(params) {
  const num = (key, fallback) => {
    const raw = params.get(key);
    if (raw === null || raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };

  const rawProf = params.get("prof");
  const parsed = (rawProf ?? "")
    .split(",")
    .map(Number)
    .filter((p) => Number.isInteger(p) && p >= 1 && p <= 6);

  const maxDays = num("maxDays", Infinity);
  return {
    minLevel: num("minLevel", -Infinity),
    maxLevel: num("maxLevel", Infinity),
    minHonor: num("minHonor", -Infinity),
    maxHonor: num("maxHonor", Infinity),
    // Ujemny próg dni nie znaczy nic — traktujemy jak brak filtra zamiast
    // po cichu pokazywać pustą stronę.
    maxDays: maxDays < 0 ? Infinity : maxDays,
    professions: new Set(parsed.length > 0 ? parsed : [1, 2, 3, 4, 5, 6]),
  };
}
