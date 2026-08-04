// Wspólne słownictwo całego frontu: stałe, czas i koszykowanie aktywności.
//
// Ten moduł nie może dotykać DOM-u ani niczego uruchamiać przy imporcie — importują
// go moduły czyste (`filters.js`, `history.js`) i warstwa widoku (`app.js`), a widok
// startuje sam po załadowaniu. Gdyby cokolwiek tutaj sięgnęło po `document`, testy
// modułów czystych przestałyby się dać uruchomić poza przeglądarką. Pilnuje tego test.

export const PROF = {
  1: "Wojownik",
  2: "Mag",
  3: "Paladyn",
  4: "Tropiciel",
  5: "Tancerz ostrzy",
  6: "Łowca",
};

// Paleta serii margometera (walidowana pod kontrast/CVD na ciemnym tle).
export const PROF_COLORS = {
  1: "#3987e5", // Wojownik — niebieski
  2: "#d55181", // Mag — magenta
  3: "#199e70", // Paladyn — akwamaryna
  4: "#c98500", // Tropiciel — żółty
  5: "#9085e9", // Tancerz ostrzy — fioletowy
  6: "#e66767", // Łowca — czerwony
};

/**
 * Konto nigdy nieużywane — ranking pokazuje dla niego datę z 1969 r.
 *
 * Surowy `.f.json` zapisuje taki wiersz jako `null`, ale tablice typowane nie umieją
 * `null`-a, więc po konwersji w `history.js` jest to **−1**. Oba zapisy znaczą to samo
 * i muszą wypadać z każdego progu aktywności.
 *
 * **To sprawdzenie musi iść przed porównaniem `days > maxDays`.** `−1 > cokolwiek`
 * jest fałszem, więc filtr, który zapyta najpierw o próg, wpuści konta nigdy nieużywane
 * do *każdego* progu aktywności — dokładnie odwrotnie, niż wynika z danych.
 */
export function isNeverOnline(days) {
  return days === null || days === undefined || days < 0;
}

/**
 * Koszyk aktywności: 0 = <24h, 1 = 1-7 dni, 2 = 8-30 dni, 3 = >30 dni, 4 = nigdy.
 * Koszyki są **rozłączne**, nie skumulowane — skumulowane progi mieszkają
 * w `ACTIVITY_THRESHOLDS` w `history.js` i to są dwie różne skale.
 *
 * Ta sama funkcja co `activityBucket` w `src/trends.ts`, z jedną różnicą: tamta nie
 * zna wartownika −1, bo po stronie serwera nie ma tablic typowanych i nie ma go skąd
 * dostać. Na wartościach, które scraper potrafi wyprodukować, obie muszą dawać to
 * samo — rozjazd dałby historię niezgodną z przekrojem. Pilnuje tego test.
 */
export function activityBucket(days) {
  if (isNeverOnline(days)) return 4;
  if (days === 0) return 0;
  if (days <= 7) return 1;
  if (days <= 30) return 2;
  return 3;
}

export function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Data migawki w czasie lokalnym przeglądarki, liczona z `startedAt`.
 *
 * Identyfikator migawki (trzon nazwy pliku) NIE nadaje się na datę: do lipca 2026
 * powstawał z czasu lokalnego scrapera, później z UTC, więc dwie migawki obok siebie
 * pokazywałyby dwa różne zegary. Gdy `startedAt` brakuje, wracamy do identyfikatora
 * i mówimy wprost, że to przybliżenie.
 */
export function formatSnapshotDate(entry) {
  if (entry?.startedAt) {
    const d = new Date(entry.startedAt);
    if (!Number.isNaN(d.getTime())) {
      const p = (n) => String(n).padStart(2, "0");
      return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
  }

  const m = String(entry?.id ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]} (?)` : String(entry?.id ?? "—");
}

/** Podpis podziałki osi czasu — `DD.MM` w czasie lokalnym. */
export function shortDate(ms) {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Godzina UTC migawki — jedyne miejsce, gdzie świadomie pokazujemy czas nie-lokalny.
 * To ona tłumaczy skoki metryki „ostatnio online”: rundy schodzą raz o 4 rano, raz o 21.
 */
export function utcTime(startedAt) {
  const d = new Date(startedAt);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(11, 16);
}

/** Odstęp między migawkami w dniach — liczony wyłącznie z `startedAt`. */
export function daysBetween(a, b) {
  if (!a?.startedAt || !b?.startedAt) return null;
  const diff = new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  return Number.isNaN(diff) ? null : diff / 86_400_000;
}
