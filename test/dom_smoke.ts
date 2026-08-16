// Atrapa DOM-u dla warstwy widokowej. Uruchamiana w osobnym procesie przez
// dashboard.test.ts — `globalThis.document` ustawione tutaj sprawiłoby, że import
// app.js w innym pliku testowym wystartowałby widok na obcym markupie.
//
// Statyczne testy sprawdzają tylko, czy każde `el("...")` ma swój węzeł w HTML-u.
// Ten przepuszcza prawdziwe dane z public/ przez prawdziwy render, więc łapie to,
// czego tamte nie widzą: wyjątek w renderze, pustą serię, wykres bez punktów.
//
//   bun test/dom_smoke.ts default    — filtr domyślny: historia z trends.json
//   bun test/dom_smoke.ts filtered   — filtr ustawiony: historia z surowych .f.json
//
// Atrapa musi udawać przeglądarkę w dwóch miejscach, w których kod na nią liczy:
// `<select>` po ustawieniu innerHTML sam wybiera pierwszą opcję, a
// `querySelectorAll` schodzi w głąb drzewa (checkboxy siedzą w `<label>`).

const scenario = process.argv[2] === "filtered" ? "filtered" : "default";

function makeNode(id = "", tag = "") {
  const node: any = {
    id,
    tag,
    value: "",
    textContent: "",
    hidden: false,
    disabled: false,
    checked: true,
    style: {},
    dataset: {} as Record<string, string>,
    attributes: {} as Record<string, string>,
    children: [] as any[],
    handlers: [] as ((...args: unknown[]) => void)[],
    setAttribute(name: string, value: string) {
      node.attributes[name] = value;
    },
    addEventListener(_event: string, fn: (...args: unknown[]) => void) {
      node.handlers.push(fn);
    },
    appendChild(child: any) {
      node.children.push(child);
      return child;
    },
    querySelectorAll(selector: string) {
      const walk = (n: any): any[] => (n.children ?? []).flatMap((c: any) => [c, ...walk(c)]);
      const inputs = walk(node).filter((c: any) => c.tag === "input");
      return selector.includes(":checked") ? inputs.filter((c: any) => c.checked) : inputs;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };

  let html = "";
  Object.defineProperty(node, "innerHTML", {
    get: () => html,
    set(value: string) {
      html = value;
      // Podmiana opcji zeruje wybór — przeglądarka ustawia wtedy pierwszą opcję,
      // NAWET gdy poprzednio wybrana nadal jest na liście. Atrapa musi być tak samo
      // bezwzględna: łagodniejsza wersja („zeruj tylko gdy wybór zniknął z listy”)
      // ukryła błąd, przez który widok gubił wybrany próg aktywności.
      const first = value.match(/<option value="([^"]*)"/);
      if (first) node.value = first[1]!;
    },
  });
  return node;
}

const markup = await Bun.file("public/index.html").text();
const nodes: Record<string, any> = {};
for (const [, id] of markup.matchAll(/id="([^"]+)"/g)) nodes[id!] = makeNode(id!);

// Atrapa musi znać atrybut `hidden` z markupu. Bez tego element schowany w HTML-u
// startuje jako widoczny, a asercje `hidden === true` przechodzą tylko dlatego, że
// taka jest wartość domyślna węzła — czyli nie pilnują niczego.
for (const tag of markup.matchAll(/<[a-z][^>]*\bid="([^"]+)"[^>]*>/g)) {
  if (/\shidden[\s>/]/.test(tag[0])) nodes[tag[1]!]!.hidden = true;
}

// Ile razy pobrano każdy adres. Migawka pobrana dwa razy to nie jest drobiazg:
// historia gordiona to 1,9 MB, a bez strażnika „już leci” każdy wciśnięty klawisz
// w polu filtra startował własny komplet pobrań.
const fetchCounts = new Map<string, number>();

// Adresy, które mają odpowiedzieć błędem — ścieżka „część historii nie doszła”
// nie była wykonywana ani razu, bo atrapa zawsze zwracała `ok: true`.
const failUrls = new Set<string>();

// Świat z dokładnie jedną migawką dopisany do manifestu i trendów przez atrapę,
// nie wzięty z prawdziwych danych — na żywych danych taki świat istnieje tylko do
// czasu drugiego scrapa (np. `luvia` miała 1 migawkę, dziś ma 2), więc test
// przywiązany do konkretnej nazwy świata psuje się przy każdym `bun run scrape`.
const SMOKE_WORLD = "smoke-single";
const SMOKE_ENTRY = {
  id: "smoke-only",
  startedAt: "2026-08-16T12:00:00.000Z",
  filters: `worlds/${SMOKE_WORLD}/smoke-only.f.json`,
  names: `worlds/${SMOKE_WORLD}/smoke-only.n.json`,
};
const SMOKE_FILTERS = {
  schema: 3,
  kind: "filter",
  world: SMOKE_WORLD,
  count: 3,
  startedAt: SMOKE_ENTRY.startedAt,
  level: [10, 20, 30],
  profession: [1, 2, 1],
  honor: [5, 10, -3],
  days: [0, 5, null],
};

