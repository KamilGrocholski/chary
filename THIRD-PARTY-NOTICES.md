# Third-party notices

Kod firm trzecich użyty w tym projekcie. Nie jest objęty [`LICENSE`](LICENSE) —
każda pozycja ma własną licencję, wymienioną niżej.

Podział na dwie grupy jest istotny, bo obowiązki są różne: to, co **trafia na
stronę**, jest rozpowszechniane, więc wymaga dołączenia noty licencyjnej. To, co
działa **tylko przy budowie i scrapowaniu**, nie jest przez nas rozpowszechniane
i wymienione jest tu dla porządku.

---

## Rozpowszechniane (ląduje na GitHub Pages)

### Chart.js 4.4.7 — MIT

- Plik: `public/vendor/chart.umd.min.js` (wendorowany, niezmodyfikowany)
- Licencja: [`public/vendor/LICENSE.chartjs`](public/vendor/LICENSE.chartjs)
- Copyright (c) 2014-2024 Chart.js Contributors
- https://www.chartjs.org

MIT wymaga, aby nota o prawach autorskich towarzyszyła każdej kopii. Zminifikowany
plik ma ją w banerze na początku, ale banery giną przy dalszej minifikacji, dlatego
pełny tekst licencji leży obok jako osobny plik. **Przy aktualizacji Chart.js
podmień też `LICENSE.chartjs`** — numer wersji i rok w copyrighcie mogą się zmienić.

---

## Tylko przy budowie i scrapowaniu (nie trafia na stronę)

| Pakiet | Licencja | Po co |
|---|---|---|
| `cheerio` | MIT | parsowanie HTML-a rankingu w `src/parser.ts` |
| `typescript` | Apache-2.0 | `bun run typecheck` |
| `@types/bun`, `bun-types`, `@types/node` | MIT | typy |

Drzewo zależności `cheerio` wnosi dodatkowo pakiety na licencjach **MIT**
(`parse5`, `htmlparser2`, `undici`, `iconv-lite`, `dom-serializer` i inne),
**BSD-2-Clause** (`domhandler`, `domutils`, `domelementtype`, `entities`,
`css-select`, `css-what`, `nth-check`, `cheerio-select`) oraz **ISC** (`boolbase`).

Wszystkie zależności są na licencjach permisywnych — **w drzewie nie ma copyleftu**,
więc nic nie koliduje z MIT-em tego projektu. Aktualna lista:

```bash
for p in node_modules/*/ node_modules/@*/*/; do
  [ -f "$p/package.json" ] && grep -m1 '"license"' "$p/package.json"
done | sed 's/.*: *"//;s/".*//' | sort -u
```

---

## Dane rankingu — to nie jest kod firmy trzeciej

Zawartość `public/worlds/`, `public/manifest.json`, `public/trends.json` oraz
`test/fixtures/` pochodzi z margonem.pl i **nie jest** oprogramowaniem na licencji
open source. Rządzi nią osobny dokument: [`DATA-NOTICE.md`](DATA-NOTICE.md).
