# Spec: jeden widok świata z filtrowaniem historii — 2026-08-04

Po [`2026-08-04-spec-trends.md`](2026-08-04-spec-trends.md) projekt ma dwa widoki, które nie
umieją tego samego. `index.html` filtruje dokładnie — poziom, honor, profesja, aktywność — ale
tylko w obrębie **jednej migawki**. `trends.html` pokazuje **całą historię**, ale wyłącznie sumy
globalne, bez jednego filtra.

Pytania, po które te dane są zbierane, leżą dokładnie na przecięciu: *czy paladynów 250+ z honorem
powyżej 10 tys. ubywa, czy przybywa?* Dziś nie da się o to zapytać w żadnym z dwóch widoków,
mimo że dane leżą na dysku od kwietnia.

Ten dokument rozstrzyga dwie rzeczy naraz, bo są tą samą rzeczą: **czy historię da się filtrować
po stronie klienta** (da się, i to z zapasem trzech rzędów wielkości nad tym, co potrzebne) i
**czy dwa widoki mają zostać dwoma** (nie mają). Kodu tu nie ma — zgodnie z zasadą #3
z [`../AGENTS.md`](../AGENTS.md).

---

## Co ma pokazywać

Świat i filtr wybierasz **raz, na górze**. Wszystko niżej odpowiada na to samo pytanie, tyle że
w dwóch skalach czasu.

```
┌─────────────────────────────────────────────┐
│ Świat: [gordion ▾]              [⎘ kopiuj]  │
│ Poziom [250]–[400]  Honor [1000]–[    ]     │
│ Online [≤ 7 dni ▾]  ☑Woj ☐Mag ☑Pal ☐Tro ... │
│                                   [Wyczyść] │
├─────────────────────────────────────────────┤
│ Pasuje: 1 749 z 79 528  (2,2%)              │
├── PRZEKRÓJ ── migawka: [04.08.2026 ▾] ──────┤
│ ▇▇▆▅▃▂▁  Level wg profesji                  │
├── HISTORIA ── 10 migawek, 109 dni ──────────┤
│ ╲___╱‾╲  Pasujących w czasie                │
│ ╲╲__╱‾╲  Aktywnych ≤7 dni                   │
│ ══════╲  Profesje                           │
│ [tabela zmian: data · odstęp · Δ · Δ/dobę]  │
└─────────────────────────────────────────────┘
```

1. **Pasek trafień** — `Pasuje: N z M (x%)`. Mianownik `M` bierze się z `trends.json`, więc
   pojawia się natychmiast, zanim cokolwiek dużego zostanie pobrane.
2. **Przekrój** — histogram poziom × profesja dla wybranej migawki. To dzisiejszy dashboard,
   bez zmiany zachowania.
3. **Historia** — dzisiejsze trzy wykresy i tabela zmian, **ale liczone pod filtrem**.
   „Populacja w czasie” staje się „pasujących w czasie” i to jest cała nowa wartość tego widoku.

Filtr rządzi obiema sekcjami jednocześnie. To jedyny powód, dla którego warto je scalić —
sam układ obok siebie nie byłby wart ryzyka.

---

## Czy da się filtrować historię po stronie klienta? Da się, i to z zapasem

Zmierzone na prawdziwych danych, nie oszacowane. Gordion, największy świat, 10 migawek:

| | |
|---|---|
| historia `.f.json` | 9,1 MB surowo / **1,86 MB po gzipie** |
| wierszy | 813 542 |
| `JSON.parse` całości | 81 ms |
| konwersja do tablic typowanych | 38 ms |
| w pamięci po konwersji | 7,3 MB |
| **pełny przelot filtra po całej historii** | **2,8–7,0 ms** |

Dla porównania: `brutal` to 0,22 MB gzip, cała runda 21 światów 1,51 MB gzip, a wszystkie
202 migawki 14,9 MB gzip — i to ostatnie jest powodem, dla którego osią tego widoku jest
**jeden świat**, a nie „wszystko naraz”.

