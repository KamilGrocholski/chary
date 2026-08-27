// Every chart on the page, and the state the drawing needs to stay consistent between
// renders: the Chart.js instances, the time axis, and the snapshots a tooltip looks up.
//
// A board rather than free functions, because those four are one subject. The time axis in
// particular is why: its ticks and its ends come from the aggregate and NOT from the drawn
// series (§9.6), so they outlive any one render and something has to hold them between two.
//
// Chart titles and tooltips are Polish because a player reads them — see "Language" in
// AGENTS.md.

import {
  PROFESSION_COLORS,
  getProfessionEntries,
  formatSnapshotDate,
  formatShortDate,
  formatUtcTime,
  type Filters,
  type SnapshotEntry,
  type WorldTrend,
} from "@/src/shared.ts";
import { isDefaultFilters } from "@/web/filters.ts";
import { getActiveCounts, getShareSeries, getSnapshotEntries, getThresholdByKey } from "@/web/history.ts";
import { assertDefined } from "@/src/lib/assert.ts";
import { getMillisecondsFromIsoText } from "@/src/lib/timestamp.ts";
import { getElement, getThemeTokens } from "@/web/dom.ts";
import { formatDecimal, formatNumber } from "@/web/format.ts";

/**
 * Chart.js is vendored, minified and carries no types (§9.3). Naming the hole here is the
 * point: it is one name, in one place, rather than an implicit `any` spreading out of every
 * chart the view touches.
 */
export type ChartInstance = any;

export type ChartBoard = ReturnType<typeof createChartBoard>;

/**
 * The one board the view draws on. Built once, on startup, because it reads `:root` from the
 * document and sets Chart.js's own defaults from it.
 */
