// The view layer put through a real DOM. Run in a separate process by dashboard.test.ts —
// registering happy-dom's globals here would make importing app.ts in another test file
// start the view on somebody else's markup.
//
// The static tests only check that every `getElement("...")` has its node in the HTML. This
// one puts real data from public/ through the real render, so it catches what those cannot
// see: an exception in the render, an empty series, a chart with no points.
//
//   bun test/dom-smoke.ts default    — the default filter: history from trends.json
//   bun test/dom-smoke.ts filtered   — a filter set: history from raw .f.json
//
// ⚠️ This used to be a hand-written stub of the DOM, and §9.6 records what that cost: a
// `<select>` that kept its value when a browser would have dropped it, and no event
// delegation, so a chip's close button had to be tested by calling a listener with a
// hand-made `{ target: { dataset: { clear } } }`. What is stubbed now is only what is not a
// document: the network, and Chart.js — which wants a canvas and paints pixels nothing here
// would read.

import { GlobalRegistrator } from "@happy-dom/global-registrator";

const scenario = process.argv[2] === "filtered" ? "filtered" : "default";

// The "filtered" scenario gets its filters in the URL, so the numbers can be compared
// against `.f.json` and so the history starts without waiting for a mouse move — exactly
// like a shared link.
const search =
  scenario === "filtered" ? "?world=aether&minLevel=200&maxLevel=250&prof=1,4" : "?world=fobos";

await GlobalRegistrator.register({ url: `http://localhost/index.html${search}` });

// The markup a browser would have parsed, minus its two `<script>` tags: Chart.js is
// replaced below and `app.js` is imported from source, so letting happy-dom try to fetch
// either would only produce a load error for a file this run does not use.
const markup = await Bun.file("public/index.html").text();
document.write(markup.replace(/<script\b[\s\S]*?<\/script>/g, ""));

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
// was never exercised while the stub always returned `ok: true`.
const failUrls = new Set<string>();

// The price the status line has to print while a history is in flight. Overstated on
// purpose — brutal really costs 20 KB a snapshot, and a figure that small rounds to
// something the format cannot tell apart from a rounding error. It also keeps the two
// apart: what the status prints comes from `bytes` in trends.json, never from the size of
// the file the stub actually answered with.
const BRUTAL_BYTES = 300_000;

// A world with exactly one snapshot, appended to the manifest and the trends by the stub
// rather than taken from real data — in live data such a world exists only until the second
// scrape (`luvia` had 1 snapshot, today it has 2), so a test tied to a particular world name
// breaks on every `bun run scrape`.
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

// Chart.js wants a canvas and paints pixels nothing here would read, so what stands in for
// it records the config it was handed. That config IS the subject: which series, how many
// points, what the axis ends are.
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

