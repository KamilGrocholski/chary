// A DOM stub for the view layer. Run in a separate process by dashboard.test.ts —
// a `globalThis.document` set here would make importing app.js in another test file start
// the view on somebody else's markup.
//
// The static tests only check that every `el("...")` has its node in the HTML. This one
// puts real data from public/ through the real render, so it catches what those cannot
// see: an exception in the render, an empty series, a chart with no points.
//
//   bun test/dom-smoke.ts default    — the default filter: history from trends.json
//   bun test/dom-smoke.ts filtered   — a filter set: history from raw .f.json
//
// The stub has to imitate a browser in the two places the code relies on it: a `<select>`
// picks the first option by itself once innerHTML is set, and `querySelectorAll` descends
// through the tree (the checkboxes sit inside `<label>`s).

const scenario = process.argv[2] === "filtered" ? "filtered" : "default";

function composeNode(id = "", tag = "") {
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
    addEventListener(_event: string, handler: (...args: unknown[]) => void) {
      node.handlers.push(handler);
    },
    appendChild(child: any) {
      node.children.push(child);
      return child;
    },
    querySelectorAll(selector: string) {
      const walk = (node: any): any[] => (node.children ?? []).flatMap((child: any) => [child, ...walk(child)]);
      const inputs = walk(node).filter((child: any) => child.tag === "input");
      return selector.includes(":checked") ? inputs.filter((child: any) => child.checked) : inputs;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };

  let html = "";
  Object.defineProperty(node, "innerHTML", {
    get: () => html,
    set(value: string) {
      html = value;
      // Replacing the options clears the selection — the browser then picks the first
      // option, EVEN when the previously selected one is still on the list. The stub has to
      // be just as ruthless: a gentler version ("clear only when the choice vanished from
      // the list") hid the bug that made the view lose the chosen activity threshold.
      const first = value.match(/<option value="([^"]*)"/);
      if (first) node.value = first[1]!;
    },
  });
  return node;
}

const markup = await Bun.file("public/index.html").text();
const nodes: Record<string, any> = {};
for (const [, id] of markup.matchAll(/id="([^"]+)"/g)) nodes[id!] = composeNode(id!);

// The stub has to know the `hidden` attribute from the markup. Without it an element
// hidden in the HTML starts out visible, and `hidden === true` assertions pass only because
// that is the node's default — i.e. they hold nothing.
for (const tag of markup.matchAll(/<[a-z][^>]*\bid="([^"]+)"[^>]*>/g)) {
  if (/\shidden[\s>/]/.test(tag[0])) nodes[tag[1]!]!.hidden = true;
}

/**
 * A response the way a browser hands one over: a body, read as text, parsed by the caller.
 *
 * ⚠️ The stub used to answer with `{ ok, status, json }` and no `text()` at all — narrower
 * than the thing it stands in for, so the day the view started reading a body as text
 * before parsing it, 25 assertions failed against code a browser runs correctly. A stub
 * that cannot do what a browser does holds nothing about the browser (AGENTS.md §9.6).
 */
