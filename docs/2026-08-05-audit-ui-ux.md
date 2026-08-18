# Audyt #4 — interfejs: kontrast, klawiatura, geometria

2026-08-05. Pierwszy audyt tego repo, którego przedmiotem jest **warstwa wizualna
i interakcyjna**, a nie dane. Trzy poprzednie pytały, czy liczby są prawdziwe, czy filtr
nie gubi progu i czy nie pobieramy 5,7 MB zamiast 1,9 MB. Żaden nie pytał, czy widać pole
formularza i czy da się z tego widoku korzystać bez myszy.

Punkt wyjścia jest taki, że **testy tej warstwy nie dotykają**: `dashboard.test.ts`
sprawdza literały i liczby, `dom_smoke.ts` buduje atrapę regexem po `id="…"`. Zero CSS-a,
zero geometrii, zero focusa (`2026-08-04-audit-3.md:213-216`). Wszystko poniżej trzeba
było zmierzyć w przeglądarce.

---

## Metoda

Zgodnie z zasadą #1 („nie ufaj hipotezie — zmierz") nic tu nie jest oceną na oko:

- **Kontrast** — policzony ze wzoru WCAG na relatywną luminancję, dla każdej pary
  z palety osobno. Ta sama funkcja weryfikowała paletę po zmianie.
- **Geometria i zachowanie** — Firefox 140 w trybie headless, dashboard w ramce o zadanej
  szerokości (375, 800, 1440 px), pomiary przez `getBoundingClientRect` i
  `getComputedStyle` z poziomu strony nadrzędnej, wyniki odsyłane POST-em. Scenariusze
  odgrywane zdarzeniami, nie klikaniem na ślepo.
- **Zapadanie się historii** — z dławikiem 900 ms na plik migawki. Na localhoście komplet
  schodzi szybciej niż debounce 150 ms, więc bez dławika problem jest niewidoczny.
- **Glify** — wyrenderowane obok znaku spoza fontu (U+E000), żeby odróżnić „nie ma glifu"
  od „glif jest, tylko znaczy co innego".

Trzy hipotezy postawione przed pomiarem **upadły** — są niżej, w osobnej sekcji.

---

## Co było zepsute i zostało naprawione

### 1. Pole formularza nie odróżniało się od karty niczym

Zmierzone kontrasty przy palecie sprzed audytu:

| para | ratio | próg | |
|---|---|---|---|
| `--border #35353b` wobec `--panel` (ramka pola i karty) | **1,48:1** | 3:1 (SC 1.4.11) | ✗ |
| `--surface-2` wobec `--panel` (wypełnienie pola) | **1,09:1** | — | ✗ |
| `--panel` wobec `--bg` (karta wobec tła) | **1,05:1** | — | ✗ |

Czyli: pole nie odróżniało się od karty ani ramką, ani wypełnieniem, a karta od tła
praktycznie wcale — cały podział na powierzchnie trzymał się na obramowaniu o kontraście
1,48:1. Teksty były przy tym w porządku (16,09:1 i 6,87:1), więc audyt #3 sprawdzający
`--muted` niczego tu nie mógł zobaczyć: **problemem nie był tekst, tylko granice**.

Naprawa: osobna zmienna `--border-strong: #6a6a73` dla granic kontrolek i kart —
**3,37:1** wobec karty, **3,10:1** wobec wypełnienia, **3,55:1** wobec tła strony.
`--border` zostaje do rozdzielaczy w tabeli i nad nagłówkiem sekcji, gdzie próg 3:1
nie obowiązuje, bo to dekoracja.

Przy okazji: `#f2f2ef`, `#c98500` i `#e66767` były wpisane literalnie w pięciu miejscach
obok istniejących zmiennych. Doszły `--warn`, `--danger`, `--ok`.

### 2. Kontrolki nie dziedziczyły fontu

`input, select` nie ustawiały ani `font-family`, ani `font-size`, a te własności nie są
dziedziczone. Zmierzone na `#worldSelect` — głównym przełączniku całego widoku:

```
przed:  font-family: sans-serif        font-size: 13.3333px
po:     font-family: ui-sans-serif…    font-size: 14px
```

