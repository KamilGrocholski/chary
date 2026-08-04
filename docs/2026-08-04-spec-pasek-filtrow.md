# Spec: filtr, który nie ucieka na górę — 2026-08-04

Po scaleniu widoków ([`2026-08-04-spec-widok-swiata.md`](2026-08-04-spec-widok-swiata.md))
jeden panel filtrów steruje **dwiema** sekcjami wyników: przekrojem wybranej migawki
i historią wszystkich. To był cały sens scalenia — i to samo zrobiło z panelu rzecz,
do której trzeba wracać, bo od filtra do danych, które się nim dostraja, jest cały ekran.

Ten dokument rozstrzyga, gdzie filtr ma mieszkać. Kodu tu nie ma — zgodnie z zasadą #3
z [`../AGENTS.md`](../AGENTS.md).

---

## Problem — zmierzony, nie odczuty

Wszystko poniżej policzone z `public/index.html` dla stanu domyślnego, bez ukrytych notek.

| pomiar przy szerokości 1400 px | wartość |
|---|---|
| wysokość całego dokumentu | **2806 px** |
| karta `.toolbar` (panel filtrów) | **278 px**, kończy się na 349 px |
| od dolnej krawędzi filtrów do **pierwszego wykresu historii** | **961 px** |
| od filtrów do tabeli zmian | **2081 px** |
| panel jako udział ekranu | **31%** przy 900 px, 26% przy 1080 px |

961 px to **1,07 wysokości ekranu** przy 900 px i 0,89 przy 1080. Innymi słowy: filtr
i pierwszy wykres, na który filtr działa, **nigdy nie są widoczne jednocześnie**.
Pętla „zmień próg poziomu → przewiń w dół → zobacz → przewiń w górę” jest wymuszona
przez układ, nie przez przyzwyczajenie.

I rzecz, która wyszła dopiero z pomiaru — **na telefonie problem jest inny i większy**:

| pomiar przy szerokości 375 px | wartość |
|---|---|
| karta `.toolbar` | **581 px** — ×2,09 względem desktopu |
| udział pierwszego ekranu, iPhone SE (667 px) | **87%** |
| `#matchLine` („Pasuje: N z M”) | **pod zgięciem** |

Winna jest siatka `.toolbar-row2`, której `@media (max-width: 720px)` w ogóle nie
nadpisuje (`public/index.html:208-214`): przy 375 px wychodzą dwie kolumny i **pięć
wierszy**, bo blok „ostatnio online” ma `grid-column: span 2`, a profesje `1 / -1`.
Na małym ekranie użytkownik dostaje najpierw formularz, a dane dopiero po przewinięciu.

---

## Dlaczego akurat tutaj boli bardziej niż w sklepie

W liście produktów wyniki zaczynają się **bezpośrednio** pod filtrem — przewinięcie
o pół ekranu pokazuje efekt. Tutaj są dwa zbiory wyników, a ten ciekawszy zaczyna się
961 px niżej. Dochodzą trzy rzeczy specyficzne dla tego widoku:

- **Wyniki lecą na żywo**, bez przycisku „Zastosuj” (debounce 150 ms), więc pętla
  sprzężenia zwrotnego jest szybka wszędzie poza tym, że trzeba ją zobaczyć.
- **Zmiana filtra potrafi pociągnąć do 1,9 MB** surowych migawek. Miejsce, w którym stoi
  filtr, jest naturalnym miejscem na stan tego pobierania.
- **Jedna liczba niesie cały kontekst** — „Pasuje: 1 749 z 79 528 (2,2%)”. Dziś wyjeżdża
  z ekranu po ~390 px i przez pozostałe 2400 px użytkownik patrzy na wykresy, nie wiedząc,
  ile wierszy je tworzy.

---

## Co mówią badania