Object.assign(globalThis, {
  Chart: FakeChart,
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

const node = (id: string) => document.getElementById(id)!;
const field = (id: string) => node(id) as HTMLInputElement | HTMLSelectElement;
const send = (id: string, type: string) => node(id).dispatchEvent(new Event(type, { bubbles: true }));
const settle = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const trends = JSON.parse(await Bun.file("public/trends.json").text());
const worldName = scenario === "filtered" ? "aether" : "fobos";
const expectedPoints = trends.worlds[worldName].total.length;

async function waitFor(check: () => boolean, timeoutMs = 20_000) {
  const started = Date.now();
  while (!check() && Date.now() - started < timeoutMs) await settle(20);
}

// The import starts the view's setup, because `document` already exists.
// The source, not `public/app.js`: the bundle is built and gitignored, so importing it
// would make `bun test` pass or fail on whether somebody had run `bun run build`.
await import(`${process.cwd()}/web/app.ts`);

// A filtered history pulls ten `.f.json` files, so we wait for the full set of points
// rather than for a fixed time — otherwise the test would be measuring disk speed.
await waitFor(() => (charts.popChart?.data.datasets[0]?.data.length ?? 0) >= expectedPoints);
await settle(300);

// Tags become spaces rather than nothing: `<td>3</td><td>4</td>` reads as "3 4", not "34".
const getText = (id: string) => node(id).innerHTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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
const getTableRows = () => [...node("changeTable").querySelectorAll("tr")];

const result: Record<string, unknown> = {
  error: node("error").textContent,
  matchLine: getText("matchLine"),
  stats: getText("stats"),
  summary: getText("summary"),
  historyStatus: node("historyStatus").textContent,
  professionCheckboxes: node("profCheckboxes").querySelectorAll("input").length,
  source: node("sourceInfo").textContent,
  snapshotMeta: node("snapshotMeta").textContent,
  suspectHidden: node("suspect").hidden,
  suspectNoteHidden: node("suspectNote").hidden,
  singlePointHidden: node("singlePoint").hidden,
  partialNoteHidden: node("partialNote").hidden,
  thresholdNoteHidden: node("thresholdNote").hidden,
  actChartHidden: node("actChartBox").hidden,
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
  tableRows: getTableRows().length,
  // The table runs newest first, so the OLDEST snapshot is its last row — the one that
  // used to be absent altogether. Cells as text, so the test can compare the population
  // against trends.json rather than against the view's own output.
  oldestTableRow: [...(getTableRows().at(-1)?.querySelectorAll("td") ?? [])]
    .map((cell) => cell.textContent?.trim() ?? "")
    .filter((cell) => cell !== ""),
  table: getText("changeTable"),
  tableHidden: node("changeTable").hidden,
};

if (scenario === "default") {
  // Switching to share and the shortest threshold — a second render pass, after chart.update().
  field("modeSelect").value = "udzial";
  field("thresholdSelect").value = "24h";
  send("modeSelect", "change");
  await settle(400);

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
  field("worldSelect").value = SMOKE_WORLD;
  field("modeSelect").value = "liczba";
  send("worldSelect", "change");
  await waitFor(() => node("changeTable").hidden);
  await settle(400);

  result.singleSnapshotWorld = {
    points: charts.popChart.data.datasets[0].data.length,
    noticeHidden: node("singlePoint").hidden,
    table: node("changeTable").innerHTML,
    tableHidden: node("changeTable").hidden,
  };
} else {
  // The chip's own text, not its close button's — `textContent` on the whole chip reads
  // "Poziom 200-250×", which is not a label anybody sees as one.
  const getChipLabels = () =>
    [...node("filterChips").querySelectorAll(".chip")].map((chip) => chip.firstChild?.textContent ?? "");

  // The drawer starts closed and nobody toggles it once the data arrives — otherwise the
  // page would jump by the panel's height mid-load.
  result.bar = {
    chips: getChipLabels(),
    toggle: node("filtersToggle").textContent,
    fieldsHidden: node("filterFields").hidden,
  };

  node("filtersToggle").click();
  result.afterOpen = {
    fieldsHidden: node("filterFields").hidden,
    expanded: node("filtersToggle").getAttribute("aria-expanded"),
    chips: getChipLabels(),
  };

  node("filtersToggle").click();
  result.afterClose = {
    fieldsHidden: node("filterFields").hidden,
    expanded: node("filtersToggle").getAttribute("aria-expanded"),
  };

  // The close button on a chip clears the WHOLE group of fields, not one — and the click
  // lands on the button, which is what makes this a test of the delegation in `app.ts`
  // rather than of a listener called by hand.
  (node("filterChips").querySelector('[data-clear="level"]') as HTMLElement).click();
  await settle(400);
  result.afterChipClear = {
    minLevel: field("minLevel").value,
    maxLevel: field("maxLevel").value,
    chips: getChipLabels(),
    toggle: node("filtersToggle").textContent,
  };

  const setOnline = async (value: string) => {
    field("onlineValue").value = value;
    send("onlineValue", "input");
    await settle(500);
  };
  const getThreshold = () => ({
    value: field("thresholdSelect").value,
    options: node("thresholdSelect").querySelectorAll("option").length,
  });

  // The chosen threshold has to survive a rebuild of the option list. Replacing `innerHTML`
  // clears a select's value, so code reading it AFTER the replacement drops the user back to
  // the first option — to "< 24h", a series swinging by 14.7%.
  field("thresholdSelect").value = "30d";
  send("thresholdSelect", "change");
  await settle(400);
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
    thresholdOptions: node("thresholdSelect").querySelectorAll("option").length,
    noteHidden: node("thresholdNote").hidden,
    note: getText("thresholdNote"),
    actHidden: node("actChartBox").hidden,
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
  const failedUrl = brutalFiles.at(-2)!.filters;
  failUrls.add(failedUrl);

  field("worldSelect").value = "brutal";
  send("worldSelect", "change");

  // A sample taken immediately after the event, i.e. before a single byte of the new world
  // arrives — a listener runs synchronously up to its first `await`, so this is the same
  // moment the browser is in. The previous world's charts are to be cleared already.
  result.afterWorldSwitch = {
    popSeries: charts.popChart?.data.datasets.length ?? -1,
    profSeries: charts.profChart?.data.datasets.length ?? -1,
    tableRows: getTableRows().length,
  };

  // The events are spaced OUTSIDE the debounce (150 ms), so each reaches `ensureHistory`
  // separately — and each lands on a fetch that is still running.
  for (const value of ["2", "25", "250"]) {
    field("minLevel").value = value;
    send("minLevel", "input");
    await settle(200);
    // Sampled mid-flight, which is the only moment the price exists: the snapshots carry a
    // 100 ms delay each and run four at a time, so after 200 ms the pass has started and is
    // nowhere near done. This is what replaced the transfer budget — nobody is stopped, so
    // the megabytes have to be named while they are being spent.
    result.loadingStatus ??= node("historyStatus").textContent;
  }
  // Until the pass is over, not until a fixed time: a real event hands back no promise to
  // await, so what says "done" is the status line dropping its progress text.
  await waitFor(() => !(node("historyStatus").textContent ?? "").includes("wczytywanie"));
  await settle(600);

  result.partialHistory = {
    status: node("historyStatus").textContent,
    noteHidden: node("partialNote").hidden,
    note: getText("partialNote"),
    points: charts.popChart?.data.datasets[0]?.data.length ?? 0,
    axis: getAxis("popChart"),
    error: node("error").textContent,
  };

  // Nothing has happened since the pass stopped, so nothing may still be moving. A progress
  // update allowed to start the next pass turned the one snapshot that cannot be fetched into
  // a retry loop — about four requests a second at a file that will not come back, and a
  // status line that never settled.
  const attemptsBefore = fetchCounts.get(failedUrl) ?? 0;
  await settle(600);
  result.afterQuiet = {
    status: node("historyStatus").textContent,
    attemptsBefore,
    attemptsAfter: fetchCounts.get(failedUrl) ?? 0,
  };

  // Back to the default filter: the history comes from the complete aggregate again, so the
  // failure counter has no business still describing it.
  node("resetBtn").click();
  await settle(600);
  result.afterReset = {
    status: node("historyStatus").textContent,
    noteHidden: node("partialNote").hidden,
    points: charts.popChart?.data.datasets[0]?.data.length ?? 0,
    axis: getAxis("popChart"),
  };

  // A snapshot that failed does not enter memory, so the next filter change retries it on
  // purpose — it is excluded from the duplicate counter.
  const snapshotFetches = [...fetchCounts].filter(([url]) => url.endsWith(".f.json") && !failUrls.has(url));
  result.fetches = {
    files: snapshotFetches.length,
    maxPerFile: Math.max(...snapshotFetches.map(([, count]) => count)),
    duplicated: snapshotFetches.filter(([, count]) => count > 1).map(([url]) => url),
  };
}

process.stdout.write(JSON.stringify(result));
