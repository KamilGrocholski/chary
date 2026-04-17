# margostat

Statystyki graczy Margonem — scraper + dashboard.

## Wymagania

- [Bun](https://bun.sh)

```bash
bun install
```

## Scrapowanie

Lista światów do scrapowania znajduje się w `src/worlds.ts`. Można ją edytować ręcznie.

```bash
# Wszystkie światy z src/worlds.ts
bun src/world_scraper.ts

# Wybrane światy (przecinek, bez spacji)
bun src/world_scraper.ts aether,tempest,classic

# Z własnym interwałem między requestami (ms, domyślnie 1000)
bun src/world_scraper.ts aether 2000
```

Dane trafiają do `public/worlds/<świat>/<timestamp>.json`, manifest aktualizuje się automatycznie w `public/manifest.json`.

### Logi

Domyślnie logowane są tylko poziomy `WARN`, `ERROR`, `FATAL`. Plik logu: `logs/scraper.log`.

```bash
LOG_LEVEL=INFO  bun src/world_scraper.ts   # + start/koniec każdego świata
LOG_LEVEL=DEBUG bun src/world_scraper.ts   # + każda strona
```

### Retry

Przy błędzie scraper ponawia próbę do 3 razy z exponential backoff (5s → 10s → 20s). Po wyczerpaniu prób przechodzi do kolejnego świata.

## Serwer lokalny

```bash
bun src/server.ts
# http://localhost:3000
```

## Deploy (GitHub Pages)

Po scrapie wystarczy zpushować dane:

```bash
git add public/
git commit -m "scrape $(date +%Y-%m-%d)"
git push
```

GitHub Actions automatycznie deployuje `public/` na GitHub Pages.
