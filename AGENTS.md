# AGENTS.md — punkt wejścia dla agenta AI

Przeczytaj to najpierw. Jeśli po tym pliku dalej nie wiesz, gdzie czegoś szukać, to jest
błąd tego dokumentu — dopisz brakującą rzecz, zamiast zostawiać następnego z tym samym
pytaniem.

---

## Co to jest

Scraper rankingów [Margonem](https://www.margonem.pl) + statyczny dashboard na GitHub Pages.
Cyklicznie pobiera rankingi graczy ze wszystkich śledzonych światów, zapisuje migawki do
statycznych plików JSON i pozwala je przeglądać oraz filtrować bez żadnego backendu.

- **Live:** https://kamilgrocholski.github.io/chary/
- **Repo:** `git@github.com:KamilGrocholski/chary.git` — uwaga, repozytorium nazywa się
  `chary`, mimo że pakiet i projekt to `margostat`. To nie pomyłka.
- **Źródło danych:** `https://www.margonem.pl/ladder/<świat>/players?page=N`
- **Stan:** 202 migawki z 21 światów, 11 rund od 2026-04-17, ~586 tys. graczy w rundzie,
  `public/` 137 MB.

---

## Gdzie co leży

```
src/
  world_scraper.ts   CLI scrapera: pobieranie, retry, strażnik, zapis, podsumowanie
  parser.ts          parsowanie HTML-a rankingu — czyste funkcje, zero I/O
  snapshot.ts        format migawki: podział .f/.n, migracja starych, strażnik populacji
  manifest.ts        budowa public/manifest.json
  atomic.ts          zapis przez plik tymczasowy + rename — albo w całości, albo wcale
  retry.ts           backoff i Retry-After — czyste, bo world_scraper.ts odpala się przy imporcie
  trends.ts          agregat historii świata → public/trends.json
  rebuild_data.ts    CLI utrzymania danych (migracja + manifest + trendy)
  worlds.ts          lista śledzonych światów — edytowana ręcznie
  server.ts          lokalny serwer statyczny do podglądu
public/              dokładnie to, co ląduje na GitHub Pages
  index.html         markup i style: przyklejony pasek filtrów + przekrój + historia
  app.js             jedyny moduł dotykający DOM-u — orkiestracja i rysowanie
  filters.js         filtr i zliczanie: matches, countByLevel, summarizeFiltered, stan w URL-u
  history.js         historia świata: progi, serie, tablice typowane, pobieranie migawek
  shared.js          stałe, czas, koszykowanie aktywności — wspólne słownictwo
  vendor/            Chart.js 4.4.7 lokalnie, bez CDN-u + LICENSE.chartjs
  trends.html        przekierowanie na index.html z zachowaniem query stringa
  manifest.json      indeks migawek
  trends.json        zwinięta historia wszystkich światów (24 KB, 9 KB po gzipie)
  worlds/<świat>/    <id>.f.json + <id>.n.json
test/
  parser.test.ts     parser na zrzucie prawdziwej strony rankingu
  snapshot.test.ts   format migawki, migracja, strażnik populacji
  dashboard.test.ts  przekrój: filtry, wartownik −1, czas migawki, spójność z index.html, smoke
  trends.test.ts     historia: agregat serwerowy, trends.json, history.js, klient == serwer
  dom_smoke.ts       atrapa DOM-u — dwa scenariusze, odpalane z testów w podprocesie
  fixtures/          zrzut strony rankingu + próbka snapshotu w starym schemacie
docs/                audyty i notatki
.github/workflows/   deploy.yml (check + publikacja), ci.yml (pull requesty)
AGENTS.md            ten plik — instrukcje dla agenta
CLAUDE.md            wskaźnik na AGENTS.md (Claude Code)
LICENSE              MIT — obejmuje TYLKO kod, nie dane
DATA-NOTICE.md       dane rankingu: czyje, czego nie licencjonujemy, RODO, usuwanie
THIRD-PARTY-NOTICES.md  Chart.js, cheerio, drzewo zależności (wszystko permisywne)
```

Kod ma ~4,4 tys. linii łącznie z testami. Da się go przeczytać w całości i **warto** to
zrobić przed większą zmianą — to szybsze niż zgadywanie.

---

## Jak używać

```bash
bun install

bun run scrape:check   # ZAWSZE przed pełnym scrapem — sprawdza parser na stronie 1 każdego świata
bun run scrape         # wszystkie światy z src/worlds.ts (~1,6 h przy 1 req/s)
bun run scrape aether  # jeden świat
bun run scrape aether,tempest 2000   # wybrane światy, własny interwał w ms (min. 250)

bun run serve          # http://localhost:3000 — dashboard lokalnie
bun test               # 184 testy
bun run typecheck
bun run rebuild        # utrzymanie danych: migracja starych schematów + manifest + trendy
```

Deploy dzieje się sam po pushu na `main`, ale dopiero gdy przejdą typecheck i testy.

---

## Format danych — to musisz zrozumieć

Jedna migawka to **dwa pliki o tej samej kolejności wierszy**. Wiersz *i* odpowiada randze
*i+1*, więc ranga nie jest nigdzie zapisana, a oba pliki razem odtwarzają migawkę 1:1
bez dublowania czegokolwiek.

`public/worlds/<świat>/<id>.f.json` — wszystko, czego potrzebuje filtrowanie:

```json
{ "schema": 3, "kind": "filter", "world": "aether", "count": 39037,
  "startedAt": "2026-07-21T20:04:12.489Z",
  "level": [378, 359, ...], "profession": [4, 3, ...],
  "honor": [8749, 4715, ...], "days": [0, 0, 30, null, ...] }
```

`public/worlds/<świat>/<id>.n.json` — tożsamość gracza:

```json
{ "schema": 3, "kind": "names", "count": 39037,
  "name": ["essobe", ...], "charId": [729, ...] }
```

**Pułapki, na które musisz uważać:**

- `days`: `0` = „Mniej niż 24h temu”, `N` = „N dni temu”, **`null` = konto nigdy nieużywane**
  (ranking pokazuje wtedy ~20655 dni, czyli datę z 1969 r.). Konta z `null` wypadają
  z każdego progu aktywności.
- `honor` **bywa ujemny** (najniżej zaobserwowane −35). Żadnych `Math.max(0, …)`.
- **`id` migawki (trzon nazwy pliku) NIE jest datą.** Pliki sprzed sierpnia 2026 mają
  w nazwie czas lokalny, nowsze UTC. Do wyświetlania i liczenia odstępów służy wyłącznie
  `startedAt` z manifestu albo z pliku. To samo dotyczy pola `timestamp` **wewnątrz**
  plików danych — to identyfikator, nie znacznik czasu.
- `charId` mają tylko migawki od sierpnia 2026. Starsze łączy się po nicku, a nick **nie
  jest stabilny** — patrz „szew charId” w audycie #2.
- `suspect` w `.f.json` oznacza migawkę, której populacja spadła > 5% względem poprzedniej.
  Dane są zapisane, ale mogą być obcięte.
- Profesje: 1 Wojownik, 2 Mag, 3 Paladyn, 4 Tropiciel, 5 Tancerz ostrzy, 6 Łowca.

Filtry poziomu, profesji, honoru i aktywności liczą się **dokładnie**, zawsze, z jednego
pliku `.f.json` (20-180 KB po gzipie). Nicki nie są pobierane wcale, dopóki nie powstanie
wyszukiwarka graczy.

### `public/trends.json` — historia, nie migawka

Zwinięta historia wszystkich światów, po jednej liczbie na migawkę zamiast setek tysięcy
wierszy: 24 KB surowo, **9 KB po gzipie na komplet 202 migawek**. To **domyślna** ścieżka
historii — dopóki filtr jest domyślny, widok rysuje wykresy wyłącznie z tego pliku i nie
pobiera ani jednej migawki.

```json
{ "schema": 1, "builtAt": "...", "worlds": { "aether": {
  "id": [...], "startedAt": [...], "total": [39849, ...],
  "act": [[<24h], [1-7 dni], [8-30 dni], [>30 dni], [nigdy]],
  "byProf": [[wojownik], ..., [łowca]], "suspect": [0, ...] } } }
```

Kolumnowo, wiersz *i* każdej kolumny to ta sama migawka — ta sama konwencja, co para
`.f.json`/`.n.json`. **Koszyki `act` są rozłączne**, więc „aktywni ≤7 dni” to suma dwóch
pierwszych; `ACTIVITY_THRESHOLDS` w `history.js` robi to sumowanie i jest jedynym miejscem,
gdzie wolno mieszać te dwie skale. Przebudowywany w całości przez `bun run rebuild` i na
końcu każdej rundy scrapa; migawka bez `startedAt` wypada z niego, bo nie ma jej gdzie
postawić na osi czasu.

Pełne uzasadnienie kształtu i pułapki metryki „ostatnio online”:
[`docs/2026-08-04-spec-trends.md`](docs/2026-08-04-spec-trends.md).

### Historia pod filtrem — druga ścieżka tych samych wykresów

Gdy filtr przestaje być domyślny, agregat przestaje wystarczać: `trends.json` zna tylko sumy
globalne. Widok dociąga wtedy `.f.json` **tego jednego świata** (0,2-1,9 MB po gzipie),
konwertuje je do tablic typowanych i liczy historię sam — dokładnie, bez koszykowania.

Sercem jest `summarizeFiltered` z `filters.js`: zwraca `{ total, act[5], byProf[6] }`, czyli
**dokładnie kształt wiersza `trends.json`**. Dlatego `activeCounts`, `changeRows`, `summarize`
i całe rysowanie nie odróżniają obu ścieżek i nie mają dla nich osobnego kodu. Przy filtrze
domyślnym obie muszą dać co do liczby to samo, co `summarizeSnapshot` z `src/trends.ts` —
sprawdza to test na wszystkich 202 migawkach (~0,9 s).

Pułapki tej ścieżki:

- **`null` w `days` staje się `−1`** — tablice typowane nie umieją `null`-a. `−1 > maxDays`
  jest **fałszem**, więc sprawdzenie `isNeverOnline` musi iść **przed** progiem, inaczej
  konta nigdy nieużywane wpadną do każdego progu aktywności. Jedno miejsce: `shared.js`.
- **Niewczytana migawka nie dostaje punktu.** Żadnej interpolacji, żadnego podstawiania
  niefiltrowanej liczby z agregatu — dziura robi dłuższy odstęp, a `perDay` dzieli przez
  realny czas, więc pozostaje uczciwy.
- **Mianownikiem „udziału” jest populacja niefiltrowana**, nie przefiltrowany zbiór (ten
  sumowałby się do 100%).
- **Filtr aktywności zjada progi szersze od siebie** — przy „≤ 3 dni” próg „≤ 7 dni” liczy
  tych samych graczy, co wykres pasujących. `usableThresholds` je usuwa.
- Pamięć trzyma najwyżej **dwa światy**, a `HISTORY_WINDOW` (12) ogranicza liczbę migawek.
  Dziś okno niczego nie ucina — najdłuższa historia ma 11 migawek.
- **Pobieranie startuje wyłącznie zza debounce'a, i tylko raz na świat.** `loadHistory`
  trzyma mapę `świat → Promise`; wywoływanie go z handlera `input` ciągnęło ten sam
  komplet plików raz na każdy wciśnięty klawisz. Test liczy pobrania per adres.
- **Podmiana `innerHTML` na `<select>` zeruje wybór** — przeglądarka ustawia pierwszą
  opcję, nawet gdy poprzednia wartość nadal jest na liście. Wartość trzeba odczytać
  **przed** podmianą. Atrapa DOM-u robi teraz to samo; wcześniej była łagodniejsza
  i przez to ukrywała ten błąd.

Pomiary, budżet transferu i uzasadnienie scalenia widoków:
[`docs/2026-08-04-spec-world-view.md`](docs/2026-08-04-spec-world-view.md).
Osiem błędów, których nie łapało 165 testów: [`docs/2026-08-04-audit-3.md`](docs/2026-08-04-audit-3.md).

---

## Dlaczego tak, a nie inaczej

Decyzje, które wyglądają dziwnie, dopóki nie znasz powodu:

| Decyzja | Powód |
|---|---|
| Migawka w dwóch plikach | Nicki to ~2/3 objętości, a filtrowaniu są zbędne. Podział ściął `public/` z 620 MB do 118 MB. |
| `trends.json` liczy tylko to, co rysuje widok | Poprzedni moduł agregatów skasowano za pola bez konsumenta. Ten ma populację, aktywność i profesje — bez rozkładu poziomów (43× większy plik) i bez honoru, których widok historii nie czyta. |
| Trendy w osobnym pliku, nie w manifeście | Manifest jest pobierany przy każdym wejściu, a historii bez filtra można nie rysować wcale. 9 KB dokładane wszystkim to koszt bez pokrycia. |
| Jeden widok zamiast dwóch stron | Przekrój i historia pod tym samym filtrem to jedyne pytanie, na które nie dało się odpowiedzieć wcześniej. Przy okazji znikła duplikacja CSS i drugi stan URL. `trends.html` został przekierowaniem, żeby rozesłane linki działały. |
| Wybór świata i licznik trafień w przyklejonym pasku | Od filtra do pierwszego wykresu historii było 961 px — więcej niż ekran, więc kontrolka i to, czym steruje, nigdy nie były widoczne naraz. Pasek trzyma **jedyny egzemplarz** obu, więc nie ma czego synchronizować. |
| Pola filtrów jako szuflada `position: absolute` w pasku | Otwiera się tam, gdzie użytkownik patrzy — panel na górze dokumentu był po przewinięciu niewidoczny, więc przycisk „Filtry” nic nie dawał. Nie zajmuje miejsca w układzie, więc otwieranie i zamykanie **nie przesuwa strony**, a stan początkowy siedzi w markupie (`hidden`), nie w JS-ie po `fetch`ach. |
| Dwie zmienne na obramowania: `--border` i `--border-strong` | Granice kontrolek i kart potrzebują 3:1 (WCAG 2.2 SC 1.4.11), rozdzielacze w tabeli nie. Jedna wspólna wartość dawała 1,48:1 i pole formularza nie odróżniało się od karty niczym. |
| Chipy przewijane, nie przycinane | `overflow: hidden` przy 800 px zostawiało im zmierzone **0 px** — trzy chipy niewidoczne w całości, razem z krzyżykami. Przewijanie zostawia je osiągalne także tabulatorem. |
| Historia dociągana leniwie, dopiero po ruchu filtrem | Filtr domyślny obsługuje `trends.json` za 9 KB. Kto nie filtruje, nie płaci za 1,9 MB gordiona. |
| Filtrowanie u klienta zamiast prekompilowanego cube'a | Przelot po 813 tys. wierszy to 2,8-7 ms — koszykowanie kosztowałoby dokładność i nie objęłoby honoru (−35 .. 1,2 mln). |
| Logika w `filters.js`/`history.js`, nie w `app.js` | `app.js` startuje widok od razu po imporcie, więc modułu z nim zszytego nie da się przetestować poza przeglądarką. Pilnuje tego test. |
| Chart.js wendorowany | CDN bez SRI to zależność, której nikt nie kontroluje; lokalnie działa też offline. |
| Retry per strona | Wcześniej cofał cały świat do strony 1 — dla gordiona (797 stron) do 4× po ~13 min. |
| Wadliwe wiersze pomijane | Jeden dziwny wiersz nie może wywalać całego świata; przerywamy dopiero powyżej 1% na stronę. |
| Strażnik zapisuje, nie odrzuca | Utrata całego runu boli bardziej niż migawka z ostrzeżeniem. |
| `noUnusedLocals` włączone | Martwy kod przeżył tu już dwie przebudowy. |
| Licencja rozdzielona: MIT na kod, osobna nota na dane | Licencji udziela się do tego, do czego ma się prawa. Baza rankingu jest Margonem, a nicki to dane osobowe — objęcie `public/worlds/` MIT-em byłoby oświadczeniem praw, których nie mamy, i zaproszeniem innych do tego, czego zakazuje `VII.2.k)`. |
| Pełny tekst licencji Chart.js obok pliku, mimo banera w minifikacie | MIT wymaga noty w każdej kopii, a banery giną przy dalszej minifikacji. |
| `LICENSE` to czysty MIT bez ani jednego dopisku o danych | GitHub rozpoznaje licencję przez podobieństwo do wzorca (próg ~98%) — dopisek o zakresie zmieniłby wykrytą licencję na „Other". Zakres jest w `DATA-NOTICE.md` i `README.md`. |

Pełne uzasadnienia i historia: audyty niżej.

---

## Co czytać dalej

| Plik | Po co |
|---|---|
| [`docs/2026-08-01-audit.md`](docs/2026-08-01-audit.md) | Audyt #1: czy dane są prawdziwe (są — zweryfikowane wobec żywego rankingu), co było zepsute, co usunięte, czego brakuje. |
| [`docs/2026-08-01-audit-2.md`](docs/2026-08-01-audit-2.md) | Audyt #2 po naprawach: co się obroniło, co poprawione, **dług na przyszłość i lista pomysłów**. |
| [`docs/2026-08-01-size-budget.md`](docs/2026-08-01-size-budget.md) | Ile rund scrapa zostało do limitu 1 GB na Pages (~65 ≈ 2 lata) i co zrobić, gdy się skończy. |
| [`docs/2026-08-04-spec-trends.md`](docs/2026-08-04-spec-trends.md) | Spec widoku trendów jednego świata w czasie: co pokazać, `trends.json` (**9,0 KB gzip na całą historię**), pułapki metryki „ostatnio online”. |
| [`docs/2026-08-04-spec-world-view.md`](docs/2026-08-04-spec-world-view.md) | Spec scalenia `index.html` i `trends.html` w jeden widok per świat, z filtrowaniem **całej historii** u klienta: pomiary (**7 ms na 813 tys. wierszy**), leniwe pobieranie, pułapki i próg okna migawek. |
| [`docs/2026-08-04-audit-3.md`](docs/2026-08-04-audit-3.md) | Audyt #3: **osiem błędów, których nie łapało 165 testów**, atrapa DOM-u łagodniejsza od przeglądarki, `Retry-After: 0`, nieatomowy zapis, walidacja CLI — plus dług i pomysły. |
| [`docs/2026-08-04-spec-filter-bar.md`](docs/2026-08-04-spec-filter-bar.md) | Spec przypiętego paska filtrów: geometria strony (**2806 px**, filtr 961 px od pierwszego wykresu historii, **87% ekranu na telefonie**), warianty, badania i pułapki `position: sticky` w tym markupie. |
| [`docs/2026-08-05-audit-ui-ux.md`](docs/2026-08-05-audit-ui-ux.md) | Audyt #4, pierwszy o **interfejsie**: kontrasty granic (było **1,48:1** przy progu 3:1), chipy ściskane do **0 px** między 721 a 1100 px, focus ginący przy Escape i przy krzyżyku, geometria zmierzona w przeglądarce. Metoda pomiaru, dług i trzy hipotezy obalone. |
| [`DATA-NOTICE.md`](DATA-NOTICE.md) | **Czyje są dane i czego nie licencjonujemy.** Granica kod/dane, klauzule regulaminu Margonem (`XIX.2`, `XIX.4`, `VII.2.m)`, `VII.2.k)`), prawo sui generis do bazy, dane osobowe w `.n.json`, procedura usunięcia, zachowanie scrapera. |
| [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) | Chart.js (rozpowszechniany — wymaga noty) vs zależności buildu; całe drzewo permisywne, bez copyleftu. |
| [`README.md`](README.md) | Instrukcja obsługi dla człowieka. |

---

## Zasady pracy w tym repo

1. **Nie ufaj hipotezie — zmierz.** Przy audycie #2 „wykres jest nieczytelny przez poziom 1"
   okazało się nieprawdą po jednym poleceniu. Dane leżą na dysku, sprawdzenie kosztuje sekundy.
2. **Przed pełnym scrapem uruchom `bun run scrape:check`.** Margonem już raz zmienił układ
   tabeli i scraper padał na wszystkich 20 światach, kończąc się kodem 0.
3. **Nie pisz kodu na zapas.** Ten projekt skasował już stałą i cały moduł, które istniały
   „na przyszłość”. Jeśli coś nie ma dziś konsumenta, opisz pomysł w `docs/` i nie commituj kodu.
4. **Szanuj serwis.** 1 req/s to domyślny interwał; przy 400 ms ranking odpowiada `429`.
   `robots.txt` nie zabrania `/ladder` (a `sitemap.xml` Margonem sam te ścieżki wypisuje),
   ale to nie jest zaproszenie do dobijania. Nie podszywaj UA pod przeglądarkę —
   `Mozilla/5.0 (margostat scraper)` mówi wprost, kto puka.
5. **Dane w `public/worlds/` są nieodtwarzalne.** Ranking nie ma historii — czego nie
   zescrapowaliśmy wtedy, tego nie da się dziś odzyskać. Migracje formatu rób bezstratnie
   i weryfikuj wiersz po wierszu wobec oryginałów z gita.
6. **Testy porównują z prawdą, nie z samymi sobą.** Parser jest sprawdzany na zrzucie
   prawdziwej strony, filtry na próbce prawdziwej migawki w starym schemacie. Utrzymaj ten
   układ — test, który sprawdza reimplementację samego siebie, niczego nie pilnuje.
7. **Notatki i audyty trafiają do `docs/`**, wg schematu `RRRR-MM-DD-<temat>.md`, i są
   dopisywane do tabeli w [`docs/README.md`](docs/README.md) oraz do „Co czytać dalej” wyżej.
8. **Kod jest nasz, dane nie.** MIT z `LICENSE` obejmuje wyłącznie kod. Baza rankingu
   należy do wydawcy Margonem (regulamin `XIX.2`/`VII.2.m)` + prawo sui generis do bazy
   danych), a `.n.json` zawiera nicki, czyli dane osobowe. Nigdy nie obejmuj `public/worlds/`
   ani `test/fixtures/` licencją open source, nie dopisuj im `CC-BY`/`ODbL` i nie zapraszaj
   w README do komercyjnego użytku — to byłoby oświadczanie praw, których nie mamy.
   Wszystko rozliczone w [`DATA-NOTICE.md`](DATA-NOTICE.md); zmieniasz zakres publikowanych
   pól — zaktualizuj tam tabelę danych osobowych.

---

## Czego tu nie ma (świadomie)

- **Wyszukiwarki gracza i progresji pojedynczej postaci** — mimo że dane leżą gotowe:
  `.n.json` towarzyszy każdej migawce i nikt go dziś nie czyta. Uwaga: tę analizę przecina
  „szew `charId`” z audytu #2 — trendy populacji nie, bo liczą ludzi, nie śledzą osób.
- **Sum globalnych i zestawiania światów ze sobą** — `trends.json` ma na to komplet danych,
  ale suma wywraca się na zmiennym zestawie światów (`luvia` istnieje tylko w ostatniej
  rundzie i ma 41,3% online), a zestawienie wymaga normalizacji, bo gordion spłaszcza
  brutala. Świadomie odłożone — patrz spec trendów.
- **Automatycznego scrapa (cron)** — odpalany ręcznie, stąd nierówne odstępy 3-17 dni.
- **37 światów legacy/prywatnych** — ranking wystawia ich łącznie ~57, śledzimy 21.
- **Sprawdzania typów w `public/*.js`** — `checkJs` daje dziesiątki błędów typowania DOM-u,
  nie realnych bugów; wymaga adnotacji JSDoc. Powód zapisany w `tsconfig.json`.
