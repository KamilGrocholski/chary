# Spec: trendy jednego świata w czasie — 2026-08-04

Projekt zbiera migawki od 2026-04-17 — dziś **202 migawki z 21 światów, 11 rund, 109 dni** —
i nie ma ani jednego widoku, który tę historię pokazuje. To pozycja 3 listy pomysłów
z [`2026-08-01-audit-2.md`](2026-08-01-audit-2.md) i główny zarzut audytu #1: „mimo 9 snapshotów
w czasie nie ma żadnego porównania w czasie — czyli tego, po co zbierane są migawki”.

Zakres v1 jest celowo wąski: **jeden świat, wiele dat**. Sum globalnych i zestawiania światów
ze sobą tu nie ma — powody w sekcji „Czego świadomie nie ma w v1”. Ten dokument jest też
zdarzeniem, na które czekał skasowany `src/aggregate.ts` (commit `3811cea`): agregat wraca
dopiero wtedy, gdy istnieje widok wielu migawek naraz, i w kształcie, którego ten widok naprawdę
potrzebuje. Kodu tu nie ma — zgodnie z zasadą #3 z [`../AGENTS.md`](../AGENTS.md).

---

## Co ma pokazywać

Wybierasz świat, dostajesz jego historię. Trzy wykresy i jedna tabela, wszystko z jednego pliku
i wszystko o tym jednym świecie.

1. **Populacja w czasie** — linia, oś X to rzeczywisty `startedAt`. Odpowiada na „czy ten świat
   się wyludnia”. Dane już to pokazują: `fobos` 25 037 → 23 719 (**−5,3%**) w 109 dni, `hutena`
   −3,2%, przy `classic` +0,6%.
2. **Aktywni w czasie** — ta sama oś, przełącznik progu `<24h / ≤7 dni / ≤30 dni`
   (domyślnie **≤7 dni**, powód w pułapkach) oraz *liczba / udział w populacji*. Udział jest tu
   ważniejszy niż liczba: świat może tracić graczy i jednocześnie się zagęszczać.
3. **Profesje w czasie** — sześć linii z `byProf`, przełącznik *liczba / udział*. Odpowiada na
   „czy rozkład profesji dryfuje”, czego pojedyncza migawka pokazać nie może.
4. **Tabela zmian między kolejnymi migawkami** — data, odstęp w dniach, populacja, delta
   bezwzględna i **delta na dobę**. Odstępy wynoszą 3-17 dni, więc bez dzielenia przez czas
   „−120 graczy” z dwóch wierszy znaczy dwie różne rzeczy. To pierwszy konsument `daysBetween`
   (`public/app.js:218`), dziś eksportowanego i otestowanego, ale nieużywanego.

---

## Skąd dane — `public/trends.json`

Jeden plik na całą historię, kolumnowo per świat. Powtarzalne klucze obiektów to połowa
objętości, a Chart.js i tak przyjmuje tablice.

```json
{ "schema": 1, "builtAt": "2026-08-04T…",
  "worlds": { "aether": {
    "id":        ["2026-04-17T16-41-43", …, "2026-08-04T09-28-31"],
    "startedAt": ["2026-04-17T14:41:43.303Z", …, "2026-08-04T09:28:31.682Z"],
    "total":     [39849, 39648, 39521, 39454, 39445, 39435, 39287, 38976, 39037, 38909],
    "act":       [[3253, …, 5139], [4390, …, 3128], [3310, …, 3238],
                  [28858, …, 27264], [38, 51, 55, 71, 98, 112, 116, 122, 139, 140]],
    "byProf":    [[10824, …], [8771, …], [6484, …], [4957, …], [3457, …], [5356, …]],
    "suspect":   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } } }
```

`act` w kolejności `[<24h, ≤7 dni, ≤30 dni, >30 dni, nigdy]` — koszyki są **rozłączne**, tak jak
w `activityBucket` (`public/app.js:64`), więc „aktywni ≤7 dni” to suma dwóch pierwszych. `byProf`
w kolejności profesji 1-6. Wiersz *i* każdej kolumny to ta sama migawka — dokładnie ta sama
konwencja, co para `.f.json`/`.n.json`.

Struktura jest zawężona zakresem widoku, ale nie zamyka drogi dalej: sumy globalne i zestawienia
światów liczy się z tego samego pliku, bez regeneracji czegokolwiek.

**Jeden plik, nie plik per świat.** Całość to 23,9 KB surowo / **9,0 KB po gzipie**; slice jednego
świata to ~0,6 KB gzip, ale 21 osobnych plików waży razem 11,9 KB, bo każdy płaci własny nagłówek
kompresji. Przy 9 KB na komplet przełączenie świata ma być natychmiastowe, bez kolejnego fetcha.

