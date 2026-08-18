// Historia jednego świata: skumulowane progi aktywności, serie do wykresów oraz
// pobieranie surowych migawek, gdy agregat przestaje wystarczać.
//
// Widok ma dwie ścieżki i to jest cały jego sens:
//   • filtr domyślny → `trends.json`, 9 KB, jeden fetch, natychmiast
//   • filtr ustawiony → `.f.json` tego jednego świata, do 1,9 MB, dopiero na żądanie
// Obie kończą się obiektem o tym samym kształcie, więc rysowanie ich nie odróżnia.
//
// Bez DOM-u. `fetch` tak — to nie przeglądarkowy interfejs dokumentu i testy podstawiają
// go atrapą.

import { daysBetween } from "./shared.js";
import { isDefaultFilters, summarizeFiltered } from "./filters.js";

/**
 * Progi aktywności — **skumulowane**, w odróżnieniu od rozłącznych koszyków
 * `act` w pliku i `ACTIVITY_BOUNDS` w `filters.js`. „≤ 7 dni” to koszyki 0 i 1 razem;
 * pomylenie tych dwóch skal dałoby wykres zaniżony o cały koszyk „< 24h”.
 *
 * `bound` to najwyższa liczba dni, którą próg jeszcze obejmuje — służy do wykrycia
 * progów, które pod filtrem aktywności przestają cokolwiek mówić (`usableThresholds`).
 */
export const ACTIVITY_THRESHOLDS = [
  { key: "24h", label: "< 24h", buckets: [0], bound: 0 },
  { key: "7d", label: "≤ 7 dni", buckets: [0, 1], bound: 7 },
  { key: "30d", label: "≤ 30 dni", buckets: [0, 1, 2], bound: 30 },
];

// Domyślnie ≤ 7 dni: „< 24h” waha się o 14,7% przy populacji stabilnej na 0,6%,
// bo zależy od godziny i dnia tygodnia scrapa. Patrz docs/2026-08-04-spec-trends.md.
export const DEFAULT_THRESHOLD = "7d";

/**
 * Progi, które przy danym filtrze aktywności jeszcze coś mówią.
 *
 * Gdy użytkownik odfiltruje „online ≤ 7 dni”, to w zbiorze nie ma już nikogo powyżej
 * siedmiu dni — próg „≤ 7 dni” zrówna się z liczbą pasujących, a „≤ 30 dni” tak samo.
 * Trzy linie jedna na drugiej wyglądają jak potwierdzenie czegokolwiek, a są tym samym
 * pytaniem zadanym trzy razy, więc próg szerszy od filtra po prostu znika z wyboru.
 */
export function usableThresholds(maxDays = Infinity) {
  return ACTIVITY_THRESHOLDS.filter((t) => t.bound < maxDays);
}

export function thresholdByKey(key, maxDays = Infinity) {
  const usable = usableThresholds(maxDays);
  if (usable.length === 0) return null;
  return (
    usable.find((t) => t.key === key) ??
    usable.find((t) => t.key === DEFAULT_THRESHOLD) ??
    usable[usable.length - 1]
  );
}

/** Liczba aktywnych w każdej migawce przy danym progu. */
export function activeCounts(trend, key, maxDays = Infinity) {
  const threshold = thresholdByKey(key, maxDays);
  if (!threshold) return trend.total.slice();
  return trend.total.map((_, i) => threshold.buckets.reduce((sum, bucket) => sum + trend.act[bucket][i], 0));
}

/** Udział w populacji, w procentach. Migawka bez graczy daje 0, nie NaN. */
export function shareSeries(counts, totals) {
  return counts.map((count, i) => (totals[i] > 0 ? (count / totals[i]) * 100 : 0));
}

/** Migawki jako wpisy `{ id, startedAt }` — format, który rozumieją funkcje z shared.js. */
export function snapshotEntries(trend) {
  return trend.id.map((id, i) => ({ id, startedAt: trend.startedAt[i], suspect: trend.suspect[i] === 1 }));
}

/**
 * Zmiany między kolejnymi migawkami. `perDay` jest tu ważniejsze niż `delta`:
 * odstępy między migawkami wynoszą 3-17 dni, więc „−120 graczy” z dwóch wierszy
 * tabeli znaczy dwie różne rzeczy, dopóki nie podzieli się przez czas.
 *
 * To samo dzielenie ratuje historię wczytaną częściowo: brakująca migawka robi
 * dłuższy odstęp, a nie fałszywy skok, bo `perDay` dzieli przez realny czas.
 */