Wszystkie cztery listy i pięć pól liczbowych renderowały się krojem systemowym w rozmiarze
mniejszym niż cokolwiek innego na stronie.

### 3. Brak `color-scheme: dark`

Bez tej deklaracji przeglądarka rysuje natywne części kontrolek w jasnej skórce: strzałki
list rozwijanych, przyciski `input[type=number]`, autofill i paski przewijania. Widać to
na zrzucie sprzed zmiany — pola liczbowe w szufladzie filtrów mają jasnoszare pudełka
strzałek na ciemnym tle. Jedna linia w `:root`.

### 4. Focus ginął w dwóch miejscach — a to jedyna nawigacja bez myszy

**Escape w szufladzie filtrów.** `setFieldsOpen(false)` chowało szufladę przez
`display: none`, mając focus w środku. Przeglądarka zrzuca go wtedy na `<body>`, więc
następny Tab startował od początku dokumentu. Zmierzone po naprawie: focus wraca na
`#filtersToggle`, `aria-expanded` schodzi na `"false"`.

**Krzyżyk na chipie.** `renderChips` podmienia `innerHTML` przy **każdym** renderze, więc
naciśnięcie `×` niszczyło element, który miał focus. Skutek: **nie dało się usunąć dwóch
filtrów pod rząd z klawiatury** — po pierwszym focus lądował na `<body>`. Po naprawie
przechodzi na następny chip; zmierzona sekwencja: `level → honor → prof`, ani razu `body`.

Atrapa DOM-u tego nie sprawdzi — nie ma drzewa ani `activeElement`, a `querySelectorAll`
ignoruje selektor i zwraca same `input`y. Rozbudowa atrapy do prawdziwego drzewa jest
większą robotą niż ten obieg, więc **oba zachowania są zweryfikowane w przeglądarce**,
nie testem. To świadoma dziura, nie przeoczenie.

### 5. Chipy znikały w całości w paśmie 721-1100 px

Najciekawsze znalezisko, bo niewidoczne z kodu i nieprawdziwe na typowym desktopie.
Zmierzone przy **800 px**:

```
przed:  .chips  clientWidth 0    scrollWidth 421   (trzy chipy, zero pikseli)
po:     .chips  clientWidth 188  scrollWidth 420   (przewijalne, wszystkie osiągalne)
```

`.chips` ma `flex: 1 1 auto; min-width: 0`, a reszta paska (`select`, licznik, kotwice,
dwa przyciski) zajmowała dokładnie całą szerokość — więc flexbox ściskał chipy do zera,
a `overflow: hidden` czynił to bezgłośnym. Użytkownik między 721 a ~1100 px nie widział
ani jakie filtry są aktywne, ani krzyżyków do ich usunięcia. Poniżej 720 px chipy są
świadomie `display: none`, powyżej ~1100 mieszczą się — dziura była dokładnie w środku.

Naprawa dwuczęściowa: `overflow-x: auto` zamiast `hidden` (chip pod focusem sam wjeżdża
w kadr, więc tabulator działa), plus nowy próg 1100 px, poniżej którego ustępują kotwice
i doprecyzowanie „w tej migawce" — obie rzeczy są wygodą, a chipy niosą stan filtra.
Wysokość dokumentu bez zmian (2561 px), więc to nie kosztowało układu nic.

Doszedł też `title` na chipie, bo przy przewijaniu widać czasem połowę etykiety.

### 6. Krzyżyk na chipie był poniżej minimum WCAG 2.2

Zmierzone **21×15 px** przy progu 24×24 z SC 2.5.8. Po zmianie: **24×24**, bez zmiany
wysokości paska (56 px) — powiększenie poszło w sam guzik, nie w chipa.

### 7. Tabela przewijana w poziomie była nieosiągalna z klawiatury

Przy 375 px zmierzone: `clientWidth 333`, `scrollWidth 526` — **193 px treści za krawędzią**,
w tym kolumny „Zmiana" i „Na dobę". `.tableBox` ma `overflow-x: auto`, ale kontener bez
`tabindex` nie przyjmuje focusa, więc klawiaturą nie dało się go przewinąć (WCAG 2.1.1).
Doszedł `tabindex="0"` + `role="region"` + `aria-label`.

