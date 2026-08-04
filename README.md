# margostat

Statystyki graczy [Margonem](https://www.margonem.pl) — scraper rankingów światów + interaktywny dashboard hostowany na **GitHub Pages**.

**🔗 Live: https://kamilgrocholski.github.io/chary/**

Scraper cyklicznie pobiera rankingi graczy ze wszystkich śledzonych światów, zapisuje migawki (snapshoty) do statycznych plików JSON, a lekki dashboard (bez backendu, sam HTML + Chart.js) pozwala je przeglądać i filtrować.

> **Pracujesz nad tym z agentem AI?** Zacznij od [`AGENTS.md`](AGENTS.md) — jeden plik
> z całą mapą projektu, formatem danych, pułapkami i uzasadnieniem decyzji.

---

## Jak to działa

```
margonem.pl/ladder  ──scrape──►  public/worlds/<świat>/<ts>.f.json   (poziom/profesja/honor/dni)
                                 public/worlds/<świat>/<ts>.n.json   (nicki + charId)
                                          │
                          ┌───────────────┴───────────────┐
                          ▼                               ▼
                  public/manifest.json            public/trends.json
                          │                               │
                          └───────────────┬───────────────┘
                                          ▼
                              Widok świata (index.html)
                          przekrój migawki + historia w czasie,
                                pod tym samym filtrem
```

- **Scraper** (`src/world_scraper.ts`) — przechodzi po stronach rankingu każdego świata i zapisuje snapshot.
- **Parser** (`src/parser.ts`) — czysta logika parsowania HTML-a rankingu, pokryta testami na prawdziwej stronie.
- **Podział snapshotu** (`src/snapshot.ts`) — zapis do dwóch plików o tej samej kolejności wierszy.
- **Manifest** (`public/manifest.json`) — indeks snapshotów per świat, z linkiem do obu plików.
- **Trendy** (`src/trends.ts` → `public/trends.json`) — zwinięta historia każdego świata, po jednej liczbie na migawkę.
- **Widok świata** (`public/index.html` + `public/app.js`) — przyklejony u góry pasek (świat, licznik trafień, chipy aktywnych filtrów, kotwice sekcji), pod nim pola filtrów (poziom, honor, profesja, ostatnia aktywność), a niżej dwie sekcje: **przekrój** wybranej migawki (rozkład poziomów wg profesji) i **historia** wszystkich migawek (populacja, aktywność, profesje, tabela zmian). Filtr rządzi obiema.
- **Logika** (`public/filters.js`, `public/history.js`, `public/shared.js`) — filtrowanie, zliczanie i budowa serii, bez DOM-u, testowane bez przeglądarki.

Cały `public/` jest statyczny — nie ma serwera aplikacyjnego, więc idealnie nadaje się pod Pages.

### Skąd widok bierze dane

**Przekrój** — zawsze z jednego `.f.json`, więc wszystkie filtry są dokładne, także honor i „ostatnio online" (dowolny próg dni, nie tylko presety). Plik trzyma cztery tablice liczb, po jednej na kolumnę, więc jest mały: 97 KB po gzipie dla aethera, 180 KB dla największego `gordiona`.

**Historia** ma dwie ścieżki i to jest sedno tego widoku:

| kiedy | skąd | ile |
|---|---|---|
| filtr domyślny | `public/trends.json` | **9 KB gzip na całą historię wszystkich światów** |
| filtr ustawiony | `.f.json` tego jednego świata | 0,2-1,9 MB gzip, dociągane w tle po pierwszym ruchu filtrem |

Kto nie filtruje, nie płaci za dokładność ani bajtem. Kto filtruje, dostaje odpowiedź policzoną z surowych wierszy — przelot po całej historii gordiona (813 tys. wierszy) trwa **2,8-7 ms**, więc żaden prekompilowany agregat nie byłby tego wart. Punkty pojawiają się na wykresie w miarę pobierania; migawka jeszcze niewczytana **nie dostaje punktu**, zamiast dostać zmyślony.

`trends.json` trzyma po jednej liczbie na migawkę: populację, pięć rozłącznych koszyków aktywności i rozbicie na profesje. Przebudowuje się sam po każdej rundzie scrapa i przy `bun run rebuild`.

Nicki i `charId` leżą osobno w `.n.json` i nie są pobierane wcale — filtrowaniu są niepotrzebne, a to ~połowa objętości snapshotu. Pobierze je dopiero przyszła wyszukiwarka graczy i widok progresji.

> **Uwaga na metrykę „ostatnio online".** Scrape leci ręcznie, raz o 4 rano, raz o 21, w różne dni tygodnia — a jedna runda trwa ~2 h. Przy populacji zmieniającej się o 0,6% próg „< 24h" waha się o ~15%. Do oceny trendu miarodajniejsze są progi „≤ 7 dni" i „≤ 30 dni"; widok pokazuje wszystkie trzy i podaje godzinę UTC każdej migawki. Szczegóły: [`docs/2026-08-04-spec-trendy.md`](docs/2026-08-04-spec-trendy.md).

## Wymagania

- [Bun](https://bun.sh)

```bash
bun install
```

## Scrapowanie

Lista śledzonych światów jest w `src/worlds.ts` — edytuj ją ręcznie, aby dodać lub usunąć świat.

```bash
# Sprawdź, czy parser radzi sobie z aktualnym markupem (pobiera tylko stronę 1, nic nie zapisuje)
bun run scrape:check

# Wszystkie światy z src/worlds.ts
bun run scrape

# Wybrane światy (po przecinku, bez spacji)
bun run scrape aether,tempest,classic

# Z własnym interwałem między requestami (ms, domyślnie 1000, minimum 250)
bun run scrape aether 2000
```

Dane trafiają do `public/worlds/<świat>/<timestamp>.f.json` i `.n.json`, a `public/manifest.json` aktualizuje się automatycznie.

> **Zanim odpalisz pełny scrape, uruchom `bun run scrape:check`.** Margonem potrafi zmienić układ tabeli rankingu — dry-run wykrywa to w kilkanaście sekund zamiast po godzinie pobierania.

### Logi

Domyślnie logowane są tylko poziomy `WARN`, `ERROR`, `FATAL`. Plik logu: `logs/scraper.log`.

```bash
LOG_LEVEL=INFO  bun run scrape   # + start/koniec każdego świata
LOG_LEVEL=DEBUG bun run scrape   # + każda strona
```

### Odporność na błędy

- Ponawianie jest **per strona** (3 próby, exponential backoff 5 s → 10 s → 20 s, z uwzględnieniem `Retry-After`) — padnięta strona nie cofa całego świata do początku.
- Pojedyncze wadliwe wiersze są pomijane i liczone (`skippedRows` w snapshocie). Dopiero przekroczenie 1% wierszy na stronie przerywa świat — to sygnał, że zmienił się markup.
- Świat, którego nie udało się pobrać, nie przerywa całego runu, ale proces kończy się **kodem 1** i wypisuje podsumowanie.

## Format snapshotu

Aktualny schemat (`schema: 3`) to dwa pliki o **tej samej kolejności wierszy** — wiersz *i* odpowiada randze *i+1*, więc ranga nie jest nigdzie zapisywana, a oba pliki razem odtwarzają snapshot 1:1 bez dublowania czegokolwiek.

`<ts>.f.json` — kolumnowo, wszystko czego potrzebuje filtrowanie:

```json
{ "kind": "filter", "count": 39037,
  "level": [378, 359, ...], "profession": [4, 3, ...],
  "honor": [8749, 4715, ...], "days": [0, 0, 30, null, ...] }
```

`<ts>.n.json` — tożsamość gracza:

```json
{ "kind": "names", "count": 39037,
  "name": ["essobe", ...], "charId": [729, ...] }
```

- `days` — `0` dla „Mniej niż 24h temu”, `N` dla „N dni temu”, `null` dla konta, które nigdy nie było online (ranking pokazuje wtedy ~20655 dni, czyli datę z 1969 r.).
- `honor` — bywa **ujemny** (najniższy zaobserwowany: −35), więc pola filtra honoru nie mają dolnego ograniczenia.
- `charId` — stabilne ID postaci z linku profilu, odporne na zmianę nicku. Brak w snapshotach zmigrowanych z formatu sprzed sierpnia 2026.

Starsze snapshoty (jeden plik na migawkę, z tekstem „Mniej niż 24h temu” i wyliczaną datą ISO) zostały zmigrowane bezstratnie — `bun run rebuild` obsługuje oba stare schematy, gdyby jakiś się jeszcze znalazł.

## Utrzymanie danych

```bash
bun run rebuild                # migruje stare snapshoty do pary .f/.n, przebudowuje manifest i trends.json
bun run rebuild --keep-legacy  # zostawia oryginalne pliki po migracji
```

Bezpieczne do wielokrotnego uruchamiania.

## Zależności frontu

Chart.js jest wendorowany w `public/vendor/chart.umd.min.js` (wersja **4.4.7**), żeby strona nie zależała od CDN-u ładowanego bez SRI i działała bez internetu. Aktualizacja:

```bash
curl -sL https://cdn.jsdelivr.net/npm/chart.js@<wersja>/dist/chart.umd.min.js -o public/vendor/chart.umd.min.js
```

Po podmianie zaktualizuj numer wersji tutaj oraz w komentarzu w `public/index.html`.

## Testy

```bash
bun test        # parser (na prawdziwej stronie rankingu w test/fixtures) + cała logika widoku
bun run typecheck
```

## Podgląd lokalny

```bash
bun run serve
# http://localhost:3000
```

## Deploy (GitHub Pages)

Strona deployuje się sama — wystarczy zpushować dane na `main`:

```bash
git add public/
git commit -m "scrape $(date +%Y-%m-%d)"
git push
```

Workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) uploaduje katalog `public/` jako artefakt i publikuje go na GitHub Pages. Można też odpalić ręcznie z zakładki **Actions** (`workflow_dispatch`).

> **Uwaga na rozmiar.** Opublikowana strona na GitHub Pages ma twardy limit 1 GB. Stan na 2026-08-01: `public/` waży 118 MB, a każda runda scrape'u dokłada ~14 MB → **zostało ~65 rund, czyli około dwóch lat** przy obecnym tempie. Pełne wyliczenie i co zrobić, gdy zapas się skończy: [`docs/2026-08-01-budzet-rozmiaru.md`](docs/2026-08-01-budzet-rozmiaru.md).

## Struktura projektu

```
src/
  world_scraper.ts   # scraper rankingów (fetch, retry, zapis)
  parser.ts          # parsowanie HTML-a rankingu (czyste funkcje)
  snapshot.ts        # format snapshotu: podział na .f/.n i migracja starych
  manifest.ts        # przebudowa public/manifest.json
  trends.ts          # agregat historii świata → public/trends.json
  rebuild_data.ts    # utrzymanie: migracja + manifest + trendy
  worlds.ts          # lista śledzonych światów
  server.ts          # lokalny statyczny serwer do podglądu
test/
  parser.test.ts     # testy parsera na zrzucie prawdziwej strony
  snapshot.test.ts   # format snapshotu i migracja ze starych schematów
  dashboard.test.ts  # przekrój: filtry porównane z danymi sprzed migracji
  trends.test.ts     # historia: agregat wobec .f.json, klient liczy to samo co serwer
  dom_smoke.ts       # atrapa DOM-u, dwa scenariusze (odpalane z testów w podprocesie)
public/              # to, co ląduje na GitHub Pages
  index.html         # cały widok świata (markup + style)
  app.js             # jedyny moduł dotykający DOM-u
  filters.js         # filtr, zliczanie, stan filtrów w URL-u (bez DOM-u)
  history.js         # historia świata: progi, serie, pobieranie migawek (bez DOM-u)
  shared.js          # stałe, czas, koszykowanie aktywności (bez DOM-u)
  vendor/            # Chart.js 4.4.7 (lokalnie, bez CDN-u)
  trends.html        # przekierowanie na index.html (stare linki)
  manifest.json      # indeks snapshotów
  trends.json        # zwinięta historia wszystkich światów
  worlds/            # snapshoty per świat: <ts>.f.json + <ts>.n.json
docs/                # audyty i notatki
.github/workflows/
  deploy.yml         # deploy na GitHub Pages
  ci.yml             # typecheck + testy
AGENTS.md            # punkt wejścia dla agenta AI
CLAUDE.md            # wskaźnik na AGENTS.md
```

## Stack

Bun · TypeScript · Cheerio (parsowanie HTML) · Chart.js (wykresy) · GitHub Pages (hosting)