export function changeRows(trend) {
  const entries = snapshotEntries(trend);
  const rows = [];

  for (let i = 1; i < entries.length; i++) {
    const days = daysBetween(entries[i - 1], entries[i]);
    const delta = trend.total[i] - trend.total[i - 1];
    rows.push({
      entry: entries[i],
      total: trend.total[i],
      delta,
      days,
      perDay: days && days > 0 ? delta / days : null,
    });
  }
  return rows;
}

/** Podsumowanie całej historii świata — od pierwszej migawki do ostatniej. */
export function summarize(trend) {
  const last = trend.total.length - 1;
  if (last < 0) return null;

  const entries = snapshotEntries(trend);
  const first = trend.total[0];
  const delta = trend.total[last] - first;
  return {
    snapshots: trend.total.length,
    total: trend.total[last],
    delta,
    percent: first > 0 ? (delta / first) * 100 : 0,
    days: daysBetween(entries[0], entries[last]),
  };
}

// ── Stan widoku w URL-u (wszystko poza filtrami) ────────────────────────────

export function viewToParams(view) {
  const params = new URLSearchParams();
  if (view.world) params.set("world", view.world);
  if (view.date) params.set("date", view.date);
  if (view.threshold && view.threshold !== DEFAULT_THRESHOLD) params.set("prog", view.threshold);
  if (view.share) params.set("udzial", "1");
  return params;
}

export function viewFromParams(params) {
  const threshold = params.get("prog");
  return {
    world: params.get("world") || null,
    date: params.get("date") || null,
    threshold: ACTIVITY_THRESHOLDS.some((t) => t.key === threshold) ? threshold : DEFAULT_THRESHOLD,
    share: params.get("udzial") === "1",
  };
}

// ── Surowe migawki: konwersja, pamięć, pobieranie ───────────────────────────

/**
 * Ile migawek świata wczytujemy domyślnie.
 *
 * Historia rośnie o ~185 KB gzip na migawkę największego świata, więc bez sufitu
 * ten widok co rundę drożeje i nikt tego nie zauważy. Dziś najdłuższa historia ma
 * 11 migawek, czyli okno jeszcze niczego nie ucina — ale gdy zacznie, użytkownik
 * ma to zobaczyć w liczniku „N z M”, a nie zgadywać.
 */
export const HISTORY_WINDOW = 12;

/** Ostatnie `HISTORY_WINDOW` migawek — wpisy przychodzą posortowane po `startedAt`. */
export function windowedEntries(entries, size = HISTORY_WINDOW) {
  return entries.length <= size ? entries.slice() : entries.slice(entries.length - size);
}

/**
 * Surowy `.f.json` → tablice typowane. Zwykłe tablice JS trzymane dla dziesięciu
 * migawek naraz to kilkukrotnie większy narzut; tutaj wychodzi 11 B na wiersz.
 *
 * `days` celowo w `Int32Array`, nie `Int16Array`: zakres realnych wartości mieści się
 * w 16 bitach z zapasem, ale przepełnienie zawinęłoby się na liczbę ujemną, czyli
 * po cichu przerobiło gracza sprzed lat na konto nigdy nieużywane. Dwa bajty na wiersz
 * to tania cena za brak takiej klasy błędu.
 */
export function toTypedSnapshot(json) {
  const count = json.count;
  const days = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const d = json.days[i];
    days[i] = d === null || d === undefined ? -1 : d;
  }

  return {
    count,
    level: Int16Array.from(json.level),
    profession: Uint8Array.from(json.profession),
    honor: Int32Array.from(json.honor),
    days,
    suspect: json.suspect ?? null,
  };
}

// Migawki trzymamy w pamięci per świat. Bez sufitu przełączanie światów po kolei
// zebrałoby w karcie wszystkie 21, czyli grubo ponad 100 MB.
const MAX_CACHED_WORLDS = 2;
const cache = new Map();

export function cachedSnapshots(world) {
  let store = cache.get(world);
  if (!store) {
    store = new Map();
    cache.set(world, store);
    while (cache.size > MAX_CACHED_WORLDS) cache.delete(cache.keys().next().value);
  }
  return store;
}

/** Ile z podanych migawek leży już w pamięci. */
export function loadedCount(store, entries) {
  return entries.reduce((n, e) => n + (store.has(e.id) ? 1 : 0), 0);
}

