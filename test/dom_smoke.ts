// Atrapa DOM-u dla warstwy widokowej. Uruchamiana w osobnym procesie przez
// trends.test.ts i dashboard.test.ts — `globalThis.document` ustawione tutaj
// sprawiłoby, że import app.js w innym pliku testowym wystartowałby dashboard
// na obcym markupie.
//
// Statyczne testy sprawdzają tylko, czy każde `el("...")` ma swój węzeł w HTML-u.
// Ten przepuszcza prawdziwe dane z public/ przez prawdziwy render, więc łapie to,
// czego tamte nie widzą: wyjątek w renderze, pustą serię, wykres bez punktów.
//
//   bun test/dom_smoke.ts trends
//   bun test/dom_smoke.ts app
//
// Atrapa musi udawać przeglądarkę w dwóch miejscach, w których kod na nią liczy:
// `<select>` po ustawieniu innerHTML sam wybiera pierwszą opcję, a
// `querySelectorAll` schodzi w głąb drzewa (checkboxy siedzą w `<label>`).

const page = process.argv[2] === "app" ? "app" : "trends";

function makeNode(id = "", tag = "") {
  const node: any = {
    id,
    tag,
    value: "",
    textContent: "",
    hidden: false,
    checked: true,
    style: {},
    children: [] as any[],
    handlers: [] as ((...args: unknown[]) => void)[],
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
      const first = value.match(/<option value="([^"]*)"/);
      if (first && !value.includes(`value="${node.value}"`)) node.value = first[1]!;
    },
  });
  return node;
}

const markup = await Bun.file(`public/${page === "app" ? "index" : "trends"}.html`).text();
const nodes: Record<string, any> = {};
for (const [, id] of markup.matchAll(/id="([^"]+)"/g)) nodes[id!] = makeNode(id!);

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

// Dashboard migawki dostaje filtry w URL-u, żeby liczby dało się porównać z `.f.json`.
const search = page === "app" ? "?world=aether&minLevel=200&maxLevel=250&prof=1,4" : "?world=fobos";

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
  location: { search, pathname: `/${page}.html`, href: "" },
  history: { replaceState() {} },
  fetch: async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => JSON.parse(await Bun.file(`public/${url}`).text()),
  }),
});

// Import uruchamia setup widoku, bo `document` już istnieje.
await import(`${process.cwd()}/public/${page === "app" ? "app" : "trends"}.js`);
await new Promise((resolve) => setTimeout(resolve, 300));

const text = (id: string) => nodes[id]!.innerHTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const result: Record<string, unknown> = { error: nodes.error!.textContent };

if (page === "app") {
  const chart = charts.professionChart;
  Object.assign(result, {
    stats: text("stats"),
    professionCheckboxes: nodes.profCheckboxes!.querySelectorAll("input").length,
    series: chart?.data.datasets.length ?? 0,
    levels: chart?.data.labels.length ?? 0,
    // Suma po wszystkich seriach = liczba graczy spełniających filtry z URL-a.
    matched:
      chart?.data.datasets.reduce(
        (sum: number, ds: { data: number[] }) => sum + ds.data.reduce((a, b) => a + b, 0),
        0,
      ) ?? 0,
    source: nodes.sourceInfo!.textContent,
    suspectHidden: nodes.suspect!.hidden,
  });
} else {
  const chartShape = (id: string) => ({
    series: charts[id]?.data.datasets.length ?? 0,
    points: charts[id]?.data.datasets[0]?.data.length ?? 0,
    title: charts[id]?.options.plugins.title.text ?? null,
    firstX: charts[id]?.data.datasets[0]?.data[0]?.x ?? null,
  });
  const fireChange = () => nodes.worldSelect!.handlers[0]!();

  Object.assign(result, {
    summary: text("summary"),
    charts: { popChart: chartShape("popChart"), actChart: chartShape("actChart"), profChart: chartShape("profChart") },
    tableRows: (nodes.changeTable!.innerHTML.match(/<tr>/g) ?? []).length,
    table: text("changeTable"),
    singlePointHidden: nodes.singlePoint!.hidden,
    suspectHidden: nodes.suspectNote!.hidden,
  });

  // Przełączenie na udział i najkrótszy próg — drugi przebieg renderu, po chart.update().
  nodes.modeSelect!.value = "udzial";
  nodes.thresholdSelect!.value = "24h";
  fireChange();
  result.afterToggle = {
    title: charts.actChart.options.plugins.title.text,
    updates: charts.actChart.updates,
    values: charts.actChart.data.datasets[0].data.map((p: { y: number }) => p.y),
  };

  // Świat z jedną migawką — poprawny stan, nie błąd.
  nodes.worldSelect!.value = "luvia";
  nodes.modeSelect!.value = "liczba";
  fireChange();
  result.singleSnapshotWorld = {
    points: charts.popChart.data.datasets[0].data.length,
    noticeHidden: nodes.singlePoint!.hidden,
    table: nodes.changeTable!.innerHTML,
  };
}

process.stdout.write(JSON.stringify(result));
