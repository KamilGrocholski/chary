// Kawałki wspólne dla dashboardu migawki (app.js) i widoku trendów (trends.js).
//
// Ten moduł nie może dotykać DOM-u ani niczego uruchamiać przy imporcie: app.js
// startuje `setupDashboard()` od razu po załadowaniu i wywaliłby się na brakujących
// elementach, gdyby trends.js zaimportował go tylko po to, żeby pożyczyć funkcję.

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
 * Koszyk aktywności: 0 = <24h, 1 = 1-7 dni, 2 = 8-30 dni, 3 = >30 dni, 4 = nigdy.
 * Koszyki są rozłączne, nie skumulowane. Ta sama funkcja co `activityBucket`
 * w `src/trends.ts` — rozjazd dałby wykres trendów niezgodny z dashboardem migawki,
 * więc pilnuje tego test.
 */
export function activityBucket(days) {
  if (days === null || days === undefined) return 4;
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

/** Odstęp między migawkami w dniach — liczony wyłącznie z `startedAt`. */
export function daysBetween(a, b) {
  if (!a?.startedAt || !b?.startedAt) return null;
  const diff = new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  return Number.isNaN(diff) ? null : diff / 86_400_000;
}