Liczba, która rozstrzyga: **przemielenie 813 tys. wierszy przez pełny filtr trwa krócej niż
jedna klatka.** Filtrowanie nie jest tu problemem do rozwiązania, tylko rzeczą, która po prostu
działa. Debounce 150 ms z `public/app.js:396` zostaje bez zmian i nadal jest z ogromnym zapasem.

**Odrzucone: prekompilowany agregat wielowymiarowy („cube”).** Naturalny odruch to policzyć
w `src/trends.ts` koszyki poziom × profesja × aktywność i wysyłać je zamiast surowych migawek.
Cena jest potrójna i żaden składnik nie jest do przyjęcia: koszykowanie zamienia **dokładny**
filtr na przybliżony na krawędziach koszyków; **honor nie wchodzi** do cube'a w żadnym sensownym
rozmiarze (zakres −35 .. 1 224 565); a plik z samym histogramem poziom × profesja to 382 KB gzip
(tabela wariantów w speci trendów) — czyli 40× więcej niż `trends.json` po to, żeby dostać gorszą
odpowiedź niż 7 ms pracy procesora. Cube nie ma tu żadnego argumentu poza przyzwyczajeniem.

To zamyka też ostatni wiersz tabeli wariantów ze speci trendów na dobre: histogram poziomów
w agregacie jest już nie „za drogi”, tylko **zbędny** — klient policzy go dokładnie i dla każdej
migawki, nie tylko dla wybranych.

### Dlaczego to nie przeczy speci trendów

Spec trendów policzyła, że agregat to **~1 700× mniej transferu** niż surowe `.f.json`, i to
nadal jest prawda. Ta spec jej nie odwraca, tylko dokłada drugą ścieżkę obok:

| ścieżka | co pobiera | kiedy |
|---|---|---|
| **domyślna** | `manifest.json` + `trends.json` + jedna migawka | zawsze — tyle samo co dziś |
| **dokładna** | historia `.f.json` jednego świata | dopiero po ruszeniu filtra |

`trends.json` zostaje jedynym źródłem dla wejścia bez filtra i mianownikiem paska trafień.
Kto tylko rzuci okiem na wykres populacji, płaci 9 KB — dokładnie jak dziś. Argument
o 1 700× dotyczy ścieżki domyślnej i pozostaje w mocy; ścieżka dokładna to świadomy zakup
za 0,2-1,9 MB, robiony na wyraźny ruch użytkownika i tylko dla jednego świata.

### Skutek dla limitu GitHub Pages: zerowy

Ten widok **nie dokłada ani jednego bajtu do publikowanych danych** — czyta pliki, które już
tam leżą, dziś pobierane po jednym. Budżet z
[`2026-08-01-size-budget.md`](2026-08-01-size-budget.md) nie drgnie: `public/` ma
**142,6 MB** z twardego limitu 1 GB, runda dokłada ~13,6 MB, zapasu jest **~63 rundy ≈ 2 lata**.

Jedyny nowy koszt to **transfer**, a nie miejsce. Przy soft-limicie 100 GB/miesiąc na Pages
i najgorszym przypadku 1,86 MB na filtrujące wejście daje to ~54 tys. takich wejść miesięcznie.
Dla tego projektu to nie jest ograniczenie.

---

## Warstwa danych

Rdzeń jest jednozdaniowy: **klient buduje obiekt o dokładnie tym samym kształcie, co wiersz
`trends.json`, tylko przefiltrowany.**

```
summarizeFiltered(migawka, filtr) -> { total, act[5], byProf[6] }
```

Dzięki temu `activeCounts`, `shareSeries`, `changeRows`, `summarize` i cały `renderCharts`
z `public/trends.js` działają **bez jednej zmiany** — dostają tylko inne liczby. Nowego kodu
rysującego nie ma wcale.