| źródło | ustalenie | co z tego wynika |
|---|---|---|
| **Nielsen Norman Group** | przypięte nagłówki oszczędzają **~22% czasu nawigacji**, użytkownicy je preferują; mają zajmować **≤ 10% wysokości ekranu** (60-80 px na desktopie) | przypinamy — ale nie panel. 278 px to **31%**, trzy razy ponad próg |
| **Baymard Institute** | poziome paski filtrów psują się powyżej **6-8 typów filtrów**; sidebar zostaje sprawdzonym domyślnym | mamy **cztery** grupy filtrów — poziomy pasek jest w bezpiecznym zakresie |
| **Baymard Institute** | strony pokazujące aktywne filtry **naraz w panelu i jako podsumowanie nad wynikami** miały „vastly lower rate of user errors” niż te z jednym z tych wzorców | robimy **oba** — panel zostaje, pasek dokłada podsumowanie |
| **Baymard Institute** | użytkownicy **przeoczają filtry schowane** za przyciskiem „All filters” | odrzucamy szufladę na desktopie |
| **Smart Interface Design Patterns** (Vitaly Friedman) | filtry mają zostawać w tym samym miejscu, a wyniki aktualizować się obok; na małych ekranach panel zwinięty lub pełnoekranowy, z licznikiem wyników | uzasadnia osobny wzorzec mobilny |

Serwisy, na które warto patrzeć jako na dobre realizacje:

- **Allegro** — filtry w lewym pasku, aktywne wypisane nad listą. Dokładnie wzorzec
  „oba miejsca naraz”, i ten, który polski użytkownik zna z codziennego użycia.
- **Crate & Barrel** — panel chowany na żądanie, aktywne filtry stale nad wynikami.
- **Galaxus** — wyniki na żywo i mimo to jawne potwierdzenie; pokazuje, że jedno nie
  wyklucza drugiego.
- **Wayfair, Tylko** — poziomy pasek przy niewielkiej liczbie filtrów, czyli nasz przypadek.
- **Linear** — filtry jako chipy, każdy zdejmowalny, stan odzwierciedlony w URL-u.
  Margostat już ma tę drugą połowę (dziesięć parametrów round-trippuje), brakuje pierwszej.

---

## Rozważane warianty

| wariant | za | przeciw | werdykt |
|---|---|---|---|
| Przypiąć **cały** panel | zero nowego UI, zero nowych stanów | **278 px = 31% ekranu**, trzykrotnie ponad próg NN/g; na telefonie 87% | odrzucone |
| **Lewy pasek boczny** (Allegro, domyślny Baymarda) | wzorzec sprawdzony i znany, filtr zawsze widoczny, mieści dużo | zabiera **21% szerokości** (280 z 1352 px), a wykresy żyją z szerokości — histogram gordiona ma ~320 słupków na osi; przepisanie całego układu i CSS-a | odrzucone teraz, **zostaje jako droga odwrotu**, gdy filtrów przybędzie ponad próg 6-8 |
| **Szuflada / nakładka za przyciskiem** | zero stałego kosztu ekranu | Baymard: użytkownicy przeoczają ukryte filtry; tu byłyby ukryte **zawsze** | odrzucone |
| **Duplikat kontrolek w nagłówku każdej sekcji** | filtr blisko danych, których dotyczy | dwa źródła prawdy dla jednego stanu; przy trzech sekcjach trzy komplety do synchronizacji | odrzucone |
| **Kondensowany pasek przypięty po przewinięciu** | mieści się w budżecie NN/g, spełnia obie wytyczne Baymarda naraz, nie rusza szerokości wykresów, kotwice sekcji gratis | drugie miejsce pokazujące stan filtra; stały koszt ~7% ekranu | **wybrane** |

---

## Rozstrzygnięcie: kondensowany pasek