export function createChartBoard() {
  const theme = getThemeTokens();

  const charts: Record<string, ChartInstance> = {};
  // The X axis is linear in epoch milliseconds, so 3-17 day intervals are visibly
  // different. Chart.js has a time scale for this, but it needs a date adapter we do not
  // vendor — so we generate the labels ourselves and put the ticks exactly at the snapshots.
  let tickValues: number[] = [];
  // The ends of the X axis, in the same epoch milliseconds. They come from the aggregate,
  // never from the drawn series: a snapshot can still be missing — one that failed to fetch,
  // or one still in flight — and an axis that shrank with it would move the left edge of the
  // chart the moment somebody typed a level, the same world silently changing the period it
  // describes.
  let axisRange: { min: number, max: number } | null = null;
  let entriesByTime: Map<number, SnapshotEntry> = new Map();

  // Chart.js arrives as a global from `vendor/`, minified and with no type information —
  // so it is named once, here, and the hole it leaves is `ChartInstance` rather than an
  // implicit `any` on every chart the view touches (§9.3).
  const Chart = ((window as any).Chart as any);
  if (Chart) {
    Chart.defaults.color = theme.muted;
    Chart.defaults.borderColor = theme.grid;
    Chart.defaults.font.family = 'ui-sans-serif, system-ui, "Segoe UI", sans-serif';
  }

  // ── The cross-section chart: levels by profession ─────────────────────────

  function composeLevelChartOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        title: { display: true, text: "Level według profesji", color: theme.text, font: { size: 14, weight: "600" } },
        legend: { display: false },
        tooltip: { enabled: false, external: renderLevelTooltip },
      },
      scales: {
        y: { beginAtZero: true, stacked: true, ticks: { precision: 0 }, grid: { color: theme.grid } },
        x: { stacked: true, ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 50 }, grid: { color: theme.gridSoft } },
      },
    };
  }

  function renderLevelTooltip({ chart, tooltip }: { chart: ChartInstance, tooltip: any }) {
    let node = document.getElementById("profTooltip");
    if (!node) {
      node = document.createElement("div");
      node.id = "profTooltip";
      node.style.cssText =
        "position:fixed;pointer-events:none;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:10px 14px;font-size:13px;color:var(--text);min-width:180px;z-index:999;transition:opacity .1s";
      document.body.appendChild(node);
    }
    if (tooltip.opacity === 0) {
      node.style.opacity = "0";
      return;
    }

    const dataIndex = tooltip.dataPoints?.[0]?.dataIndex;
    if (dataIndex == null) {
      node.style.opacity = "0";
      return;
    }

    const total = chart.data.datasets.reduce((sum: number, dataset: any) => sum + (dataset.data[dataIndex] || 0), 0);
    const level = chart.data.labels[dataIndex];
    const rows = chart.data.datasets
      .map((dataset: any) => ({ label: dataset.label, color: dataset.backgroundColor, value: dataset.data[dataIndex] || 0 }))
      .filter((row: { value: number }) => row.value > 0)
      .sort((left: { value: number }, right: { value: number }) => right.value - left.value)
      .map((row: { label: string, color: string, value: number }) => {
        // The same notation as in the bar and the table: "12,3%" and "1 234", not "12.3%".
        const percentText = total ? formatDecimal((row.value / total) * 100, 1) : formatDecimal(0, 1);
        return `<div style="display:flex;align-items:center;gap:8px;margin:3px 0">
          <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${row.color};flex-shrink:0"></span>
          <span style="flex:1">${row.label}</span>
          <span style="color:var(--muted);margin-left:8px">${formatNumber(row.value)}</span>
          <span style="color:var(--accent);min-width:48px;text-align:right">${percentText}%</span>
        </div>`;
      })
      .join("");

    node.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px;color:var(--accent)">Level ${level}</div>
      ${rows}
      <div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;color:var(--muted)">Razem: <b style="color:var(--text)">${formatNumber(total)}</b></div>
    `;

    const canvasBox = chart.canvas.getBoundingClientRect();
    node.style.opacity = "1";

    // The gap the tooltip keeps from the cursor, and the one it keeps from every edge it
    // can be pushed against. Named because the second is spelled four times below and read
    // as four unrelated eights.
    const CURSOR_GAP = 12;
    const EDGE_GAP = 8;

    let x = canvasBox.left + tooltip.caretX + CURSOR_GAP;
    let y = canvasBox.top + tooltip.caretY - 10;
    if (x + node.offsetWidth > window.innerWidth - EDGE_GAP) x = canvasBox.left + tooltip.caretX - node.offsetWidth - CURSOR_GAP;
    if (y + node.offsetHeight > window.innerHeight - EDGE_GAP) y = window.innerHeight - node.offsetHeight - EDGE_GAP;
    // The filter bar is sticky and has a higher z-index than the tooltip, so the upper
    // clamp has to end below it rather than 8 px from the window's edge.
    const barBottom = getElement("filterBar").getBoundingClientRect().bottom || 0;
    if (y < barBottom + EDGE_GAP) y = barBottom + EDGE_GAP;

    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
  }

  function renderLevelChart(counts: Map<number, number[]>) {
    const labels = [...counts.keys()].sort((left, right) => left - right);
    const datasets = getProfessionEntries().map(([id, name]) => ({
      label: name,
      data: labels.map((level) => counts.get(level)?.[id - 1] || 0),
      backgroundColor: PROFESSION_COLORS[id],
      barPercentage: 1.0,
      categoryPercentage: 1.0,
    }));

    getElement("chartEmpty").hidden = labels.length > 0;
    getElement("professionChart").hidden = labels.length === 0;

    if (!charts.professionChart) {
      charts.professionChart = new Chart(getElement("professionChart"), {
        type: "bar",
        data: { labels, datasets },
        options: composeLevelChartOptions(),
      });
      return;
    }

    // Swapping the data instead of destroy()/new Chart() — filtering 40k rows on every
    // character typed into a field stuttered noticeably.
    charts.professionChart.data.labels = labels;
    charts.professionChart.data.datasets = datasets;
    charts.professionChart.update();
  }


  // ── The history charts ────────────────────────────────────────────────────

  /**
   * @returns Chart.js's own options shape — §9.3
   */
  function composeTimeChartOptions(title: string, { percent = false }: { percent?: boolean } = {}): any {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        title: { display: true, text: title, color: theme.text, font: { size: 14, weight: "600" } },
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items: any[]) => {
              const entry = entriesByTime.get(items[0].parsed.x);
              if (!entry) return "";
              // The UTC hour, because it is what explains the jumps in "last online".
              return `${formatSnapshotDate(entry)} (${formatUtcTime(entry.startedAt)} UTC)`;
            },
            label: (item: any) => `${item.dataset.label}: ${percent ? `${formatDecimal(item.parsed.y)}%` : formatNumber(item.parsed.y)}`,
            footer: (items: any[]) => (entriesByTime.get(items[0].parsed.x)?.suspect ? "⚠ migawka może być obcięta" : ""),
          },
        },
      },
      scales: {
        y: {
          beginAtZero: percent,
          ticks: { precision: percent ? 1 : 0, callback: (value: number) => (percent ? `${formatDecimal(value)}%` : formatNumber(value)) },
          grid: { color: theme.grid },
        },
        x: {
          type: "linear",
          ...(axisRange ?? {}),
          afterBuildTicks: (axis: any) => {
            axis.ticks = tickValues.map((value) => ({ value }));
          },
          ticks: { callback: (value: number) => formatShortDate(value), maxRotation: 45, autoSkip: false },
          grid: { color: theme.gridSoft },
        },
      },
    };
  }

  /** A suspect snapshot's point is drawn hollow — otherwise a truncated scrape looks like a drop. */
  function composePointStyle(trend: WorldTrend, color: string) {
    return {
      pointBackgroundColor: trend.suspect.map((suspect: number) => (suspect ? "transparent" : color)),
      pointBorderColor: trend.suspect.map((suspect: number) => (suspect ? theme.warn : color)),
      pointBorderWidth: trend.suspect.map((suspect: number) => (suspect ? 2 : 1)),
      pointRadius: trend.suspect.map((suspect: number) => (suspect ? 6 : 3)),
      pointHoverRadius: 6,
    };
  }

  function composeSeries(trend: WorldTrend, values: number[]) {
    // A point whose date cannot be read is dropped rather than placed at NaN, where
    // Chart.js draws nothing and the series silently loses a snapshot without saying so.
    return values
      .map((y: number, index: number) => ({ x: getMillisecondsFromIsoText(trend.startedAt[index]), y }))
      .filter((point: { x: number | null }) => point.x !== null);
  }

  function drawChart(id: string, datasets: any[], options: any) {
    if (!charts[id]) {
      charts[id] = new Chart(getElement(id), { type: "line", data: { datasets }, options });
      return;
    }
    charts[id].data.datasets = datasets;
    charts[id].options = options;
    charts[id].update();
  }

  /**
   * @param population the **unfiltered** population — §9.6
   * @param thresholdKey which cumulative activity cut to draw; the picker owns the choice
   */
  function renderHistoryCharts(
    trend: WorldTrend,
    population: number[],
    filters: Filters,
    share: boolean,
    thresholdKey: string,
  ) {
    // Under the default filter, "the isMatch' share of the population" is 100% by
    // definition — so the population chart stays in counts instead of drawing a flat line.
    const filtered = !isDefaultFilters(filters);
    const popShare = share && filtered;

    drawChart(
      "popChart",
      [
        {
          label: filtered ? "Pasujących" : "Populacja",
          data: composeSeries(trend, popShare ? getShareSeries(trend.total, population) : trend.total),
          borderColor: theme.accent,
          backgroundColor: theme.accent,
          tension: 0.15,
          ...composePointStyle(trend, theme.accent),
        },
      ],
      composeTimeChartOptions(
        popShare
          ? "Udział pasujących w populacji"
          : filtered
            ? "Pasujących filtrowi w czasie"
            : "Populacja świata w czasie",
        { percent: popShare },
      ),
    );

    const threshold = getThresholdByKey(thresholdKey, filters.maxDays);
    if (threshold) {
      const counts = getActiveCounts(trend, threshold.key, filters.maxDays);
      drawChart(
        "actChart",
        [
          {
            label: `Aktywni ${threshold.label}`,
            data: composeSeries(trend, share ? getShareSeries(counts, population) : counts),
            borderColor: theme.ok,
            backgroundColor: theme.ok,
            tension: 0.15,
            ...composePointStyle(trend, theme.ok),
          },
        ],
        composeTimeChartOptions(
          share ? `Udział aktywnych ${threshold.label} w populacji` : `Aktywni ${threshold.label} w czasie`,
          { percent: share },
        ),
      );
    }

    const professionOptions = composeTimeChartOptions(share ? "Udział profesji w populacji" : "Profesje w czasie", {
      percent: share,
    });
    // The only chart with six series, so the only one that needs a legend. The options
    // object is Chart.js's own shape, which carries no types here (§9.3).
    (professionOptions.plugins as any).legend = {
      display: true,
      position: "bottom",
      labels: { boxWidth: 12, usePointStyle: true },
    };

    drawChart(
      "profChart",
      getProfessionEntries()
        .filter(([id]) => filters.professions.has(id))
        .map(([id, name]) => {
          const values = assertDefined(trend.byProf[id - 1], `profession ${id} has a series`);
          return {
            label: name,
            data: composeSeries(trend, share ? getShareSeries(values, population) : values),
            borderColor: PROFESSION_COLORS[id],
            backgroundColor: PROFESSION_COLORS[id],
            tension: 0.15,
            pointRadius: 3,
            pointHoverRadius: 6,
          };
        }),
      professionOptions,
    );
  }


  /**
   * Clears the history charts. Without this, early returns from `renderHistory` left the
   * **previous world's** series on screen under the new world's heading and table —
   * tooltips showing those snapshots' dates included.
   */
  function clearHistoryCharts() {
    tickValues = [];
    axisRange = null;
    entriesByTime = new Map();
    for (const id of ["popChart", "actChart", "profChart"]) {
      if (!charts[id]) continue;
      charts[id].data.datasets = [];
      charts[id].update();
    }
  }


  /**
   * The ticks and the ends of the time axis, and the snapshot behind each point.
   *
   * Taken from the aggregate and never from what was drawn: ticks and tooltips cover every
   * snapshot the world has, so a gap keeps its dates on the axis — which is what makes it
   * visible rather than invisible. Every snapshot in the aggregate carries a `startedAt`;
   * one without it never enters `trends.json`, because there is nowhere to put it on a time
   * axis (§9.2), so an unreadable one here is a broken aggregate and not a case to draw
   * around.
   */
  function setTimeAxis(base: WorldTrend) {
    tickValues = base.startedAt.flatMap((isoText) => {
      const milliseconds = getMillisecondsFromIsoText(isoText);
      return milliseconds === null ? [] : [milliseconds];
    });
    const first = tickValues[0];
    const last = tickValues[tickValues.length - 1];
    axisRange = first !== undefined && last !== undefined && tickValues.length > 1 ? { min: first, max: last } : null;
    entriesByTime = new Map(
      getSnapshotEntries(base).flatMap((entry) => {
        const milliseconds = getMillisecondsFromIsoText(entry.startedAt);
        return milliseconds === null ? [] : [([milliseconds, entry] as [number, SnapshotEntry])];
      }),
    );
  }

  /** The cross-section's own clear: the histogram is the previous snapshot's until the new one lands. */
  function clearLevelChart() {
    if (!charts.professionChart) return;
    charts.professionChart.data.labels = [];
    charts.professionChart.data.datasets = [];
    charts.professionChart.update();
  }

  return { renderLevelChart, renderHistoryCharts, setTimeAxis, clearLevelChart, clearHistoryCharts };
}
