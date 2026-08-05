# docs/ — audyty i notatki

Datowane zapisy z konkretnych obiegów pracy: co sprawdzono, co naprawiono, co świadomie
zostawiono na później. To kontekst decyzji, nie bieżąca dokumentacja — nie aktualizuj starych
notatek, dopisuj nowe.

Zaczynasz pracę nad projektem? Najpierw [`../AGENTS.md`](../AGENTS.md), nie ten katalog.

| Plik | Po co |
|---|---|
| [`2026-08-01-audyt.md`](2026-08-01-audyt.md) | Audyt #1: czy dane są prawdziwe (są — zweryfikowane wobec żywego rankingu), co było zepsute, co usunięte, czego brakuje. |
| [`2026-08-01-audyt-2.md`](2026-08-01-audyt-2.md) | Audyt #2 po naprawach: co się obroniło, co poprawione, **dług na przyszłość i lista pomysłów**. |
| [`2026-08-01-budzet-rozmiaru.md`](2026-08-01-budzet-rozmiaru.md) | Ile rund scrapa zostało do limitu 1 GB na Pages (~65 ≈ 2 lata) i co zrobić, gdy się skończy. |
| [`2026-08-04-spec-trendy.md`](2026-08-04-spec-trendy.md) | Spec widoku trendów jednego świata w czasie: co pokazać, `trends.json` (**9,0 KB gzip na całą historię**), pułapki metryki „ostatnio online”. |
| [`2026-08-04-spec-widok-swiata.md`](2026-08-04-spec-widok-swiata.md) | Spec scalenia obu widoków w jeden per świat i filtrowania **całej historii** po stronie klienta (**7 ms na 813 tys. wierszy, zero bajtów do limitu Pages**). |
| [`2026-08-04-audyt-3.md`](2026-08-04-audyt-3.md) | Audyt #3 po scaleniu widoków: **osiem błędów, których nie łapało 165 testów**, atrapa DOM-u łagodniejsza od przeglądarki, dług i lista pomysłów. |
| [`2026-08-04-spec-pasek-filtrow.md`](2026-08-04-spec-pasek-filtrow.md) | Spec przypiętego paska filtrów: strona ma **2806 px**, a na telefonie panel zjada **87% pierwszego ekranu**. Warianty, badania (NN/g, Baymard) i przykłady z innych serwisów. |
| [`2026-08-05-audyt-ui-ux.md`](2026-08-05-audyt-ui-ux.md) | Audyt #4, pierwszy o interfejsie: granice kontrolek miały **1,48:1** przy progu 3:1, chipy znikały do **0 px** w paśmie 721-1100 px, focus ginął przy Escape i przy krzyżyku na chipie. Plus trzy hipotezy obalone pomiarem. |

Nazwy plików: `RRRR-MM-DD-<temat>.md`. Nową notatkę dopisz do tabeli wyżej **oraz** do sekcji
„Co czytać dalej” w [`../AGENTS.md`](../AGENTS.md) — inaczej nikt jej nie znajdzie.