const charts: Record<string, any> = {};
class FakeChart {
  data: any;
  options: any;
  updates = 0;
  static defaults: any = { color: "", borderColor: "", font: {} };
  constructor(canvas: { id: string }, config: any) {
    this.data = config.data;
    this.options = config.options;
    charts[canvas.id] = this;
  }
  update() {
    this.updates += 1;
  }
}

// Scenariusz „filtered” dostaje filtry w URL-u, żeby liczby dało się porównać z `.f.json`
// i żeby historia ruszyła bez czekania na ruch myszą — tak samo jak rozesłany link.
const search =
  scenario === "filtered" ? "?world=aether&minLevel=200&maxLevel=250&prof=1,4" : "?world=fobos";

Object.assign(globalThis, {
  document: {
    readyState: "complete",
    body: makeNode("body"),
    getElementById: (id: string) => nodes[id] ?? null,
    createElement: (tag: string) => makeNode("", tag),
    createTextNode: (text: string) => ({ text }),
    addEventListener() {},
  },
  window: { Chart: FakeChart, innerWidth: 1400, innerHeight: 900 },
  Chart: FakeChart,
  // `hash` musi tu być, bo `writeUrlState` doszywa kotwicę do adresu. Atrapa bez
  // tego pola dawałaby „undefined” po obu stronach porównania — czyli zielony test
  // dla kodu, który w przeglądarce dopisuje do URL-a napis „undefined”.
  location: { search, pathname: "/index.html", href: "", hash: "" },
  history: {
    replaceState(_state: unknown, _title: string, url: string) {
      (globalThis as { location: { search: string } }).location.search = new URL(
        url,
        "http://localhost",
      ).search;
    },
  },
  fetch: async (url: string) => {
    fetchCounts.set(url, (fetchCounts.get(url) ?? 0) + 1);
    // Migawki dostają sztuczne opóźnienie. Z dysku wracają w mikrosekundach, a cały
    // problem równoległych pobrań istnieje tylko wtedy, gdy pobieranie TRWA — bez tego
    // test przechodzi także z zepsutym kodem i niczego nie pilnuje.
    if (url.endsWith(".f.json")) await new Promise((resolve) => setTimeout(resolve, 100));
    if (failUrls.has(url)) return { ok: false, status: 503, json: async () => ({}) };
    if (url === SMOKE_ENTRY.filters) {
      return { ok: true, status: 200, json: async () => SMOKE_FILTERS };
    }
    if (url === "manifest.json") {
      const manifest = JSON.parse(await Bun.file(`public/${url}`).text());
      manifest.worlds.push({ name: SMOKE_WORLD, files: [SMOKE_ENTRY] });
      return { ok: true, status: 200, json: async () => manifest };
    }
    if (url === "trends.json") {
      const trends = JSON.parse(await Bun.file(`public/${url}`).text());
      trends.worlds[SMOKE_WORLD] = {
        id: [SMOKE_ENTRY.id],
        startedAt: [SMOKE_ENTRY.startedAt],
        total: [3],
        act: [[1], [1], [0], [0], [1]],
        byProf: [[2], [1], [0], [0], [0], [0]],
        suspect: [0],
      };
      return { ok: true, status: 200, json: async () => trends };
    }
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(await Bun.file(`public/${url}`).text()),
    };
  },
});

const trends = JSON.parse(await Bun.file("public/trends.json").text());
const world = scenario === "filtered" ? "aether" : "fobos";
const expectedPoints = trends.worlds[world].total.length;