### 8. Stany błędu zostawiały na ekranie sprzeczne informacje

- `catch` w `init()` nie resetował `#summary` → napis „Ładowanie…" zostawał **na zawsze**
  obok czerwonego komunikatu o błędzie.
- `catch` w `loadSnapshot` nie resetował `#matchLine` → pasek pokazywał liczby
  z **poprzedniej** migawki obok informacji, że tej nie udało się pobrać.
- Treścią komunikatu był surowy wyjątek: `Failed to fetch`, `Unexpected token '<'`,
  `HTTP 500 dla worlds/gordion/2026-…f.json` — po angielsku, ze ścieżką pliku, bez
  podpowiedzi co robić.

Doszła `describeFailure`, która rozróżnia brak połączenia, kod HTTP i zepsuty JSON.
Ścieżka pliku nie znika z widoku — stoi tam, gdzie stała, czyli w polu „Plik".

### 9. Przycisk kopiowania linku — usunięty

Audyt znalazł w nim trzy usterki naraz: `await navigator.clipboard.writeText(…)` bez
`try/catch` (poza bezpiecznym kontekstem i przy odmowie uprawnień przycisk po prostu nie
reagował, a wyjątek szedł w konsolę), `aria-label` przykrywający podmienione „✓" — czyli
brak potwierdzenia dla czytnika ekranu — oraz `setTimeout` bez `clearTimeout`.

Zamiast je naprawiać, przycisk **wypadł z paska**. Cały stan widoku i tak siedzi w adresie
(`filtersToParams` + `viewToParams`, zapisywane przy każdym renderze), więc przycisk
duplikował to, co przeglądarka robi lepiej: Ctrl+L, Ctrl+C. Znikł razem z nim komplet
problemów — kopiowanie, którego nie da się zepsuć, to takie, którego nie ma. Pasek zyskał
przy okazji ~40 px, czyli miejsce dla chipów, którego brakowało w paśmie 721-1100 px.

Przy okazji upadła hipoteza o glifie `⎘` — patrz sekcja o obalonych hipotezach. Ustalenie
zostaje w notatce, bo dotyczy każdego przyszłego przycisku ikonowego, nie tego jednego.

### 10. Zero trafień wyglądało jak zepsute dane

Przy pustym wyniku `#stats` wypisywało `Wojownik: 0 · Mag: 0 · …` i `< 24h: 0 · 1-7 dni: 0 · …`
— jedenaście zer. To ta sama klasa problemu, którą `visibleActivityBuckets` rozwiązuje dla
koszyków. Teraz jest jedno zdanie. Dodatkowo `#chartEmpty` dostał przycisk resetu: jedyny
istniejący „Resetuj filtry" siedzi w **zamkniętej** szufladzie, więc wyjście z pustego
wyniku wymagało zgadnięcia, gdzie ono jest.

Przy okazji, widoczne dopiero na zrzucie: profesja **odznaczona w filtrze** też dostawała
badge „0". `profChart` rysuje tylko wybrane serie, `#stats` pokazywał wszystkie sześć.

### 11. Dwie konwencje liczbowe obok siebie

W dymku histogramu było `12.3%` i `1234`, a 40 px dalej w pasku `12,3%` i `1 234`.
W kartcie `#stats` — `10403` tuż pod `38 909`. Test pilnuje formatu **tylko dla tabeli**
(`out.table` musi pasować do `/\d,\d/`), więc dymek i statystyki się wymknęły.
Wszystko przeszło na `num()`/`dec()`.

### 12. Adres widoku gubił kotwicę i był przepisywany bez potrzeby

`writeUrlState` budowało URL jako `pathname + "?" + params` — bez `location.hash`. Klik
w „Historia", potem dowolna zmiana filtra i kotwica znikała z adresu, więc przeładowanie
wracało na górę strony.