Pełny panel zostaje tam, gdzie jest. Gdy wyjedzie z ekranu, przykleja się **osobny, niski
pasek**. Budżet wysokości: **≤ 64 px**, czyli ≤ 7% ekranu 900 px — z zapasem pod progiem
NN/g.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [gordion ▾]  Pasuje: 1 749 z 79 528 (2,2%)                               │
│ ⌫Poziom ≥ 250  ⌫Honor ≤ 50 000  ⌫≤ 14 dni  ⌫Mag, Paladyn                │
│                        Filtry (4) ▾    Przekrój · Historia               │
└──────────────────────────────────────────────────────────────────────────┘
```

Zawartość, w kolejności ważności:

1. **Wybór świata** — jedyna kontrolka, która zmienia wszystko naraz, i jedyna, dla której
   powrót na górę jest naprawdę uciążliwy.
2. **„Pasuje: N z M (x%)”** — liczba niosąca kontekst całej strony.
3. **Chipy aktywnych filtrów**, każdy z `×`. To jest realizacja drugiej wytycznej Baymarda.
4. **`Filtry (4) ▾`** — rozwija pełny panel **w miejscu**, pod paskiem, bez skoku na górę.
5. **Kotwice `Przekrój · Historia`** — strona ma 2806 px i dziś nie ma żadnego sposobu,
   żeby między nimi skoczyć.
6. **Stan dociągania historii**, gdy leci („4 z 10 migawek”).

Pasek pojawia się dopiero, gdy pełny panel wyjedzie z ekranu — pilnuje tego
`IntersectionObserver` na wartowniku wstawionym nad panelem, nie próg `scrollY`.
Dzięki temu na górze strony nie ma panelu obok jego własnego streszczenia.

### Mobile dostaje własny wzorzec

Poniżej 720 px panel **startuje zwinięty**. Pierwszy ekran zaczyna się od paska
(świat + „Pasuje” + `Filtry ▾`) i od razu od danych, a nie od 581 px formularza.
To ten sam wzorzec, który Friedman opisuje dla małych ekranów, i jedyny sposób, żeby
`#matchLine` przestało być pod zgięciem.

Przy okazji `.toolbar-row2` musi wreszcie dostać regułę w `@media (max-width: 720px)` —
dziś nie ma żadnej, przez co blok „ostatnio online” z `grid-column: span 2` wymusza
drugą kolumnę nawet wtedy, gdy siatka schodzi do jednej.

---

## Co się zmienia w kodzie

- **`public/index.html`** — wartownik nad panelem, markup paska, reguły `position: sticky`
  i mobilne. `.wrap` nie ma ani `overflow`, ani `transform`, ani `contain`, więc kontenerem
  przewijania jest viewport i sticky zadziała bez sztuczek.
- **`public/app.js`** — render paska z tego samego `readFilters()`, obserwator wartownika,
  zwijanie i rozwijanie panelu, obsługa `×` przez istniejące `applyFilters()`.
- **`public/filters.js`** — nowa **czysta** funkcja `describeFilters(f) → [{ key, label }]`:
  jedyne miejsce zamieniające filtr na etykiety, testowalne bez przeglądarki. Zgodne
  z podziałem, który w tym repo już obowiązuje.
- Reużyte bez jednej zmiany: `readFilters`, `applyFilters`, `resetFilters`. Wszystkie
  sięgają po `document.getElementById`, więc **przeniesienie kontrolek pod innego rodzica
  nic nie kosztuje**.

---

## Pułapki

**Dymek histogramu wjedzie pod pasek.** `#profTooltip` to `position: fixed; z-index: 999`
doklejany do `body` (`public/app.js:196-204`), a jego klamra pozycji brzmi `if (y < 8) y = 8`.
Pasek musi mieć wyższy `z-index`, a ta klamra musi uwzględnić jego wysokość — inaczej
dymek nad górnymi słupkami schowa się za paskiem.

**Kolejność rejestracji listenerów jest kontraktem testu.** `test/dom_smoke.ts` wywołuje
**pierwszy zarejestrowany** listener węzła (`handlers[0]`). Nowe listenery na
`worldSelect`, `modeSelect`, `thresholdSelect`, `onlineValue`, `minLevel` i `resetBtn`
muszą wejść **po** istniejących, inaczej smoke test zacznie wywoływać co innego, niż myśli.