async function waitFor(check: () => boolean, timeoutMs = 20_000) {
  const started = Date.now();
  while (!check() && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// Import uruchamia setup widoku, bo `document` już istnieje.
await import(`${process.cwd()}/public/app.js`);

// Filtrowana historia dociąga dziesięć plików `.f.json`, więc czekamy na komplet punktów,
// a nie na stały czas — inaczej test mierzyłby prędkość dysku.
await waitFor(() => (charts.popChart?.data.datasets[0]?.data.length ?? 0) >= expectedPoints);
await new Promise((resolve) => setTimeout(resolve, 300));

const text = (id: string) => nodes[id]!.innerHTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const chartShape = (id: string) => ({
  series: charts[id]?.data.datasets.length ?? 0,
  points: charts[id]?.data.datasets[0]?.data.length ?? 0,
  title: charts[id]?.options.plugins.title.text ?? null,
  label: charts[id]?.data.datasets[0]?.label ?? null,
  firstX: charts[id]?.data.datasets[0]?.data[0]?.x ?? null,
  lastY: charts[id]?.data.datasets[0]?.data.at(-1)?.y ?? null,
});

const result: Record<string, unknown> = {
  error: nodes.error!.textContent,
  matchLine: text("matchLine"),
  stats: text("stats"),
  summary: text("summary"),
  historyStatus: nodes.historyStatus!.textContent,
  professionCheckboxes: nodes.profCheckboxes!.querySelectorAll("input").length,
  source: nodes.sourceInfo!.textContent,
  snapshotMeta: nodes.snapshotMeta!.textContent,
  suspectHidden: nodes.suspect!.hidden,
  suspectNoteHidden: nodes.suspectNote!.hidden,
  singlePointHidden: nodes.singlePoint!.hidden,
  partialNoteHidden: nodes.partialNote!.hidden,
  thresholdNoteHidden: nodes.thresholdNote!.hidden,
  actChartHidden: nodes.actChartBox!.hidden,
  levels: charts.professionChart?.data.labels.length ?? 0,
  // Suma po wszystkich seriach histogramu = liczba graczy spełniających filtry z URL-a.
  matched:
    charts.professionChart?.data.datasets.reduce(
      (sum: number, ds: { data: number[] }) => sum + ds.data.reduce((a, b) => a + b, 0),
      0,
    ) ?? 0,
  charts: {
    popChart: chartShape("popChart"),
    actChart: chartShape("actChart"),
    profChart: chartShape("profChart"),
  },
  tableRows: (nodes.changeTable!.innerHTML.match(/<tr>/g) ?? []).length,
  table: text("changeTable"),
};

if (scenario === "default") {
  // Przełączenie na udział i najkrótszy próg — drugi przebieg renderu, po chart.update().
  nodes.modeSelect!.value = "udzial";
  nodes.thresholdSelect!.value = "24h";
  nodes.modeSelect!.handlers[0]!();
  await new Promise((resolve) => setTimeout(resolve, 400));

  result.afterToggle = {
    title: charts.actChart.options.plugins.title.text,
    updates: charts.actChart.updates,
    values: charts.actChart.data.datasets[0].data.map((p: { y: number }) => p.y),
    // Populacja przy filtrze domyślnym zostaje w liczbach: udział populacji
    // w populacji to 100% i płaska linia bez treści.
    popTitle: charts.popChart.options.plugins.title.text,
  };

  // Świat z jedną migawką — poprawny stan, nie błąd. Dopisany przez atrapę
  // (SMOKE_WORLD), nie wzięty z żywych danych — patrz komentarz przy jego definicji.
  nodes.worldSelect!.value = SMOKE_WORLD;
  nodes.modeSelect!.value = "liczba";
  await nodes.worldSelect!.handlers[0]!();
  await new Promise((resolve) => setTimeout(resolve, 400));

  result.singleSnapshotWorld = {
    points: charts.popChart.data.datasets[0].data.length,
    noticeHidden: nodes.singlePoint!.hidden,
    table: nodes.changeTable!.innerHTML,
  };
} else {
  const chipLabels = () =>
    [...nodes.filterChips!.innerHTML.matchAll(/<span class="chip"[^>]*>([^<]*)</g)].map((m) => m[1]);

  // Szuflada startuje zamknięta i nikt jej nie przełącza po dojściu danych — inaczej
  // strona przeskakiwałaby o wysokość panelu w trakcie ładowania.
  result.bar = {
    chips: chipLabels(),
    toggle: nodes.filtersToggle!.textContent,
    fieldsHidden: nodes.filterFields!.hidden,
  };

  nodes.filtersToggle!.handlers[0]!({});
  result.afterOpen = {
    fieldsHidden: nodes.filterFields!.hidden,
    expanded: nodes.filtersToggle!.attributes["aria-expanded"],
    chips: chipLabels(),
  };

  nodes.filtersToggle!.handlers[0]!({});
  result.afterClose = {
    fieldsHidden: nodes.filterFields!.hidden,
    expanded: nodes.filtersToggle!.attributes["aria-expanded"],
  };

  // Krzyżyk na chipie kasuje CAŁĄ grupę pól, nie jedno. Atrapa nie ma prawdziwej
  // delegacji zdarzeń, więc wołamy handler z takim `target`, jaki dałby DOM.
  nodes.filterChips!.handlers[0]!({ target: { dataset: { clear: "level" } } });
  await new Promise((resolve) => setTimeout(resolve, 400));
  result.afterChipClear = {
    minLevel: nodes.minLevel!.value,
    maxLevel: nodes.maxLevel!.value,
    chips: chipLabels(),
    toggle: nodes.filtersToggle!.textContent,
  };

  const setOnline = async (value: string) => {
    nodes.onlineValue!.value = value;
    nodes.onlineValue!.handlers[0]!();
    await new Promise((resolve) => setTimeout(resolve, 500));
  };
  const threshold = () => ({
    value: nodes.thresholdSelect!.value,
    options: (nodes.thresholdSelect!.innerHTML.match(/<option/g) ?? []).length,
  });

  // Wybór progu musi przeżyć przebudowę listy opcji. Podmiana `innerHTML` zeruje
  // wartość selecta, więc kod, który czyta ją PO podmianie, cofa użytkownika na
  // pierwszą opcję — czyli na „< 24h”, serię wahającą się o 14,7%.
  nodes.thresholdSelect!.value = "30d";
  nodes.thresholdSelect!.handlers[0]!();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const picked = threshold();

  // Zawężenie: „≤ 30 dni” przestaje być osiągalne, ale zejść należy na najszerszy
  // wciąż sensowny próg, a nie na najwęższy z listy.
  await setOnline("14");
  const narrowed = threshold();

  // Rozszerzenie z powrotem: lista wraca do trzech opcji, wybór ma zostać.
  await setOnline("");
  const widened = threshold();

  // Filtr węższy niż każdy próg — wykres aktywnych nie ma czego pokazać.
  await setOnline("3");

  result.thresholdSurvival = { picked, narrowed, widened };
  result.afterActivityFilter = {
    thresholdOptions: (nodes.thresholdSelect!.innerHTML.match(/<option/g) ?? []).length,
    noteHidden: nodes.thresholdNote!.hidden,
    note: text("thresholdNote"),
    actHidden: nodes.actChartBox!.hidden,
  };

  // Przełączenie świata i natychmiastowa seria zdarzeń filtra — najgorszy realny
  // przypadek: użytkownik wybiera świat i od razu wpisuje próg poziomu. Każde
  // z tych zdarzeń chce historii, a żadne nie ma prawa startować drugiego pobrania.
  // Jedna migawka nie do pobrania — ścieżka niepełnej historii.
  failUrls.add("worlds/brutal/2026-05-09T17-24-18.f.json");

  nodes.worldSelect!.value = "brutal";
  const switching = nodes.worldSelect!.handlers[0]!();

  // Próbka pobrana natychmiast po wywołaniu handlera, czyli zanim dojdzie
  // jakikolwiek bajt nowego świata: wykresy poprzedniego mają być już zgaszone.
  result.afterWorldSwitch = {
    popSeries: charts.popChart?.data.datasets.length ?? -1,
    profSeries: charts.profChart?.data.datasets.length ?? -1,
    tableRows: (nodes.changeTable!.innerHTML.match(/<tr>/g) ?? []).length,
  };

  // Zdarzenia rozstawione POZA debounce'em (150 ms), więc każde dojeżdża do
  // `ensureHistory` osobno — i każde trafia w trwające jeszcze pobieranie.
  for (const value of ["2", "25", "250"]) {
    nodes.minLevel!.value = value;
    nodes.minLevel!.handlers[0]!();
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await switching;
  await waitFor(() => (charts.popChart?.data.datasets[0]?.data.length ?? 0) > 1);
  await new Promise((resolve) => setTimeout(resolve, 600));

  result.partialHistory = {
    status: nodes.historyStatus!.textContent,
    noteHidden: nodes.partialNote!.hidden,
    note: text("partialNote"),
    error: nodes.error!.textContent,
  };

  // Powrót do filtra domyślnego: historia znów idzie z kompletnego agregatu,
  // więc licznik porażek nie ma prawa jej dalej opisywać.
  nodes.resetBtn!.handlers[0]!();
  await new Promise((resolve) => setTimeout(resolve, 600));
  result.afterReset = {
    status: nodes.historyStatus!.textContent,
    noteHidden: nodes.partialNote!.hidden,
    points: charts.popChart?.data.datasets[0]?.data.length ?? 0,
  };

  // Migawka, która padła, nie trafia do pamięci, więc kolejna zmiana filtra
  // ponawia ją celowo — z licznika duplikatów jest wyłączona.
  const snapshotFetches = [...fetchCounts].filter(([url]) => url.endsWith(".f.json") && !failUrls.has(url));
  result.fetches = {
    files: snapshotFetches.length,
    maxPerFile: Math.max(...snapshotFetches.map(([, n]) => n)),
    duplicated: snapshotFetches.filter(([, n]) => n > 1).map(([url]) => url),
  };
}

process.stdout.write(JSON.stringify(result));