Osobno: `replaceState` leciało przy **każdym** renderze, w tym raz na każdy pobrany plik
historii. Safari przerywa po ~100 wywołaniach na 30 s, a niełapany `SecurityError`
wywaliłby `render()` w połowie — przed `renderChips` i `renderCrossSection`. Teraz zapis
idzie tylko wtedy, gdy adres faktycznie się zmienił.

Atrapa DOM-u dostała `location.hash` i `replaceState`, które naprawdę aktualizuje
`location.search`. Bez tego obie strony porównania byłyby `undefined` — czyli zielony test
dla kodu dopisującego do adresu napis „undefined". To dokładnie ta pułapka, o której mówi
audyt #3: atrapa łagodniejsza od przeglądarki produkuje zielone testy dla zepsutego kodu.

### 13. Braki semantyczne i drobiazgi

- Zero `<main>` i zero skip-linka — cała treść wisiała w bezimiennym `<div class="wrap">`,
  za paskiem filtrów. Przy 2561 px dokumentu to znaczy, że czytnik ekranu i klawiatura
  przechodziły przez komplet kontrolek, zanim doszły do danych.
- `<label>Plik</label>` i `<label>Profesja</label>` nie miały `for` i nie zawijały niczego
  — etykietowały `<div>`, czyli nic. Zostały `<span class="field-title">`.
- Sześć checkboxów profesji nie było grupą: `role="group"` + `aria-labelledby`.
- Chart.js ładował się bez `defer`, blokując parser przed całym `<body>`.
- Brak `<noscript>` przy widoku renderowanym w 100% z JS-u.
- Brak `theme-color`, brak stylu dla `<code>` (używanego w notce o `suspect`).
- `scroll-margin-top: 76px` i `max-height: calc(100vh - 90px)` były liczone dla paska
  56 px, a na telefonie pasek ma 88 px — kotwica lądowała pod paskiem, szuflada mogła
  wyjść poniżej ekranu. Doszły wartości dla progu 720 px, a `vh` zmieniło się na `dvh`,
  bo pasek adresu na telefonie nie mieści się w `100vh`.
- Wariant domyślnego `button` (biały na akcencie) miał **3,64:1**, czyli poniżej AA — i nie
  miał ani jednego użytkownika, bo wszystkie przyciski są `.ghost-btn` albo `.reset-btn`.
  Usunięty; domyślny przycisk wygląda teraz jak `.ghost-btn`, żeby następny dodany nie
  wrócił po cichu do wariantu, który nie przechodzi kontrastu.
- Debounce 150 ms obejmował też `change` na listach (`#thresholdSelect`, `#modeSelect`,
  `#onlinePreset`) i kliknięcie „Resetuj filtry". Debounce istnieje dla pisania w polu;
  dla wyboru z listy to była wyłącznie zwłoka. Doszło `renderNow()`.

---

## Hipotezy, które upadły w zderzeniu z pomiarem

**„Glif `⎘` renderuje się jako pusty kwadrat."** Nie. Wyrenderowany obok U+E000 (znaku,
którego na pewno nie ma w żadnym foncie) widać różnicę: U+E000 to pudełko z kodem
szesnastkowym, a U+2398 to **prawdziwy glif**. Problem był inny i gorszy, bo nie rzuca
się w oczy: U+2398 NEXT PAGE przedstawia **kartkę ze strzałką, czyli przewracanie strony**,
a nie kopiowanie. Sam przycisk ostatecznie zniknął (punkt 9), ale dwa ustalenia z tego
pomiaru zostają na przyszłość: „glif się rysuje" nie znaczy „glif znaczy to, co trzeba",
a kodowe punkty **emoji** (🗐, 🔗) odpadają z tego interfejsu z innego powodu —
przeglądarka rysuje je fontem kolorowym, więc ignorują kolor akcentu. Monochromatyczny
odpowiednik kopiowania to U+29C9 „⧉".

**„Między nagłówkiem HISTORIA a pierwszym wykresem stoi do pięciu kart z notkami."**
Nie w stanie domyślnym. Zmierzone: **73 px** przy 1440 px (jedna notka, `#onlineNote`)
i **171 px** przy 375 px, gdzie ta sama notka zawija się na kilka linii. Pięć notek naraz
jest możliwe, ale nie jest stanem, w którym ktokolwiek zwykle jest.

