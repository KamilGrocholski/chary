# margostat

Statystyki graczy [Margonem](https://www.margonem.pl) — scraper rankingów światów + interaktywny dashboard hostowany na **GitHub Pages**.

**🔗 Live: https://kamilgrocholski.github.io/chary/**

Scraper cyklicznie pobiera rankingi graczy ze wszystkich śledzonych światów, zapisuje migawki (snapshoty) do statycznych plików JSON, a lekki dashboard (bez backendu, sam HTML + Chart.js) pozwala je przeglądać, filtrować i porównywać w czasie.

---

## Jak to działa

```
margonem.pl/ladder  ──scrape──►  public/worlds/<świat>/<timestamp>.json
                                          │
                                          ▼
                                  public/manifest.json  ──►  dashboard (GitHub Pages)
```

- **Scraper** (`src/world_scraper.ts`) — przechodzi po stronach rankingu każdego świata, parsuje tabelę graczy (ranking, nick, poziom, profesja, honor, ostatnio online) i zapisuje snapshot z pełną datą.
- **Manifest** (`public/manifest.json`) — indeks wszystkich snapshotów per świat; z niego dashboard wie, co jest dostępne.
- **Dashboard** (`public/index.html`) — statyczna strona: wybór świata i daty, filtry (poziom, honor, profesja, ostatnia aktywność) oraz wykres rozkładu poziomów wg profesji. Deployowana automatycznie na GitHub Pages.

Cały `public/` jest statyczny — nie ma serwera aplikacyjnego, więc idealnie nadaje się pod Pages.

## Wymagania

- [Bun](https://bun.sh)

```bash
bun install
```

## Scrapowanie

Lista śledzonych światów jest w `src/worlds.ts` — edytuj ją ręcznie, aby dodać lub usunąć świat.

```bash
# Wszystkie światy z src/worlds.ts
bun src/world_scraper.ts

# Wybrane światy (po przecinku, bez spacji)
bun src/world_scraper.ts aether,tempest,classic

# Z własnym interwałem między requestami (ms, domyślnie 1000)
bun src/world_scraper.ts aether 2000
```

Dane trafiają do `public/worlds/<świat>/<timestamp>.json`, a `public/manifest.json` aktualizuje się automatycznie.

### Logi

Domyślnie logowane są tylko poziomy `WARN`, `ERROR`, `FATAL`. Plik logu: `logs/scraper.log`.

```bash
LOG_LEVEL=INFO  bun src/world_scraper.ts   # + start/koniec każdego świata
LOG_LEVEL=DEBUG bun src/world_scraper.ts   # + każda strona
```

### Retry

Przy błędzie scraper ponawia próbę do 3 razy z exponential backoff (5 s → 10 s → 20 s). Po wyczerpaniu prób przechodzi do kolejnego świata, żeby jeden padnięty świat nie wywalił całego runu.

## Podgląd lokalny

Aby obejrzeć dashboard lokalnie (dokładnie tak, jak działa na Pages):

```bash
bun src/server.ts
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

## Struktura projektu

```
src/
  world_scraper.ts   # scraper rankingów + budowanie manifestu
  worlds.ts          # lista śledzonych światów
  server.ts          # lokalny statyczny serwer do podglądu
public/              # to, co ląduje na GitHub Pages
  index.html         # dashboard (HTML + Chart.js)
  manifest.json      # indeks snapshotów
  worlds/            # snapshoty JSON per świat
.github/workflows/
  deploy.yml         # deploy na GitHub Pages
```

## Stack

Bun · TypeScript · Cheerio (parsowanie HTML) · Chart.js (wykresy) · GitHub Pages (hosting)
