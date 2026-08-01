# Budżet rozmiaru vs limit GitHub Pages

Stan na **2026-08-01**, po rozdzieleniu snapshotów na `.f.json` / `.n.json`.
Uzupełnienie [`2026-08-01-audyt.md`](2026-08-01-audyt.md) (sekcja 2), gdzie liczby
opisują stan **sprzed** naprawy.

## Wyliczenie

| | |
|---|---|
| `public/` teraz | **118,2 MB** |
| przyrost na rundę scrape'u | **~13,9 MB** |
| limit opublikowanej strony na GitHub Pages | 1 GB (twardy) |
| zapas | 906 MB |
| **rund do limitu** | **~65** |
| przy tempie co ~12 dni | **~2 lata** (do ok. połowy 2028) |

Skład przyrostu na rundę (21 światów, 548 tys. graczy + `luvia`):

- 6,0 MB — pliki `.f.json` (poziom/profesja/honor/dni), 11,5 B na gracza,
- 7,0 MB — pliki `.n.json` (nicki + `charId`), 13,4 B na gracza,
- 0,9 MB — `luvia`, dopisana do `src/worlds.ts`.

Agregatów nie ma — dashboard filtruje dokładnie na `.f.json`, więc byłyby martwym plikiem,
a kod, który je liczył, został usunięty jako pisany na zapas. Gdy powstanie widok
obejmujący wiele migawek naraz, agregat policzy się z `.f.json` w kilkunastu liniach
dopasowanych do tego, czego ten widok naprawdę potrzebuje (~8 KB na migawkę).

## Jak to się zmieniało

| stan | zajęte | na rundę | rund do limitu |
|---|---|---|---|
| przed remontem (pretty-print, schemat v1) | 620 MB | 38,6 MB | ~10 |
| po minifikacji + agregatach (schemat v2) | 340,6 MB | 22,7 MB | ~30 |
| **po rozdzieleniu na `.f`/`.n` (schemat v3)** | **118,2 MB** | **13,9 MB** | **~65** |

Skąd taki spadek przy przejściu na v3: zniknął dublowany tekst „Mniej niż 24h temu”
i wyliczany ISO (v1), zniknęła ranga (odtwarzalna z kolejności wierszy) oraz
powtarzane w każdym wierszu nawiasy JSON-a.

## Transfer przy wejściu na dashboard

Pages serwuje JSON z `content-encoding: gzip` (sprawdzone na żywym `manifest.json`),
więc liczy się rozmiar po kompresji:

| świat | graczy | `.f.json` | po gzipie |
|---|---|---|---|
| gordion (największy) | 80 896 | 887 KB | **180 KB** |
| aether | 39 037 | 435 KB | **97 KB** |
| brutal (najmniejszy) | 7 754 | 84 KB | **20 KB** |

Nicki (`.n.json`) nie są w ogóle pobierane, dopóki nie powstanie wyszukiwarka gracza.

## Git to osobna sprawa i nie jest wąskim gardłem

`.git` ma 120 MB. Historia z dzisiejszymi zmianami urośnie o kilkadziesiąt MB
(stare, jednoplikowe snapshoty zostają w niej na zawsze), potem ~4 MB na rundę.
Przy 65 rundach wyjdzie ~450 MB — poniżej progu, przy którym GitHub zaczyna zgłaszać
uwagi (~1 GB).

## Co zrobić, gdy zapas się skończy

Dwa lata to dużo, więc **nic teraz nie robimy**. Gdy przyjdzie czas, w kolejności:

1. **gzip plików `.n.json`** — nicki to połowa przyrostu, a są potrzebne rzadko.
   `.n.json.gz` + `DecompressionStream` przy wyszukiwarce → runda spada do ~8 MB.
2. **gzip również `.f.json`** — runda ~3 MB, czyli **4× więcej rund**. Kosztem jest
   ręczna dekompresja w przeglądarce zamiast przezroczystego gzipa z CDN-u.
3. **wynieść nicki poza Pages** (GitHub Releases) — na Pages zostają same `.f.json`,
   runda 6 MB, ale dochodzi CORS i zewnętrzna zależność.
4. **delta względem poprzedniego snapshotu** — 98,7% graczy nie zmienia się między
   migawkami, więc baza + różnice dają 10-20×. Najwięcej nowej logiki i ryzyko
   rozjazdu przy odtwarzaniu, dlatego ostatnia w kolejce.

## Jak przeliczyć to ponownie

```bash
du -sb public                              # aktualny rozmiar
du -cb public/worlds/*/<ostatni-ts>.[fn].json   # koszt jednej rundy
```

Albo prościej: zsumować rozmiary plików z ostatniej rundy scrape'u.