**„Po pierwszym znaku w filtrze wykresy historii zapadają się na kilka sekund."**
Na localhoście **nie da się tego zobaczyć** — komplet 10 migawek aethera schodzi szybciej
niż debounce 150 ms. Dopiero z dławikiem 900 ms na plik widać, co dzieje się na realnym
łączu:

```
   0 ms   10 punktów   (agregat trends.json)
 250 ms    1 punkt     ⏳ „Historia dopełnia się w tle” (1 z 10)
1500 ms    5 punktów   (concurrency 4)
2250 ms    9 punktów
3000 ms   10 punktów
```

Czyli zapadnięcie **jest prawdziwe** — przez ~1,3 s wykres ma jeden punkt zamiast dziesięciu
— ale hipoteza „kilka sekund pustki bez wyjaśnienia" była fałszywa: stan jest opisany
notką od pierwszej klatki i odbudowuje się schodkami. Zostawione jako dług (D2 niżej),
bo alternatywa łamie zasadę „brakującym punktom nie podstawiamy niczego zmyślonego".

---

## Geometria — liczby przed i po

Pomiary w Firefoksie, ramka o zadanej szerokości, filtr domyślny o ile nie napisano inaczej.

| | 1440 px | 800 px | 375 px |
|---|---|---|---|
| wysokość dokumentu | 2561 px | 2606 px | 2628 px |
| wysokość paska filtrów | 56 px | 56 px | 88 px |
| od filtra do 1. wykresu historii | **973 px** | 1018 px | **1268 px** |
| notki przed 1. wykresem historii | 73 px | 93 px | 171 px |
| tabela: treść / kontener | 1350 / 1350 | 738 / 738 | **526 / 333** |
| chipy: widoczne / potrzebne (3 filtry) | 575 / 575 | **188 / 420** (było 0 / 421) | ukryte |
| krzyżyk na chipie | 24×24 (było 21×15) | 24×24 | — |

973 px przy ekranie 900 px potwierdza założenie specu paska filtrów: **filtr i pierwszy
wykres, na który filtr działa, nigdy nie są widoczne naraz.** Na telefonie to 1268 px przy
812 px ekranu, czyli 1,56 ekranu.

Ukrycie `#actChartBox` przy progu „< 24h" przesuwa wszystko poniżej o zmierzone
**359 px** (wysokość dokumentu 2561 → 2202). Zostawione jako dług.

---

## Dług — świadomie poza tym obiegiem