Że to naprawdę ten sam kształt, jest zmierzone, nie założone: policzenie `{total, act, byProf}`
prosto z surowych `.f.json` dla **wszystkich 202 migawek** i porównanie z opublikowanym
`trends.json` dało **0 rozjazdów**. To jest gotowy test i musi nim zostać — filtr domyślny
liczony u klienta ma dawać co do liczby to samo, co `src/trends.ts` policzył na serwerze.
Test porównuje wtedy dwie niezależne implementacje wobec tych samych surowych danych, a nie
reimplementację samej siebie (zasada #6).

Jeden przelot, nie dwa. Dzisiejsze `countByLevel` i `countByActivity` (`public/app.js:78` i `:94`)
przechodzą po tablicy osobno; dla historii to 2N przejść zamiast N. `summarizeFiltered` liczy
`total`, `act` i `byProf` w jednym `for`. Histogram poziomów zostaje osobno, bo potrzebuje go
tylko wybrana migawka.

**Tablice typowane, nie `number[]`.** Zmierzone zakresy na wszystkich 5 579 205 wierszach:

| kolumna | zakres | typ | B/wiersz |
|---|---|---|---|
| `level` | 1 .. 500 | `Int16Array` | 2 |
| `profession` | 1 .. 6 | `Uint8Array` | 1 |
| `honor` | **−35 .. 1 224 565** | `Int32Array` | 4 |
| `days` | 0 .. 6598, plus 11 095 `null` | `Int32Array`, `null` → **−1** | 4 |

Razem 11 B/wiersz, czyli **8,9 MB dla całego gordiona** wobec kilkukrotnie większego narzutu
zwykłych tablic JS. Konwersja odbywa się raz, zaraz po pobraniu, a sparsowany JSON idzie od razu
do śmieci — plik po pliku, żeby szczyt pamięci był jednym plikiem, nie dziesięcioma.

`days` w 32 bitach, choć zmierzone maksimum (6598) mieści się w 16 z zapasem: przepełnienie
zawinęłoby się na liczbę **ujemną**, czyli po cichu przerobiło gracza sprzed lat na konto nigdy
nieużywane. Dwa bajty na wiersz to tania cena za wykluczenie całej klasy błędu.

Cache trzymamy **w pamięci, per świat**. Nie w `sessionStorage`: 9 MB nie mieści się w limicie
i tak, a serializacja z powrotem do stringa kosztowałaby więcej niż ponowny fetch z cache'a HTTP.

## Strategia pobierania: leniwa, na pierwszy ruch filtra

Wejście na stronę kosztuje **dokładnie tyle co dziś**: `manifest.json`, `trends.json` i jedna
migawka na przekrój. Historia rysuje się natychmiast z agregatu.

Pierwsza zmiana dowolnego filtra startuje pobieranie reszty migawek tego świata w tle. Wykresy
historii dopełniają się punkt po punkcie, z widocznym postępem. Kto nie filtruje, nie płaci nic —
ta sama logika, którą spec trendów uzasadniła wyniesienie `trends.json` poza manifest
(„9 KB dokładane wszystkim to koszt bez pokrycia”).

**Odrzucone: pobieranie w tle od razu po wejściu.** Filtry działałyby bez czekania, ale każde
wejście na gordiona kosztowałoby 1,86 MB, także kogoś, kto przyszedł zobaczyć jeden histogram.
**Odrzucone: przycisk „policz dokładnie (1,9 MB)”.** Najuczciwsze wobec transferu, ale filtr,
który nie rusza wykresów, dopóki nie klikniesz drugiej rzeczy, jest po prostu zepsuty.

---

## Co się zmienia w kodzie

- **`public/shared.js`** przejmuje rdzeń filtrów z `app.js`: `emptyFilters`, `ACTIVITY_BOUNDS`,
  `activityLabel`, `visibleActivityBuckets`, `filtersToParams`, `filtersFromParams`, dzisiaj
  prywatną `matches` (`public/app.js:61`) i nową `summarizeFiltered`. Kontrakt tego modułu
  zostaje bez zmian — zero DOM-u, nic nie startuje przy imporcie — i nadal pilnuje go test
  (`test/trends.test.ts:386-394`).
- **Loader historii**, nowy moduł. Bierze listę migawek świata z manifestu, pobiera je
  z ograniczoną współbieżnością, konwertuje do tablic typowanych, cache'uje per świat i raportuje
  postęp. Musi być czysty, żeby dał się przetestować bez przeglądarki.
- **`public/index.html` + `public/app.js`** stają się widokiem scalonym; sekcja historii
  przenosi się z `trends.js`. Reużyte bez przepisywania: `countByLevel`, `totalsFromCounts`,
  `renderChart`, `renderTooltip` po stronie przekroju oraz `activeCounts`, `changeRows`,
  `summarize`, `pointStyle`, `chartOptions` po stronie historii.
- **`public/trends.html`** zostaje jako przekierowanie zachowujące query string. Zestawy
  parametrów obu stron nie kolidują — `minLevel/maxLevel/minHonor/maxHonor/maxDays/prof/world/date`
  wobec `world/prog/udzial` — więc jedna strona czyta oba i **wszystkie rozesłane dotąd linki
  działają dalej**.
- **Testy**: `test/dashboard.test.ts` i `test/trends.test.ts` dzielą się wzdłuż nowej granicy,
  a `test/dom_smoke.ts` dostaje nowy układ kontrolek.

Znika duplikacja CSS między `index.html` a `trends.html` — wada wpisana wprost do sekcji
„Przeciw” speci trendów.

---

## Pułapki

**Wartownik `−1` za `days === null` to gotowy błąd, i to odwracający znaczenie danych.**
Po konwersji do `Int16Array` `null` musi się czymś stać, a warunek `days > maxDays` jest dla `−1`
**fałszywy** — czyli naiwny filtr wpuściłby konta nigdy nieużywane do każdego progu aktywności,
dokładnie odwrotnie niż robi to dziś `public/app.js:71`. Sprawdzenie `days < 0` musi być pierwsze,
a nie dopisane później.

**Filtr aktywności zjada wykres aktywności.** Gdy użytkownik ustawi „online ≤ 7 dni”, seria
„aktywni ≤ 7 dni” na wykresie historii z definicji zrówna się z serią „pasujących”, a próg
„≤ 30 dni” też — bo nikt poza progiem filtra do zbioru nie wchodzi. To nie jest błąd danych,
tylko pytanie zadane dwa razy. Widok musi to nazwać: przy aktywnym filtrze `maxDays` progi
wyższe od niego są martwe i mają być wyłączone albo opisane, nigdy narysowane jako trzy linie
jedna na drugiej, które wyglądają jak potwierdzenie czegokolwiek.

**Dwie skale aktywności spotykają się w jednym pliku.** `ACTIVITY_BOUNDS` w `app.js` jest
**rozłączne**, `ACTIVITY_THRESHOLDS` w `trends.js` **skumulowane**. Dziś dzieli je granica
plików; po scaleniu będą obok siebie w jednym module. `AGENTS.md` ostrzega przed pomyleniem
ich wprost, bo kosztuje to cały koszyk „< 24h” — trzeba nazwać, które pole rządzi którym wykresem,
i zostawić to w komentarzu, nie w pamięci autora.

**„Udział” potrzebuje jawnego mianownika.** Przy filtrze udział profesji może znaczyć dwie
rzeczy: część **przefiltrowanego** zbioru (sumuje się do 100% i jest bez treści, bo profesje
też są filtrem) albo część **populacji świata** w tej migawce. Drugie. Mianownikiem zostaje
`total` z `trends.json`, ten sam, który stoi w pasku trafień.

**Progresywne dopełnianie nie może kłamać.** Dopóki historia się ładuje, filtrowana seria jest
rysowana **wyłącznie po wczytanych migawkach**. Niewczytana migawka to brak punktu — nigdy
interpolacja i nigdy podstawienie niefiltrowanej wartości z `trends.json`, bo wykres pokazałby
wtedy skok, którego nie ma w danych.

**Zero trafień to wynik, nie awaria.** Wąski filtr da 0 w części migawek. Wykres historii ma
w tym miejscu narysować zero, a nie dziurę ani komunikat o błędzie — dziura sugeruje brakującą
migawkę, czyli coś, co w tych danych naprawdę się zdarza i musi zostać rozróżnialne.

**`honor` bywa ujemny** — zmierzone minimum to −35 na 5 579 205 wierszy. Żadnego `Math.max(0, …)`
przy budowaniu pól ani przy walidacji zakresu.

**`suspect` musi przeżyć scalenie w obu postaciach.** Pusty znacznik na wykresach historii
i pasek ostrzeżenia nad przekrojem to dwa różne mechanizmy dla tej samej flagi i po scaleniu
łatwo zgubić jeden z nich.

**Odstępy 3-17 dni i `id`, które nie jest datą** — obie pułapki ze speci trendów obowiązują
bez zmian. Każda delta dzielona przez `daysBetween`, jedynym źródłem czasu jest `startedAt`.

Testy, które zmiana przewróci i które **muszą zostać, a nie zniknąć**:
`test/trends.test.ts:317-322` wymaga dziś, żeby widok historii pobierał wyłącznie `trends.json` —
ma dopuścić `manifest.json` i ścieżki `worlds/…/*.f.json`, ale nadal pilnować braku zewnętrznych
zależności. `test/dom_smoke.ts` buduje węzły regexem po `id="…"` i zakłada, że pierwszy listener
na `#worldSelect` to `render`; każde `el("…")` musi zostać literałem, inaczej test spójności
z HTML-em przestaje czegokolwiek pilnować.

Przy okazji, znalezione przy czytaniu kodu pod ten dokument: `#popChart` nigdy nie reaguje na tryb
„udział” (`public/trends.js:222-235`), choć pod filtrem udział pasujących w populacji jest
sensowną metryką; koszyki `> 30 dni` i `nigdy` są w `trends.json`, ale nie pokazuje ich żaden
wykres, mimo że spec trendów traktuje wzrost 38 → 140 w aetherze jako sygnał; `entryAt`
(`public/trends.js:186-191`) jest O(n) i alokuje `snapshotEntries` przy każdym wywołaniu, dwa razy
na tooltip; formatowanie dat siedzi w `trends.js` w trzech miejscach.

---

## Wzrost w czasie i próg bezpieczeństwa

Historia rośnie liniowo: **~185 KB gzip na każdą kolejną migawkę gordiona**. Dziś 1,86 MB,
ale to nie zostanie dzisiejsze.

| migawek | historia gordiona (gzip) | wierszy | przelot filtra |
|---|---|---|---|
| 10 (dziś) | 1,86 MB | 0,81 mln | 2,8-7,0 ms |
| **16 (za ~6 rund, ~2,5 miesiąca)** | **3,0 MB** | 1,3 mln | ~11 ms |
| 73 (po wyczerpaniu zapasu Pages) | 13,5 MB | 5,9 mln | ~51 ms |

Ograniczeniem jest **transfer, nie procesor** — nawet skrajne 5,9 mln wierszy mieści się
w debounce 150 ms z ogromnym zapasem (wartości dla 16 i 73 migawek są ekstrapolacją
zmierzonego 8,6 ns/wiersz, nie pomiarem).

Rozstrzygnięcie: **okno domyślne — ostatnie N migawek** (`HISTORY_WINDOW = 12`) i licznik
„N z M migawek” widoczny zawsze, bo służy też za pasek postępu pobierania. Ucinanie zakresu bez
powiedzenia tego wprost czyta się jak komplet danych i jest gorsze niż brak funkcji.

Próg 3 MB wypada za około sześć rund, więc okno nie jest rzeczą „na przyszłość” w rozumieniu
zasady #3 — jest potrzebne w tej samej implementacji, w której powstaje reszta. Przycisku
„wczytaj całą historię” **nie ma**: dziś najdłuższa historia to 11 migawek, więc okno niczego
nie ucina, a kontrolka, która nigdy się nie renderuje, to dokładnie ten martwy kod, za który
ten projekt skasował już moduł i stałą. Wejdzie razem z pierwszym światem, który przekroczy okno.

Interakcja z planem ratunkowym budżetu: krok 2 z
[`2026-08-01-size-budget.md`](2026-08-01-size-budget.md) to gzipowanie `.f.json`
w repo z ręczną dekompresją przez `DecompressionStream`. Te dwie rzeczy się nie wykluczają —
budżet już zakłada dekompresję po stronie przeglądarki, a loader historii jest jedynym miejscem,
które trzeba by wtedy zmienić.

---

## Wady i zalety

**Za:** pytanie, po które te dane są zbierane, staje się zadawalne — filtr działa na całej historii,
dokładnie, bez koszykowania; nie dokłada ani bajtu do 1 GB na Pages; wejście bez filtra kosztuje
tyle co dziś; znika duplikacja CSS i drugi stan URL; wykresy historii nie wymagają nowego kodu
rysującego, bo dostają ten sam kształt danych co dziś; stare linki działają dalej.

**Przeciw:** to **przepisanie obu działających widoków naraz** — największe ryzyko regresji,
jakie ten projekt dotąd podejmował, obejmujące dwa pliki testowe i atrapę DOM-u, a poprzedni obieg
świadomie wybrał osobną stronę właśnie po to, żeby dashboardu nie ruszać. Dalej: 1,86 MB to
realny koszt na wolnym łączu, choćby leniwy; okno „ostatnich N migawek” dokłada stan, który
trzeba pokazywać i testować; skomplikowanie panelu filtrów uderza też w kogoś, kto przyszedł
po sam histogram. I rzecz najważniejsza — **filtr nie naprawia próbki**. Nadal jest 10-11 punktów
na osi czasu w nierównych odstępach 3-17 dni, więc „paladynów 250+ ubyło o 4%” pozostaje
obserwacją z dziesięciu pomiarów, a nie trendem. Widok pozwoli zadać ostrzejsze pytanie,
ale nie doda mocy statystycznej, której w danych nie ma.

## Czego świadomie nie ma

**Sum globalnych i zestawiania światów ze sobą** — uzasadnienie ze speci trendów zostaje w mocy
w całości (`luvia` istnieje w jednej rundzie i wywraca sumę, gordion spłaszcza brutala bez
normalizacji), a filtrowanie po stronie klienta nic w nim nie zmienia: przy 14,9 MB gzip na
komplet migawek dokładne filtrowanie wielu światów naraz i tak jest poza zasięgiem przeglądarki.
Osią tego widoku jest jeden świat i to nie jest tymczasowe.

**Histogramu poziomów w czasie** jako osobnego wykresu — dane są (klient ma komplet migawek),
ale jedna mapa cieplna poziom × czas to inne pytanie i inny obieg.

**Wyszukiwarki gracza i progresji pojedynczej postaci** — nadal blokowane szwem `charId`
z [`2026-08-01-audit-2.md`](2026-08-01-audit-2.md), a `.n.json` nadal nie ma konsumenta.
Ta spec go nie dostarcza.

**Rozszerzania `trends.json`** — zostaje na `schema: 1`. Wszystko, co widok potrzebuje ponad
agregat, liczy sobie sam z `.f.json`, dokładnie i pod filtrem.
