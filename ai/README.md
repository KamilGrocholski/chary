# ai/ — punkt wejścia dla agenta AI

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
- **Stan:** 181 migawek z 20 światów (`src/worlds.ts` śledzi 21 — `luvia` dojdzie przy
  najbliższym scrapie), ~548 tys. graczy w rundzie, `public/` 119 MB.

---

## Gdzie co leży

```
src/
  world_scraper.ts   CLI scrapera: pobieranie, retry, strażnik, zapis, podsumowanie
  parser.ts          parsowanie HTML-a rankingu — czyste funkcje, zero I/O
  snapshot.ts        format migawki: podział .f/.n, migracja starych, strażnik populacji
  manifest.ts        budowa public/manifest.json
  rebuild_data.ts    CLI utrzymania danych (migracja + manifest)
  worlds.ts          lista śledzonych światów — edytowana ręcznie
  server.ts          lokalny serwer statyczny do podglądu
public/              dokładnie to, co ląduje na GitHub Pages
  index.html         markup i style dashboardu
  app.js             logika dashboardu (moduł ES; góra pliku czysta, dół dotyka DOM-u)
  vendor/            Chart.js 4.4.7 lokalnie, bez CDN-u
  manifest.json      indeks migawek
  worlds/<świat>/    <id>.f.json + <id>.n.json
test/
  parser.test.ts     parser na zrzucie prawdziwej strony rankingu
  snapshot.test.ts   format migawki, migracja, strażnik populacji
  dashboard.test.ts  logika dashboardu, filtry, czas migawki, spójność z index.html
  fixtures/          zrzut strony rankingu + próbka snapshotu w starym schemacie
ai/                  audyty i notatki (ten katalog)
.github/workflows/   deploy.yml (check + publikacja), ci.yml (pull requesty)
```

Kod ma ~2,4 tys. linii łącznie z testami. Da się go przeczytać w całości i **warto** to
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
bun test               # 98 testów
bun run typecheck
bun run rebuild        # utrzymanie danych: migracja starych schematów + manifest
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

---

## Dlaczego tak, a nie inaczej

Decyzje, które wyglądają dziwnie, dopóki nie znasz powodu:

| Decyzja | Powód |
|---|---|
| Migawka w dwóch plikach | Nicki to ~2/3 objętości, a filtrowaniu są zbędne. Podział ściął `public/` z 620 MB do 118 MB. |
| Brak agregatów | Były pisane na zapas i nikt ich nie czytał — skasowane. Gdy powstanie widok wielu migawek, agregat to kilkanaście linii nad `.f.json`. |
| Chart.js wendorowany | CDN bez SRI to zależność, której nikt nie kontroluje; lokalnie działa też offline. |
| Retry per strona | Wcześniej cofał cały świat do strony 1 — dla gordiona (797 stron) do 4× po ~13 min. |
| Wadliwe wiersze pomijane | Jeden dziwny wiersz nie może wywalać całego świata; przerywamy dopiero powyżej 1% na stronę. |
| Strażnik zapisuje, nie odrzuca | Utrata całego runu boli bardziej niż migawka z ostrzeżeniem. |
| `noUnusedLocals` włączone | Martwy kod przeżył tu już dwie przebudowy. |

Pełne uzasadnienia i historia: audyty niżej.

---

## Co czytać dalej

| Plik | Po co |
|---|---|
| [`2026-08-01-audyt.md`](2026-08-01-audyt.md) | Audyt #1: czy dane są prawdziwe (są — zweryfikowane wobec żywego rankingu), co było zepsute, co usunięte, czego brakuje. |
| [`2026-08-01-audyt-2.md`](2026-08-01-audyt-2.md) | Audyt #2 po naprawach: co się obroniło, co poprawione, **dług na przyszłość i lista pomysłów**. |
| [`2026-08-01-budzet-rozmiaru.md`](2026-08-01-budzet-rozmiaru.md) | Ile rund scrapa zostało do limitu 1 GB na Pages (~65 ≈ 2 lata) i co zrobić, gdy się skończy. |
| `../README.md` | Instrukcja obsługi dla człowieka. |

---

## Zasady pracy w tym repo

1. **Nie ufaj hipotezie — zmierz.** Przy audycie #2 „wykres jest nieczytelny przez poziom 1"
   okazało się nieprawdą po jednym poleceniu. Dane leżą na dysku, sprawdzenie kosztuje sekundy.
2. **Przed pełnym scrapem uruchom `bun run scrape:check`.** Margonem już raz zmienił układ
   tabeli i scraper padał na wszystkich 20 światach, kończąc się kodem 0.
3. **Nie pisz kodu na zapas.** Ten projekt skasował już stałą i cały moduł, które istniały
   „na przyszłość”. Jeśli coś nie ma dziś konsumenta, opisz pomysł w `ai/` i nie commituj kodu.
4. **Szanuj serwis.** 1 req/s to domyślny interwał; przy 400 ms ranking odpowiada `429`.
   `robots.txt` nie zabrania `/ladder`, ale to nie jest zaproszenie do dobijania.
5. **Dane w `public/worlds/` są nieodtwarzalne.** Ranking nie ma historii — czego nie
   zescrapowaliśmy wtedy, tego nie da się dziś odzyskać. Migracje formatu rób bezstratnie
   i weryfikuj wiersz po wierszu wobec oryginałów z gita.
6. **Testy porównują z prawdą, nie z samymi sobą.** Parser jest sprawdzany na zrzucie
   prawdziwej strony, filtry na próbce prawdziwej migawki w starym schemacie. Utrzymaj ten
   układ — test, który sprawdza reimplementację samego siebie, niczego nie pilnuje.
7. **Notatki i audyty trafiają do `ai/`**, wg schematu `RRRR-MM-DD-<temat>.md`, i są
   dopisywane do tabeli wyżej.

---

## Czego tu nie ma (świadomie)

- **Wyszukiwarki gracza i progresji w czasie** — mimo że dane leżą gotowe: `.n.json`
  towarzyszy każdej migawce i nikt go dziś nie czyta. Pierwszy pomysł z listy w audycie #2.
- **Automatycznego scrapa (cron)** — odpalany ręcznie, stąd nierówne odstępy 6-13 dni.
- **37 światów legacy/prywatnych** — ranking wystawia ich łącznie ~57, śledzimy 21.
- **Sprawdzania typów w `public/app.js`** — `checkJs` daje 25 błędów typowania DOM-u,
  nie realnych bugów; wymaga adnotacji JSDoc. Powód zapisany w `tsconfig.json`.
