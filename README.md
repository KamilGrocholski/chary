# margostat

Statystyki graczy [Margonem](https://www.margonem.pl) — scraper rankingów światów + interaktywny dashboard hostowany na **GitHub Pages**.

**🔗 Live: https://kamilgrocholski.github.io/chary/**

Scraper cyklicznie pobiera rankingi graczy ze wszystkich śledzonych światów, zapisuje migawki (snapshoty) do statycznych plików JSON, a lekki dashboard (bez backendu, sam HTML + Chart.js) pozwala je przeglądać i filtrować.

---

## Jak to działa

```
margonem.pl/ladder  ──scrape──►  public/worlds/<świat>/<ts>.f.json   (poziom/profesja/honor/dni)
                                 public/worlds/<świat>/<ts>.n.json   (nicki + charId)
                                          │
                                          ▼
                                  public/manifest.json  ──►  dashboard (GitHub Pages)
```

- **Scraper** (`src/world_scraper.ts`) — przechodzi po stronach rankingu każdego świata i zapisuje snapshot.
- **Parser** (`src/parser.ts`) — czysta logika parsowania HTML-a rankingu, pokryta testami na prawdziwej stronie.
- **Podział snapshotu** (`src/snapshot.ts`) — zapis do dwóch plików o tej samej kolejności wierszy.
- **Manifest** (`public/manifest.json`) — indeks snapshotów per świat, z linkiem do obu plików.
- **Dashboard** (`public/index.html` + `public/app.js`) — wybór świata i daty, filtry (poziom, honor, profesja, ostatnia aktywność), wykres rozkładu poziomów wg profesji.

Cały `public/` jest statyczny — nie ma serwera aplikacyjnego, więc idealnie nadaje się pod Pages.

### Skąd dashboard bierze dane

Wyłącznie z `.f.json`, zawsze — więc **wszystkie filtry są dokładne**, także honor i „ostatnio online" (dowolny próg dni, nie tylko presety). Plik trzyma cztery tablice liczb, po jednej na kolumnę, więc jest mały: 97 KB po gzipie dla aethera, 180 KB dla największego `gordiona`. Pages serwuje JSON skompresowany, więc to realny transfer.

Nicki i `charId` leżą osobno w `.n.json` i nie są pobierane wcale — filtrowaniu są niepotrzebne, a to ~połowa objętości snapshotu. Pobierze je dopiero przyszła wyszukiwarka graczy i widok progresji.

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
- `charId` — stabilne ID postaci z linku profilu, odporne na zmianę nicku. Brak w snapshotach zmigrowanych z formatu sprzed sierpnia 2026.

Starsze snapshoty (jeden plik na migawkę, z tekstem „Mniej niż 24h temu” i wyliczaną datą ISO) zostały zmigrowane bezstratnie — `bun run rebuild` obsługuje oba stare schematy, gdyby jakiś się jeszcze znalazł.

## Utrzymanie danych

```bash
bun run rebuild                # migruje stare, jednoplikowe snapshoty do pary .f/.n i przebudowuje manifest
bun run rebuild --agg          # dodatkowo generuje agregaty .agg.json
bun run rebuild --keep-legacy  # zostawia oryginalne pliki po migracji
```

Bezpieczne do wielokrotnego uruchamiania.

**Agregaty** (`src/aggregate.ts`) zwijają snapshot do ~8 KB (rozkład poziomów, aktywności i honoru per profesja). Dashboard ich nie potrzebuje — filtruje dokładnie na `.f.json` — ale dla widoku obejmującego wiele migawek naraz (trend populacji przez 9 snapshotów) 9×8 KB bije 9×500 KB. Dlatego kod został, a pliki generuje się na żądanie.

## Testy

```bash
bun test        # parser (na prawdziwej stronie rankingu w test/fixtures) + logika dashboardu
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

> **Uwaga na rozmiar.** Opublikowana strona na GitHub Pages ma twardy limit 1 GB. Stan na 2026-08-01: `public/` waży 118 MB, a każda runda scrape'u dokłada ~14 MB → **zostało ~65 rund, czyli około dwóch lat** przy obecnym tempie. Pełne wyliczenie i co zrobić, gdy zapas się skończy: [`ai/2026-08-01-budzet-rozmiaru.md`](ai/2026-08-01-budzet-rozmiaru.md).

## Struktura projektu

```
src/
  world_scraper.ts   # scraper rankingów (fetch, retry, zapis)
  parser.ts          # parsowanie HTML-a rankingu (czyste funkcje)
  snapshot.ts        # format snapshotu: podział na .f/.n i migracja starych
  aggregate.ts       # agregaty (na żądanie)
  manifest.ts        # przebudowa public/manifest.json
  rebuild_data.ts    # utrzymanie: migracja + agregaty + manifest
  worlds.ts          # lista śledzonych światów
  server.ts          # lokalny statyczny serwer do podglądu
test/
  parser.test.ts     # testy parsera na zrzucie prawdziwej strony
  snapshot.test.ts   # format snapshotu i migracja ze starych schematów
  dashboard.test.ts  # logika dashboardu, porównana z danymi sprzed migracji
public/              # to, co ląduje na GitHub Pages
  index.html         # dashboard (markup + style)
  app.js             # logika dashboardu
  vendor/            # Chart.js (lokalnie, bez CDN-u)
  manifest.json      # indeks snapshotów
  worlds/            # snapshoty per świat: <ts>.f.json + <ts>.n.json
ai/                  # audyty i notatki
.github/workflows/
  deploy.yml         # deploy na GitHub Pages
  ci.yml             # typecheck + testy
```

## Stack

Bun · TypeScript · Cheerio (parsowanie HTML) · Chart.js (wykresy) · GitHub Pages (hosting)