**`#profCheckboxes` musi zostać przodkiem swoich sześciu checkboxów.** Trzy funkcje robią
na nim `querySelectorAll`, a listener `change` liczy na bubbling. Kontener wolno przenieść
dokądkolwiek, ale **razem z zawartością**, i **musi zostać pusty w markupie** —
`buildProfCheckboxes` robi `appendChild` bez czyszczenia, więc statyczne checkboxy
w HTML-u dałyby dwanaście zamiast sześciu.

**Testy są ślepe na strukturę, ale nie na nazwy.** Sprawdzają wyłącznie literały
`id="..."` w pliku, więc przenoszenie i zmiana kolejności są darmowe. Za to zmiana nazwy
któregokolwiek `id` **zabija widok na starcie** — `el()` rzuca wyjątkiem.

**Chipy nie mogą być drugim źródłem prawdy.** Renderują się z `readFilters()`, a `×`
zapisuje z powrotem przez `applyFilters()`. Żadnego własnego stanu — inaczej dostajemy
dokładnie tę klasę błędu, którą audyt #3 wypisał pięć razy pod rząd.

**`[hidden] { display: none !important }` wygrywa z `position: sticky`**, a
**`.tableBox { overflow-x: auto }`** (`public/index.html:200`) tworzy własny kontener
przewijania — nic przypiętego nie może mieszkać wewnątrz `#changeTable`.

**Progi i skala to nie filtry.** `#thresholdSelect` i `#modeSelect` sterują tym, jak
historia jest narysowana, a nie tym, kto do niej wchodzi. Nie wchodzą do paska filtrów.
Przy okazji warto odnotować, że to przez nie nagłówek HISTORIA ma **83 px zamiast 39 px**
jak PRZEKRÓJ — dwa selecty wbudowane w `.section-head` z `align-items: baseline`.

**Zero zasobów zewnętrznych** — pilnuje tego test. `IntersectionObserver` jest natywny,
polyfill niepotrzebny.

---

## Wady i zalety

**Za:** filtr przestaje uciekać na górę przy stronie mającej 2806 px; „Pasuje: N z M”
jest widoczne zawsze, a nie tylko przez pierwsze 390 px; spełniamy obie wytyczne Baymarda
naraz, zamiast wybierać jedną; mieścimy się w progu NN/g z zapasem; kotwice rozwiązują
drugi problem tym samym ruchem; szerokość wykresów zostaje nietknięta; na telefonie
pierwszy ekran zaczyna się od danych, a nie od 581 px formularza.

**Przeciw:** drugie miejsce pokazujące stan filtra to drugie miejsce, które może się
rozjechać — audyt #3 pokazał, że ten projekt ma z tym realny problem. Przypięty pasek
zabiera ~7% ekranu **na stałe**, także temu, kto nie filtruje wcale. Chipy wymagają
etykiet mieszczących się w jednej linii, a przy czterech filtrach i wąskim ekranie
i tak trzeba je zwinąć do samego licznika. Zwinięty panel na telefonie to jedno dodatkowe
dotknięcie dla kogoś, kto wchodzi pierwszy raz i jeszcze nie wie, że filtry w ogóle są.

I rzecz najważniejsza — **to leczy objaw**. Strona nadal ma 2806 px, bo trzy wykresy
historii mają sztywne 320, 320 i 420 px, a nagłówek HISTORIA kolejne 83. Prawdziwe
skrócenie strony to decyzja o gęstości, której ten spec nie podejmuje i której przypięty
pasek nie zastąpi.

---

## Czego świadomie nie ma

Przepisania układu na lewy pasek boczny — zostaje jako droga odwrotu, gdy grup filtrów
przybędzie ponad próg 6-8. Przycisku „Zastosuj” — wyniki lecą na żywo z debounce'em 150 ms
i to działa. Zapisywanych zestawów filtrów. Nawigacji szerszej niż dwie kotwice.
Zmiany wysokości wykresów.