function composeResponse(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

// How many times each URL was fetched. A snapshot fetched twice is not a detail:
// gordion's history is 1.9 MB, and without an "already in flight" guard every keystroke in
// a filter field started its own full set of fetches.
const fetchCounts = new Map<string, number>();

// URLs that are to answer with an error — the "part of the history did not arrive" path
// was never exercised, because the stub always returned `ok: true`.
const failUrls = new Set<string>();

// A world with exactly one snapshot, appended to the manifest and the trends by the stub
// rather than taken from real data — in live data such a world exists only until the second
// scrape (`luvia` had 1 snapshot, today it has 2), so a test tied to a particular world name
// breaks on every `bun run scrape`.
// The price the status line has to print while a history is in flight. Overstated on
// purpose — brutal really costs 20 KB a snapshot, and a figure that small rounds to
// something the format cannot tell apart from a rounding error. It also keeps the two
// apart: what the status prints comes from `bytes` in trends.json, never from the size of
// the file the stub actually answered with.
const BRUTAL_BYTES = 300_000;

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

// The "filtered" scenario gets its filters in the URL, so the numbers can be compared
// against `.f.json` and so the history starts without waiting for a mouse move — exactly
// like a shared link.
const search =
  scenario === "filtered" ? "?world=aether&minLevel=200&maxLevel=250&prof=1,4" : "?world=fobos";

// The theme, straight out of the stylesheet the browser would have applied. Reading it here
// rather than answering a fixed colour is the point: `getThemeTokens` asserts on a token that
// does not resolve, so a token renamed in `index.html` and not in `app.js` fails the smoke
// run instead of painting a chart with an empty string.
const rootTokens = new Map(
  [...(/:root\s*\{([\s\S]*?)\n\s*\}/.exec(markup)?.[1] ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(
    ([, name, value]) => [name!, value!.trim()],
  ),
);

Object.assign(globalThis, {
  getComputedStyle: (_element: unknown) => ({
    getPropertyValue: (name: string) => rootTokens.get(name) ?? "",
  }),
  document: {
    readyState: "complete",
    body: composeNode("body"),
    documentElement: composeNode("html"),
    getElementById: (id: string) => nodes[id] ?? null,
    createElement: (tag: string) => composeNode("", tag),
    createTextNode: (getText: string) => ({ getText }),
    addEventListener() {},
  },
  window: { Chart: FakeChart, innerWidth: 1400, innerHeight: 900 },
  Chart: FakeChart,
  // `hash` has to be here, because `writeUrlState` appends the anchor to the URL. Without
  // that field the stub would give "undefined" on both sides of the comparison — a green
  // test for code that appends the string "undefined" to the URL in a browser.
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
    // The snapshots get an artificial delay. From disk they come back in microseconds, and
    // the whole concurrent-fetch problem exists only while a fetch is IN FLIGHT — without
    // this the test passes with broken code too and holds nothing.
    if (url.endsWith(".f.json")) await new Promise((resolve) => setTimeout(resolve, 100));
    if (failUrls.has(url)) return composeResponse(503, "");
    if (url === SMOKE_ENTRY.filters) return composeResponse(200, JSON.stringify(SMOKE_FILTERS));

    if (url === "manifest.json") {
      const manifest = JSON.parse(await Bun.file(`public/${url}`).text());
      manifest.worlds.push({ name: SMOKE_WORLD, files: [SMOKE_ENTRY] });
      return composeResponse(200, JSON.stringify(manifest));
    }

    if (url === "trends.json") {
      const trends = JSON.parse(await Bun.file(`public/${url}`).text());
      trends.worlds.brutal.bytes = BRUTAL_BYTES;
      trends.worlds[SMOKE_WORLD] = {
        id: [SMOKE_ENTRY.id],
        startedAt: [SMOKE_ENTRY.startedAt],
        total: [3],
        act: [[1], [1], [0], [0], [1]],
        byProf: [[2], [1], [0], [0], [0], [0]],
        suspect: [0],
        bytes: 1_000,
      };
      return composeResponse(200, JSON.stringify(trends));
    }

    return composeResponse(200, await Bun.file(`public/${url}`).text());
  },
});

const trends = JSON.parse(await Bun.file("public/trends.json").text());
const worldName = scenario === "filtered" ? "aether" : "fobos";
const expectedPoints = trends.worlds[worldName].total.length;

async function waitFor(check: () => boolean, timeoutMs = 20_000) {
  const started = Date.now();
  while (!check() && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// The import starts the view's setup, because `document` already exists.
await import(`${process.cwd()}/public/app.js`);

// A filtered history pulls ten `.f.json` files, so we wait for the full set of points
// rather than for a fixed time — otherwise the test would be measuring disk speed.
await waitFor(() => (charts.popChart?.data.datasets[0]?.data.length ?? 0) >= expectedPoints);
await new Promise((resolve) => setTimeout(resolve, 300));

const getText = (id: string) => nodes[id]!.innerHTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
// The ends of the time axis. They must not depend on how much of the history was fetched —
// otherwise typing a level moves the left edge of the chart under the reader.
const getAxis = (id: string) => ({
  min: charts[id]?.options.scales.x.min ?? null,
  max: charts[id]?.options.scales.x.max ?? null,
});
const getChartShape = (id: string) => ({
  series: charts[id]?.data.datasets.length ?? 0,
  points: charts[id]?.data.datasets[0]?.data.length ?? 0,
  title: charts[id]?.options.plugins.title.text ?? null,
  label: charts[id]?.data.datasets[0]?.label ?? null,
  firstX: charts[id]?.data.datasets[0]?.data[0]?.x ?? null,
  lastY: charts[id]?.data.datasets[0]?.data.at(-1)?.y ?? null,
});

const result: Record<string, unknown> = {
  error: nodes.error!.textContent,
  matchLine: getText("matchLine"),
  stats: getText("stats"),
  summary: getText("summary"),
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
  // The sum across every histogram series = the number of players matching the URL's filters.
  matched:
    charts.professionChart?.data.datasets.reduce(
      (sum: number, dataset: { data: number[] }) => sum + dataset.data.reduce((left, right) => left + right, 0),
      0,
    ) ?? 0,
  charts: {
    popChart: getChartShape("popChart"),
    actChart: getChartShape("actChart"),
    profChart: getChartShape("profChart"),
  },
  tableRows: (nodes.changeTable!.innerHTML.match(/<tr>/g) ?? []).length,
  // The table runs newest first, so the OLDEST snapshot is its last row — the one that
  // used to be absent altogether. Cells as text, so the test can compare the population
  // against trends.json rather than against the view's own output.
  oldestTableRow: [...(nodes.changeTable!.innerHTML.match(/<tr>[\s\S]*?<\/tr>/g) ?? [])]
    .at(-1)!
    .split(/<\/?td[^>]*>/)
    .map((cell: string) => cell.replace(/<[^>]*>/g, "").trim())
    .filter((cell: string) => cell !== ""),
  table: getText("changeTable"),
  tableHidden: nodes.changeTable!.hidden,
};

if (scenario === "default") {
  // Switching to share and the shortest threshold — a second render pass, after chart.update().
  nodes.modeSelect!.value = "udzial";
  nodes.thresholdSelect!.value = "24h";
  nodes.modeSelect!.handlers[0]!();
  await new Promise((resolve) => setTimeout(resolve, 400));

  result.afterToggle = {
    title: charts.actChart.options.plugins.title.text,
    updates: charts.actChart.updates,
    values: charts.actChart.data.datasets[0].data.map((profession: { y: number }) => profession.y),
    // Under the default filter the population stays in counts: the population's share of
    // the population is 100% and a flat line with nothing in it.
    popTitle: charts.popChart.options.plugins.title.text,
  };

  // A world with one snapshot — a valid state, not an error. Appended by the stub
  // (SMOKE_WORLD), not taken from live data — see the comment at its definition.
  nodes.worldSelect!.value = SMOKE_WORLD;
  nodes.modeSelect!.value = "liczba";
  await nodes.worldSelect!.handlers[0]!();
  await new Promise((resolve) => setTimeout(resolve, 400));

  result.singleSnapshotWorld = {
    points: charts.popChart.data.datasets[0].data.length,
    noticeHidden: nodes.singlePoint!.hidden,
    table: nodes.changeTable!.innerHTML,
    tableHidden: nodes.changeTable!.hidden,
  };
} else {
  const getChipLabels = () =>
    [...nodes.filterChips!.innerHTML.matchAll(/<span class="chip"[^>]*>([^<]*)</g)].map((match) => match[1]);

  // The drawer starts closed and nobody toggles it once the data arrives — otherwise the
  // page would jump by the panel's height mid-load.
  result.bar = {
    chips: getChipLabels(),
    toggle: nodes.filtersToggle!.textContent,
    fieldsHidden: nodes.filterFields!.hidden,
  };

  nodes.filtersToggle!.handlers[0]!({});
  result.afterOpen = {
    fieldsHidden: nodes.filterFields!.hidden,
    expanded: nodes.filtersToggle!.attributes["aria-expanded"],
    chips: getChipLabels(),
  };

  nodes.filtersToggle!.handlers[0]!({});
  result.afterClose = {
    fieldsHidden: nodes.filterFields!.hidden,
    expanded: nodes.filtersToggle!.attributes["aria-expanded"],
  };

  // The close button on a chip clears the WHOLE group of fields, not one. The stub has no
  // real event delegation, so we call the handler with the `target` the DOM would give.
  nodes.filterChips!.handlers[0]!({ target: { dataset: { clear: "level" } } });
  await new Promise((resolve) => setTimeout(resolve, 400));
  result.afterChipClear = {
    minLevel: nodes.minLevel!.value,
    maxLevel: nodes.maxLevel!.value,
    chips: getChipLabels(),
    toggle: nodes.filtersToggle!.textContent,
  };

  const setOnline = async (value: string) => {
    nodes.onlineValue!.value = value;
    nodes.onlineValue!.handlers[0]!();
    await new Promise((resolve) => setTimeout(resolve, 500));
  };
  const getThreshold = () => ({
    value: nodes.thresholdSelect!.value,
    options: (nodes.thresholdSelect!.innerHTML.match(/<option/g) ?? []).length,
  });

  // The chosen threshold has to survive a rebuild of the option list. Replacing `innerHTML`
  // clears a select's value, so code reading it AFTER the replacement drops the user back to
  // the first option — to "< 24h", a series swinging by 14.7%.
  nodes.thresholdSelect!.value = "30d";
  nodes.thresholdSelect!.handlers[0]!();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const picked = getThreshold();

  // Narrowing: "≤ 30 dni" stops being reachable, but we must fall to the widest threshold
  // that still means something, not to the narrowest on the list.
  await setOnline("14");
  const narrowed = getThreshold();

  // Widening back: the list returns to three options, and the choice is to stay.
  await setOnline("");
  const widened = getThreshold();

  // A filter narrower than every threshold — the actives chart has nothing to show.
  await setOnline("3");

  result.thresholdSurvival = { picked, narrowed, widened };
  result.afterActivityFilter = {
    thresholdOptions: (nodes.thresholdSelect!.innerHTML.match(/<option/g) ?? []).length,
    noteHidden: nodes.thresholdNote!.hidden,
    note: getText("thresholdNote"),
    actHidden: nodes.actChartBox!.hidden,
  };

  // Switching worlds and an immediate burst of filter events — the worst realistic case:
  // the user picks a world and types a level threshold straight away. Each of those events
  // wants the history, and none of them may start a second fetch.
  // One snapshot cannot be fetched — the incomplete-history path. The second newest, by
  // position rather than by name, so a scrape round does not rename what this test breaks.
  result.priceInput = { bytesPerSnapshot: BRUTAL_BYTES };
  const brutalFiles = JSON.parse(await Bun.file("public/manifest.json").text()).worlds.find(
    (world: { name: string }) => world.name === "brutal",
  ).files as { filters: string }[];
  failUrls.add(brutalFiles.at(-2)!.filters);

  nodes.worldSelect!.value = "brutal";
  const switching = nodes.worldSelect!.handlers[0]!();

  // A sample taken immediately after calling the handler, i.e. before a single byte of the
  // new world arrives: the previous one's charts are to be cleared already.
  result.afterWorldSwitch = {
    popSeries: charts.popChart?.data.datasets.length ?? -1,
    profSeries: charts.profChart?.data.datasets.length ?? -1,
    tableRows: (nodes.changeTable!.innerHTML.match(/<tr>/g) ?? []).length,
  };

  // The events are spaced OUTSIDE the debounce (150 ms), so each reaches `ensureHistory`
  // separately — and each lands on a fetch that is still running.
  for (const value of ["2", "25", "250"]) {
    nodes.minLevel!.value = value;
    nodes.minLevel!.handlers[0]!();
    await new Promise((resolve) => setTimeout(resolve, 200));
    // Sampled mid-flight, which is the only moment the price exists: the snapshots carry a
    // 100 ms delay each and run four at a time, so after 200 ms the pass has started and is
    // nowhere near done. This is what replaced the transfer budget — nobody is stopped, so
    // the megabytes have to be named while they are being spent.
    result.loadingStatus ??= nodes.historyStatus!.textContent;
  }
  await switching;
  await waitFor(() => (charts.popChart?.data.datasets[0]?.data.length ?? 0) > 1);
  await new Promise((resolve) => setTimeout(resolve, 600));

  result.partialHistory = {
    status: nodes.historyStatus!.textContent,
    noteHidden: nodes.partialNote!.hidden,
    note: getText("partialNote"),
    points: charts.popChart?.data.datasets[0]?.data.length ?? 0,
    axis: getAxis("popChart"),
    error: nodes.error!.textContent,
  };

  // Back to the default filter: the history comes from the complete aggregate again, so the
  // failure counter has no business still describing it.
  nodes.resetBtn!.handlers[0]!();
  await new Promise((resolve) => setTimeout(resolve, 600));
  result.afterReset = {
    status: nodes.historyStatus!.textContent,
    noteHidden: nodes.partialNote!.hidden,
    points: charts.popChart?.data.datasets[0]?.data.length ?? 0,
    axis: getAxis("popChart"),
  };

  // A snapshot that failed does not enter memory, so the next filter change retries it on
  // purpose — it is excluded from the duplicate counter.
  const snapshotFetches = [...fetchCounts].filter(([url]) => url.endsWith(".f.json") && !failUrls.has(url));
  result.fetches = {
    files: snapshotFetches.length,
    maxPerFile: Math.max(...snapshotFetches.map(([, node]) => node)),
    duplicated: snapshotFetches.filter(([, node]) => node > 1).map(([url]) => url),
  };
}

process.stdout.write(JSON.stringify(result));
