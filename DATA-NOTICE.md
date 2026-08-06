# DATA-NOTICE — czyje są dane w tym repozytorium

Ten plik istnieje, bo [`LICENSE`](LICENSE) nie może objąć wszystkiego, co leży
w tym repo. Licencję można udzielić tylko do tego, do czego ma się prawa. Kod
jest mój i idzie na MIT. **Dane rankingu nie są moje i nie mogę ich nikomu
licencjonować** — ten dokument mówi, co z nimi wolno, a czego nie, i nie udaje,
że sprawa jest prostsza, niż jest.

To nie jest opinia prawna. To opis stanu faktycznego i podstaw, które go dotyczą.

> **Dlaczego zastrzeżenia nie ma w samym `LICENSE`.** Plik `LICENSE` jest dosłownym,
> niezmienionym tekstem MIT — GitHub rozpoznaje licencję przez podobieństwo do wzorca
> (próg ~98%), więc kilkunastowierszowy dopisek zmieniłby wykrytą licencję na „Other"
> i projekt przestałby być widoczny jako open source. Zakres siedzi tu i w `README.md`.
> **Nie dopisuj wyjątków do `LICENSE`** — dopisz je w tym pliku.

---

## Granica

| Objęte licencją MIT | **Nieobjęte** |
|---|---|
| `src/`, `test/*.ts` | `public/worlds/**` (~137 MB, 404 pliki, 202 migawki) |
| `public/*.html`, `public/*.js` | `public/manifest.json`, `public/trends.json` |
| `docs/`, `README.md`, `AGENTS.md` | `test/fixtures/ladder-aether-p1.html`, `test/fixtures/legacy-snapshot-aether.json` |
| | `public/vendor/` → [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) |

Kolumna prawa to materiał pochodzący z margonem.pl. Kolumna lewa to program,
który go pobiera i rysuje — i tylko ona jest open source.

---

## Skąd pochodzą dane

Wyłącznie z publicznie dostępnych stron rankingu:

```
https://www.margonem.pl/ladder/<świat>/players?page=N
```

Bez logowania, bez konta, bez cookies, bez żadnego API gry, wyłącznie żądania
`GET`. Do serwisu nic nie jest zapisywane ani w grze nie jest wykonywana żadna
akcja. Szczegóły zachowania scrapera niżej.

## Czyje są