## Czy to za dużo danych? Nie, i to o trzy rzędy wielkości

Gdyby widok pobierał `.f.json` dla każdej daty, historia jednego gordiona to 1,8 MB po gzipie
i 800 tys. wierszy do sparsowania przy każdym wejściu; całość to **64,0 MB surowo / 14,9 MB po
gzipie** i 5 579 205 rekordów. Agregat to 9,0 KB na wszystkie 202 migawki — jeden fetch,
**~1 700× mniej transferu**, ~121 B na migawkę.

Rozważane warianty (całe 202 migawki, `JSON.stringify` bez wcięć):

| wariant | surowo | gzip |
|---|---|---|
| tylko `total` + aktywność [5] | 13,4 KB | 4,9 KB |
| **wybrany: + profesje [6], `id`, `suspect`** | **23,9 KB** | **9,0 KB** |
| + kwantyle poziomu (p50/p90/p99/max) | 22,3 KB | 8,6 KB |
| + aktywność × profesja [30] | 42,1 KB | 17,5 KB |
| + pełny histogram poziom × profesja | 1 655 KB | 382 KB |

Wobec budżetu z [`2026-08-01-size-budget.md`](2026-08-01-size-budget.md): `public/` ma
137 MB z limitu 1 GB, runda scrapa dokłada ~13,9 MB, zapasu jest ~65 rund. `trends.json` dokłada
**~2,5 KB na rundę** (21 × 121 B) i po wyczerpaniu całego zapasu miałby ~190 KB. To 0,02%
przyrostu rundy. Rozmiar nie jest w tej decyzji argumentem po żadnej ze stron.

Ostatni wiersz tabeli to powód, dla którego histogramu poziomów w czasie tu nie ma: 43× więcej,
wymusza podział na plik per świat i odpowiada na inne pytanie.

## Kto to buduje

Nowy `src/trends.ts`, czysta funkcja nad typem `FilterFile` z `src/snapshot.ts` — kształt jak
skasowany `buildAggregate` (`git show 3811cea^:src/aggregate.ts`), ale bez `levels` i bez
`HONOR_BUCKETS`, których ten widok nie czyta. Wołana z `src/rebuild_data.ts` i na końcu rundy
scrapa obok `rebuildManifest()` (`src/world_scraper.ts`).

Pełen skan 202 plików z liczeniem koszyków trwa **0,9 s** w Bunie — osobne przejście niż
manifest, mimo że `rebuildManifest()` parsuje te same 64 MB, żeby wyciągnąć `startedAt`
(`src/manifest.ts:31-80`). Oszczędność byłaby warta 0,9 s przy rundzie trwającej ~1,6 h, a ceną
byłoby zszycie dwóch modułów tak, że trendów nie da się odbudować bez manifestu i odwrotnie.
Plik przebudowujemy w całości: to tańsze niż pilnowanie spójności inkrementu.

Migawka bez `startedAt` jest pomijana — nie ma jej gdzie postawić na osi czasu — a ile ich
wypadło, wypisuje `bun run rebuild`. Po cichu gubić danych nie wolno.

## Gdzie żyje widok

Osobna strona `public/trends.html` + `public/trends.js`, link w nagłówku obu stron: zero ryzyka
regresji dla działającego dashboardu, osobny stan URL, osobny plik testowy. Kosztem jest
duplikacja CSS między stronami.

Wspólne kawałki (`PROF`, `PROF_COLORS`, `activityBucket`, `capitalize`, `formatSnapshotDate`,
`daysBetween`) wychodzą z `app.js` do nowego `public/shared.js`. To musi być osobny moduł, a nie
import z `app.js`: `app.js` startuje `setupDashboard()` od razu po załadowaniu, więc pożyczenie
z niego jednej funkcji wywaliłoby trends.html na brakującym `#profCheckboxes`. Pilnuje tego test.
`index.html` dostaje tylko link w nagłówku; reszta dashboardu bez zmian.

Chart.js jest już wendorowany lokalnie i typ `line` starcza na wszystkie trzy wykresy, ale **oś X
nie może być skalą czasu** — ta wymaga adaptera dat, którego nie wendorujemy, a dokładanie drugiej
zależności frontowej dla trzech wykresów się nie opłaca. Zamiast tego skala liniowa w
milisekundach epoki, z podziałkami postawionymi dokładnie w migawkach: odstępy 3-17 dni wychodzą
proporcjonalnie, a podpisy formatujemy sami.

---

## Pułapki