// Trwające pobrania, po jednym na świat.
//
// Bez tego każde zdarzenie `input` w polu filtra startowało własny przelot: lista
// brakujących migawek jest liczona w momencie startu, więc trzy znaki wpisane w „Min
// level” ciągnęły ten sam komplet plików trzy razy. Dla gordiona to 5,7 MB zamiast
// 1,9 MB — czyli dokładne zaprzeczenie obietnicy, że transfer kupuje się świadomie.
const inFlight = new Map();

/**
 * Dociąga brakujące migawki świata, `concurrency` naraz. Drugie wywołanie dla tego
 * samego świata dostaje trwający przelot zamiast startować własny.
 *
 * `isStale()` pozwala porzucić robotę, gdy użytkownik zdążył przełączyć świat —
 * bez tego wolniejsza odpowiedź dosypywałaby dane do widoku, którego już nie ma.
 * Migawka, której nie udało się pobrać, ląduje w `failed` i po prostu nie ma jej
 * na wykresie: jedna zepsuta odpowiedź nie może wywalić całej historii.
 */
export function loadHistory(world, entries, options = {}) {
  const running = inFlight.get(world);
  if (running) return running;

  const run = fetchMissing(world, entries, options).finally(() => inFlight.delete(world));
  inFlight.set(world, run);
  return run;
}

async function fetchMissing(world, entries, options) {
  const { concurrency = 4, onProgress = () => {}, isStale = () => false } = options;
  const store = cachedSnapshots(world);
  const missing = entries.filter((e) => !store.has(e.id));
  const failed = [];
  let next = 0;

  const worker = async () => {
    while (next < missing.length) {
      if (isStale()) return;
      const entry = missing[next++];
      try {
        const res = await fetch(entry.filters);
        if (!res.ok) throw new Error(`HTTP ${res.status} dla ${entry.filters}`);
        const json = await res.json();
        if (isStale()) return;
        store.set(entry.id, toTypedSnapshot(json));
      } catch {
        failed.push(entry.id);
      }
      onProgress(loadedCount(store, entries), entries.length, failed.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, worker));
  return { store, failed };
}

/**
 * Historia pod filtrem — ten sam kształt, co wpis świata w `trends.json`.
 *
 * Przy filtrze domyślnym oddaje agregat bez dotykania czegokolwiek: to jest ta ścieżka,
 * za którą nikt niefiltrujący nie płaci ani bajtem ponad 9 KB.
 *
 * Przy filtrze ustawionym liczy z wczytanych migawek — i **tylko** z wczytanych.
 * Migawka jeszcze niepobrana nie dostaje punktu; nie wolno jej ani interpolować, ani
 * podstawić pod nią niefiltrowanej liczby z agregatu, bo wykres pokazałby wtedy skok,
 * którego w danych nie ma.
 *
 * `population` to zawsze **niefiltrowana** populacja tych samych migawek — mianownik
 * dla trybu „udział”. Udział liczony względem przefiltrowanego zbioru sumowałby się
 * do 100% i nie mówiłby nic.
 *
 * `allowed` zawęża wynik do okna migawek (`windowedEntries`). Przy filtrze domyślnym
 * nie obowiązuje: agregat i tak jest już pobrany, więc ucinanie go niczego nie oszczędza.
 *
 * @param {Set<string>|null} [allowed]
 */
export function buildFilteredTrend(base, store, filters, allowed = null) {
  if (isDefaultFilters(filters)) {
    return { trend: base, population: base.total, loaded: base.id.length, expected: base.id.length };
  }

  const trend = {
    id: [],
    startedAt: [],
    total: [],
    act: [[], [], [], [], []],
    byProf: [[], [], [], [], [], []],
    suspect: [],
  };
  const population = [];

  let expected = 0;
  for (let i = 0; i < base.id.length; i++) {
    if (allowed && !allowed.has(base.id[i])) continue;
    expected += 1;

    const snapshot = store.get(base.id[i]);
    if (!snapshot) continue;

    const s = summarizeFiltered(snapshot, filters);
    trend.id.push(base.id[i]);
    trend.startedAt.push(base.startedAt[i]);
    trend.suspect.push(base.suspect[i]);
    trend.total.push(s.total);
    for (let b = 0; b < 5; b++) trend.act[b].push(s.act[b]);
    for (let p = 0; p < 6; p++) trend.byProf[p].push(s.byProf[p]);
    population.push(base.total[i]);
  }

  return { trend, population, loaded: trend.id.length, expected };
}