Prawa do serwisu i do bazy rankingu przysługują wydawcy Margonem (w regulaminie
serwisu: **„Usługodawca"**). Znaczenie mają dwie niezależne podstawy:

**1. Regulamin Serwisu i Gry Margonem** ([pomoc.margonem.pl](https://pomoc.margonem.pl/index/view,323)).
Wiąże każdego odwiedzającego, nie tylko zalogowanych graczy — `I.4.g)` definiuje
*Użytkownika* jako „każdą osobę korzystającą z Serwisu w jakiejkolwiek formie,
w tym przeglądając go". Istotne klauzule:

| Klauzula | Treść w skrócie |
|---|---|
| `XIX.2` | licencja na korzystanie z Serwisu obejmuje **cele osobiste** |
| `XIX.4` | zezwolenie **nie obejmuje** rozpowszechniania na innych stronach internetowych |
| `VII.2.m)` | zakaz kopiowania i rozpowszechniania Serwisu lub jego elementów |
| `VII.2.k)` | zakaz korzystania z Serwisu w **celach komercyjnych** lub politycznych |

Sekcja `VII` to „DZIAŁANIA ZABRONIONE", sekcja `XIX` to „LICENCJA NA KORZYSTANIE
Z SERWISU".

**2. Prawo sui generis do bazy danych** — ustawa o ochronie baz danych, wdrażająca
dyrektywę 96/9/WE. Chroni bazę niezależnie od praw autorskich i **niezależnie od
regulaminu**: zakazuje pobierania i wtórnego wykorzystania *istotnej części*
zawartości bazy. 202 migawki po ~586 tys. wierszy w rundzie nie są „nieistotną
częścią" w żadnej sensownej interpretacji.

**Uczciwy wniosek: publiczne udostępnianie tych danych na GitHub Pages odbywa się
bez zgody uprawnionego i nie jest objęte licencją z `XIX.2`.** Projekt istnieje
w tym stanie świadomie, jako niekomercyjne narzędzie dla społeczności gry, i jest
gotowy zniknąć na żądanie — patrz „Usunięcie danych".

## Czego ten projekt NIE udziela

Nie mam praw do danych rankingu, więc **nie udzielam do nich żadnej licencji**.
W szczególności:

- dane w `public/worlds/`, `manifest.json`, `trends.json` i zrzuty w `test/fixtures/`
  **nie są** open source, nie są public domain i nie są objęte MIT-em z `LICENSE`;
- forknięcie tego repo **nie daje** prawa do redystrybucji danych. Dostajesz kod;
  dane w forku pozostają w tej samej sytuacji prawnej, co tutaj, i odpowiadasz za
  nie sam;
- **nie wolno używać tych danych komercyjnie** — zabrania tego `VII.2.k)`
  regulaminu, a ja nie mogę zwolnić nikogo z cudzego regulaminu;
- nie udzielam żadnej gwarancji poprawności ani kompletności danych.

Jeśli potrzebujesz danych rankingu na jakiejkolwiek pewnej podstawie — pytaj
Administrację Margonem, nie mnie.

## Znaki towarowe

„Margonem" oraz nazwy światów, profesji i pozostałe oznaczenia gry są znakami
i dobrami niematerialnymi jej wydawcy. Używane są tu wyłącznie opisowo, żeby
wskazać, czego dotyczą statystyki. Projekt **nie jest** powiązany z wydawcą
Margonem, nie jest przez niego wspierany ani autoryzowany.

---

## Dane osobowe (RODO)

Migawki zawierają dane dotyczące osób fizycznych, i trzeba to nazwać wprost.
Na jedną postać zapisywane jest:

| Pole | Plik | Co to |
|---|---|---|
| `name` | `.n.json` | nick postaci |
| `charId` | `.n.json` | stabilne ID postaci z linku profilu |
| `level`, `profession`, `honor` | `.f.json` | postęp w grze |
| `days` | `.f.json` | ile dni temu konto było ostatnio online |

Nick to pseudonim, ale pseudonim powiązany z danymi o aktywności może stanowić
**dane osobowe** w rozumieniu art. 4 pkt 1 RODO, jeżeli osoba jest identyfikowalna
— a profile Margonem są publiczne i nick prowadzi do nich bezpośrednio. Pole
`days` jest przy tym daną behawioralną: mówi, kiedy konkretna osoba ostatnio grała.

Stan faktyczny, bez upiększania:

- dane pochodzą ze **źródła publicznie dostępnego**, opublikowanego przez sam
  serwis, i nie są tu w żaden sposób wzbogacane danymi z innych źródeł;
- nie zbieram adresów e-mail, IP, danych kontaktowych ani niczego poza tym, co
  ranking pokazuje każdemu odwiedzającemu;
- **`.n.json` nie jest nigdzie czytany** — dashboard filtruje i rysuje wyłącznie
  z `.f.json`; nicki leżą w repo jako materiał na przyszłą wyszukiwarkę, której
  nie ma;
- brak formalnej noty o przetwarzaniu, wskazanego administratora i udokumentowanej
  podstawy prawnej to **znana luka**, nie przeoczenie ukryte pod dywanem.

### Usunięcie danych

Jeżeli jesteś graczem i nie chcesz, aby Twój nick lub `charId` znajdowały się
w tym repozytorium — **napisz, usunę.** Bez pytań o powód, bez uzasadniania.

Jeżeli reprezentujesz wydawcę Margonem i chcesz, aby dane lub cały dashboard
zniknęły — **napisz, wyłączam.** Nie będę tego przeciągał ani negocjował.

**Kontakt:** mikololo26@gmail.com
lub zgłoszenie w [Issues](https://github.com/KamilGrocholski/chary/issues).

Uwaga techniczna: dane historyczne rankingu są nieodtwarzalne (serwis nie
udostępnia historii), więc usunięcie jest nieodwracalne. To nie jest argument
przeciw usunięciu — to informacja, że nie ma po nim drogi powrotnej.

---

## Jak zachowuje się scraper

Zapisane tu, bo dobra wiara jest sprawdzalna w kodzie, nie deklaratywna:

| | |
|---|---|
| Ścieżki | tylko `/ladder/<świat>/players` — **wypisane w [`sitemap.xml`](https://www.margonem.pl/sitemap.xml) Margonem**, czyli same zaproszone do indeksowania |
| `robots.txt` | nie zabrania `/ladder`; blokuje wyłącznie `/intro?url=`, `/intro?googlelogin=1`, `/intro?applelogin=1`, `/newintro/` |
| Tempo | 1 żądanie/s domyślnie, twarda podłoga 250 ms (`MIN_INTERVAL_MS`) |
| User-Agent | `Mozilla/5.0 (margostat scraper)` — identyfikuje się, nie podszywa pod gracza |
| Błędy | honorowany `Retry-After`, backoff 5 s → 10 s → 20 s, sufit 120 s, 3 próby na stronę |
| Uwierzytelnianie | brak — żadnego konta, logowania ani cookies |
| Kierunek | wyłącznie `GET`; zero zapisów do serwisu, zero akcji w grze |
| Częstotliwość | ręcznie, kilka razy w miesiącu (odstępy 3-17 dni), nie z crona |

Klauzula regulaminu o „Niedozwolonym Oprogramowaniu" (`VII.2.g)`) dotyczy
oprogramowania wchodzącego w interakcję z Grą przez przechwytywanie, emulowanie
lub przekierowywanie komunikacji, automatyzacji rozgrywki, modyfikowania działania
Gry i ukrywania danych identyfikacyjnych. Czytnik HTML-a rankingu, działający bez
konta i nieuczestniczący w grze, nie robi żadnej z tych rzeczy. **Problemem tego
projektu jest redystrybucja danych, a nie sposób ich pobierania** — i tak należy
czytać ten dokument.

---

## Jeśli forkujesz

1. Kod bierz swobodnie — MIT, rób co chcesz.
2. **Nie zakładaj, że dane możesz republikować.** Prawo do nich nie przechodzi
   razem z forkiem.
3. Zanim odpalisz scraper: `bun run scrape:check`, zostaw interwał na 1 s i nie
   podszywaj się UA pod przeglądarkę. Serwis, z którego korzystasz, utrzymuje
   ktoś inny za swoje pieniądze.
4. Komercyjnie — nie. Patrz `VII.2.k)`.
