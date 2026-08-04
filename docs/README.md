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

Nazwy plików: `RRRR-MM-DD-<temat>.md`. Nową notatkę dopisz do tabeli wyżej **oraz** do sekcji
„Co czytać dalej” w [`../AGENTS.md`](../AGENTS.md) — inaczej nikt jej nie znajdzie.