| # | Rzecz | Dlaczego nie teraz |
|---|---|---|
| D1 | **Pasek nie mówi nic o transferze.** Wpisanie jednej cyfry startuje do 8,7 MB surowo / ~1,8 MB gzip dla gordiona. Postęp stoi w `#historyStatus` ~1000 px niżej i liczy migawki, nie bajty. Anulowania nie ma — `AbortController` nie występuje w `public/` ani raz; reset filtrów zeruje licznik, ale pliki lecą do końca. | Pasek ma sztywną wysokość i `nowrap`, a właśnie zabrakło w nim miejsca na chipy. Dołożenie wskaźnika to decyzja, co z paska wypada — czyli spec, nie poprawka. |
| D2 | **Historia zapada się do jednego punktu na ~1,3 s** po pierwszym znaku (zmierzone wyżej). | Jedyna alternatywa to rysować agregat pod spodem, co łamie zasadę „nie podstawiamy niczego zmyślonego". Wymaga specu. |
| D3 | **Przycisk Wstecz nie działa** — tylko `replaceState`, zero `pushState`, brak `popstate`. Dług otwarty od audytu #3. | Zmiana zachowania nawigacji z własnym zestawem testów. |
| D4 | **Na telefonie nadal nie widać, które filtry są aktywne** — chipy są `display: none` poniżej 720 px, zostaje licznik „Filtry (N)". | Naprawa kosztuje wysokość paska, którą spec ograniczył do 13,2% ekranu 667 px. |
| D5 | Preset aktywności rozjeżdża się z polem liczbowym: wpisanie `5` zostawia listę na „7 dni". | Dług z audytu #3, wciąż otwarty. |
| D6 | Ukrycie `#actChartBox` przesuwa stronę o **359 px**. | Wymaga decyzji: rezerwować miejsce czy przenieść próg gdzie indziej. |
| D7 | Pamięć światów jest **FIFO, nie LRU** — `cache.delete(cache.keys().next().value)` usuwa najwcześniej wstawiony, więc sekwencja A→B→A→C wyrzuca właśnie oglądane A i powrót kosztuje 8,7 MB drugi raz. | Jednolinijkowa naprawa, ale bez testu na to nie ma sensu — a test wymaga scenariusza z czterema światami. |
| D8 | Dymek histogramu działa tylko na `mousemove` — **na telefonie wykres profesji nie ujawnia żadnych liczb**. | Wymaga decyzji o wzorcu dotykowym, nie samego kodu. |
| D9 | Cała treść informacyjna to 12-13 px; `label` globalnie 12 px w `--muted`. | Podniesienie skali zmienia gęstość całej strony, w tym sztywnej wysokości paska. |
| D10 | Wykresy nie mają alternatywy tekstowej — `aria-label` opisuje typ wykresu, nie dane. Tabela pokrywa tylko populację. | Osobny temat: co znaczy „dostępna wersja wykresu rozkładu poziomów". |
| D11 | `minLevel > maxLevel` daje „Brak graczy spełniających filtry" zamiast „zakres jest odwrócony"; tekst w polu `type=number` cicho kasuje filtr; `?prof=99` cicho podstawia wszystkie sześć. | Trzy różne rodzaje cichej degradacji, każdy z własną decyzją, co pokazać. |
| D12 | `profChart` nie oznacza migawek `suspect`, choć dwa pozostałe to robią. `404.html:26` ma `href="/"`, co na project-Pages wyprowadza poza projekt. | Dwa drobiazgi z audytu #3, wciąż otwarte. |

Nie ruszone świadomie, bo odrzucone w `2026-08-04-spec-filter-bar.md:246-251`: lewy
pasek boczny, przycisk „Zastosuj", zapisywane zestawy filtrów, nawigacja szersza niż dwie
kotwice, zmiana wysokości wykresów.

---

## Czego ten audyt nie sprawdził

- **Prawdziwego czytnika ekranu.** Sprawdzone są atrybuty i kolejność focusa, nie to, co
  naprawdę mówi NVDA czy VoiceOver.
- **Innych przeglądarek.** Wszystko mierzone w Firefoksie 140. `dvh`, `color-scheme`
  i `scrollbar-width` mają dobre wsparcie, ale nie zostały potwierdzone w Safari, a to
  właśnie Safari ma limit `replaceState`, przed którym zabezpiecza jedna z poprawek.
- **Prawdziwego urządzenia dotykowego.** Rozmiary celów są zmierzone, ale trafialność nie.
- **Wydajności renderu.** `render()` przebudowuje przez `innerHTML` pięć do ośmiu bloków
  co 150 ms podczas pisania, a `buildFilteredTrend` przelicza całą historię od zera przy
  każdym renderze. Nie zmierzone, nie zgłoszone jako problem — tylko odnotowane.

---

## Weryfikacja

- `bun test` — 184 testy zielone (`dom_smoke.ts` zmieniony w dwóch miejscach: `location.hash`
  i `replaceState`, który naprawdę aktualizuje `location.search`, plus regex chipów
  przepuszczający atrybut `title`).
- `bun run typecheck` — czysto.
- Skrypt kontrastu po zmianie palety: **14 par, wszystkie przechodzą** — teksty ≥ 4,5:1,
  granice kontrolek ≥ 3:1.
- Przeglądarka: Escape oddaje focus przyciskowi „Filtry", dwa chipy usuwalne pod rząd
  z klawiatury, tabela przyjmuje focus, pole ma `ui-sans-serif` 14 px i ramkę
  `rgb(106,106,115)`, `color-scheme` = `dark`, pusty wynik pokazuje zdanie i działający
  przycisk resetu.