**„Online <24h” mierzy godzinę scrapa, nie grę.** Rundy startowały o 04Z, 06Z, 09Z, 10Z, 14Z,
15Z, 20Z i 21Z, w różne dni tygodnia, a jedna runda trwa ~1,9 h, więc nawet światy w tej samej
rundzie są próbkowane o różnych porach. Efekt na 20 stałych światach przez 10 rund:

| metryka | zmienność (CV) |
|---|---|
| populacja | **0,6%** |
| aktywni ≤30 dni | 3,4% |
| aktywni ≤7 dni | 8,1% |
| online <24h | **14,7%** |

Rozstrzygnięcie: pokazujemy wszystkie trzy progi, domyślnie ≤7 dni, w tooltipie godzina UTC
migawki, nad wykresem jedno zdanie ostrzeżenia. Ukrywanie <24h byłoby ukrywaniem danych.

**Odstępy migawek są nierówne — 3-17 dni.** Oś X musi być czasem ciągłym z `startedAt`, nigdy
indeksem migawki, a każda delta między sąsiednimi punktami wymaga podzielenia przez
`daysBetween`, inaczej porównuje przyrost z trzech dni z przyrostem z siedemnastu.

**`id` migawki nie jest datą.** W przykładzie wyżej `2026-04-17T16-41-43` odpowiada
`2026-04-17T14:41:43.303Z` — pliki sprzed sierpnia 2026 mają w nazwie czas lokalny, nowsze UTC.
Na styku formatów wykres dostałby błąd 2 h. Jedynym źródłem czasu jest `startedAt`.

**Nie każdy świat ma tę samą liczbę punktów.** `brutal` ma 11 migawek (dodatkowy strzał
2026-08-01), pozostałe 10, `luvia` 1. Widok jednego świata musi znieść serię jednopunktową:
jeden punkt to poprawny stan, nie błąd — pokazać punkt i komunikat, że na trend za wcześnie.

**`suspect` musi być widoczny na wykresie.** Dziś takich migawek jest 0, ale strażnik zapisuje
obciętą rundę zamiast ją odrzucać, a spadek populacji > 5% jest z wykresu nieodróżnialny od
prawdziwego spadku. Punkt z `suspect` rysować pustym znacznikiem.

**`days === null` to konto nigdy nieużywane, nie nieaktywne.** Osobny koszyk „nigdy”, nigdy
w mianowniku „aktywnych”. W aetherze rośnie 38 → 140 w 109 dni, więc sam w sobie jest sygnałem
o nowych rejestracjach.

**Szew `charId` tego widoku nie dotyczy.** Agregaty liczą populację, nie śledzą osób. Problem
z audytu #2 („nick nie jest stabilny, `charId` mają dopiero migawki od sierpnia 2026”) obciąża
pomysł progresji gracza, nie ten spec.

---

## Wady i zalety

**Za:** cała historia w jednym fetchu 9,0 KB, więc przełączanie świata i progu jest natychmiastowe;
dane już leżą, nic nie trzeba doscrapować; działający dashboard pozostaje nietknięty; `daysBetween`
dostaje wreszcie konsumenta; format nie zamyka drogi do widoków porównawczych.

**Przeciw:** nowy artefakt do utrzymania w dwóch miejscach (scrape i rebuild); format zamrożony na
`schema: 1`, a jego rozszerzenie wymaga regeneracji (tania — 0,9 s); duplikacja CSS między
`index.html` a `trends.html`; i rzecz najważniejsza — **10-11 punktów na osi czasu to za mało na
wnioski o sezonowości**. Widok pokaże trend populacji wiarygodnie, a wahania aktywności głównie
udokumentuje, zamiast je wyjaśnić.

## Czego świadomie nie ma w v1

**Sum globalnych i zestawiania światów ze sobą.** Nie dlatego, że brakuje danych — `trends.json`
ma wszystko — tylko dlatego, że oba wymagają decyzji, których ten widok nie potrzebuje.
Suma globalna wywraca się na zmiennym zestawie światów: `luvia` istnieje tylko w ostatniej rundzie
i ma 41,3% online (16 134 z 39 087), więc wrzucona do sumy produkuje skok o 16 tys. z niczego —
trzeba świadomie wybrać przecięcie światów i osobno rysować dołączające. Zestawienie światów
z kolei wymaga normalizacji, bo gordion (79 528) spłaszcza brutala (7 751) do linii przy zerze.
Jedno i drugie na osobny obieg, gdy widok jednego świata się obroni.

Poza tym: histogram poziomów w czasie (382 KB gzip, plik per świat), progresja pojedynczego gracza
(`.n.json` + szew `charId`), top-N zmian między migawkami, honor w agregacie.
