// The panels the page reads back: the match line, the distribution, the summary, the change
// table and the history counter. Nothing here decides what to fetch or when to redraw —
// each takes what it prints and writes it into one node.
//
// The strings here are Polish because a player reads them — see "Language" in AGENTS.md.

import {
  PROFESSION_COLORS,
  formatShortDate,
  formatSnapshotDate,
  getProfessionEntries,
  type WorldTrend,
} from "@/src/shared.ts";
import { getActivityLabel, getTotalsFromCounts, getVisibleActivityBuckets } from "@/web/filters.ts";
import { getChangeRows, summarize } from "@/web/history.ts";
import { assertDefined } from "@/src/lib/assert.ts";
import { getMillisecondsFromIsoText } from "@/src/lib/timestamp.ts";
import { getElement } from "@/web/dom.ts";
import { formatBytes, formatDecimal, formatNumber, formatSigned } from "@/web/format.ts";

// ── Rendering the text ────────────────────────────────────────────────────

export function renderMatchLine(matched: number, population: number) {
  const share = population > 0 ? (matched / population) * 100 : 0;
  getElement("matchLine").innerHTML =
    `<span>Pasuje: <b>${formatNumber(matched)}</b></span>` +
    `<span>z ${formatNumber(population)}<span class="wide-only"> w tej migawce</span></span>` +
    `<span>(${formatDecimal(share, 1)}%)</span>`;
}

export function renderStats(counts: Map<number, number[]>, activity: [number, number][], maxDays: number, professions: Set<number>) {
  const { perProfession } = getTotalsFromCounts(counts);

  // Zero isMatch is not a distribution made of zeros: six professions and five activity
  // buckets printed as "0" read like broken data, not like the answer "nobody isMatch".
  // The same principle as `getVisibleActivityBuckets`.
  if (perProfession.every((count) => count === 0)) {
    getElement("stats").innerHTML =
      `<div class="stats-line">Żaden gracz w tej migawce nie spełnia filtrów — rozkładu nie ma z czego złożyć.</div>`;
    return;
  }

  // A profession unchecked in the filter has nothing to contribute — "Mag: 0" next to
  // the result of a "Wojownik and Tropiciel only" filter looks like missing data rather
  // than exclusion. `profChart` draws only the chosen series; here it did not.
  const badges = getProfessionEntries()
    .filter(([id]) => professions.has(id))
    .map(([id, name]) => ({
      name,
      color: PROFESSION_COLORS[id],
      count: assertDefined(perProfession[id - 1], `profession ${id} has a count`),
    }))
    .sort((left, right) => right.count - left.count)
    .map(
      ({ name, color, count }) =>
        `<span style="color:${color};white-space:nowrap">${name}: <b>${formatNumber(count)}</b></span>`,
    )
    .join(" · ");

  const visible = new Set(getVisibleActivityBuckets(maxDays));
  const activityLine = activity
    .filter(([bucket]: [number, number]) => visible.has(bucket))
    .map(
      ([bucket, count]: [number, number]) =>
        `<span>${getActivityLabel(bucket, maxDays)}: <b style="color:var(--text)">${formatNumber(count)}</b></span>`,
    )
    .join(" · ");

  getElement("stats").innerHTML = `
    <div class="stats-line">${badges}</div>
    <div class="stats-line" style="margin-top:8px">${activityLine}</div>
  `;
}

/**
 * The scraper flags a snapshot whose population dropped suspiciously far — most often
 * that means the ranking returned fewer pages during an outage. Without this bar the flag
 * would be written for nobody.
 */
/**
 * @param suspect written by the scraper, in Polish, for a player — §9.8
 */
export function showSuspect(suspect: { reason: string } | null | undefined) {
  const node = getElement("suspect");
  if (!suspect) {
    node.hidden = true;
    node.textContent = "";
    return;
  }
  node.hidden = false;
  node.innerHTML = `<span aria-hidden="true">⚠</span><span><b>Ta migawka może być niekompletna.</b> ${suspect.reason}</span>`;
}

/**
 * @param base the aggregate, which owns the time axis — §9.6
 */
export function renderSummary(trend: WorldTrend, base: WorldTrend) {
  const summary = summarize(trend);
  if (!summary) {
    getElement("summary").textContent = "—";
    return;
  }
  const color = summary.delta < 0 ? "var(--danger)" : summary.delta > 0 ? "var(--ok)" : "var(--muted)";
  const span = summary.days === null ? "—" : `${Math.round(summary.days)} dni`;
  // "Od pierwszej migawki" is a lie the moment a snapshot is missing from the front: the
  // axis still reaches April while the number counts from June. Then it says from when.
  const from =
    trend.startedAt[0] === base.startedAt[0]
      ? "pierwszej migawki"
      : formatShortDate(assertDefined(getMillisecondsFromIsoText(trend.startedAt[0]), "a drawn snapshot has a readable startedAt"));

  getElement("summary").innerHTML = `
    <div style="margin-bottom:6px">Ostatnia migawka: <b style="color:var(--text)">${formatNumber(summary.total)}</b></div>
    <div class="stats-line">
      <span>Zmiana od ${from}: <b style="color:${color}">${formatSigned(summary.delta)}</b>
        <span style="color:${color}">(${formatSigned(summary.percent, formatDecimal)}%)</span></span>
      <span>Migawek: <b style="color:var(--text)">${summary.snapshots}</b></span>
      <span>Okres: <b style="color:var(--text)">${span}</b></span>
    </div>
  `;
}

/**
 * Hidden, not merely emptied: an empty `.card` keeps its border and its `tabindex="0"`,
 * so it stays a visible box and a dead tab stop announced as a region with no content.
 */
export function clearTable() {
  getElement("changeTable").hidden = true;
  getElement("changeTable").innerHTML = "";
}

export function renderTable(trend: WorldTrend) {
  const rows = getChangeRows(trend).reverse(); // the newest at the top
  // A world with one snapshot has nothing to compare against anything. Clearing the
  // content alone left the `.card` with its border and padding — an empty box that still
  // caught the tab key (`tabindex="0"`) and was still announced as the region "Zmiany
  // populacji między migawkami", only with no content. The `#singlePoint` note above
  // already says why there is no table, so the card is to disappear entirely.
  // Fewer than two snapshots is not a trend, and a table of changes whose every change
  // is an em dash says less than `#singlePoint` already says beside it.
  getElement("changeTable").hidden = rows.length < 2;
  if (rows.length < 2) {
    getElement("changeTable").innerHTML = "";
    return;
  }

  const body = rows
    .map(({ entry, total, delta, days, perDay }) => {
      // A change nobody can compute is grey and an em dash, never a green zero: the
      // oldest snapshot has no predecessor, and "0" there would be a measurement.
      const color = delta === null || delta === 0 ? "var(--muted)" : delta < 0 ? "var(--danger)" : "var(--ok)";
      return `<tr>
        <td>${formatSnapshotDate(entry ?? null)}${entry?.suspect ? ' <span title="migawka może być obcięta" style="color:var(--warn)">⚠</span>' : ""}</td>
        <td class="number">${days === null ? "—" : formatDecimal(days)}</td>
        <td class="number">${formatNumber(total)}</td>
        <td class="number" style="color:${color}">${delta === null ? "—" : formatSigned(delta)}</td>
        <td class="number" style="color:${color}">${perDay === null ? "—" : formatSigned(perDay, formatDecimal)}</td>
      </tr>`;
    })
    .join("");

  getElement("changeTable").innerHTML = `
    <table>
      <thead><tr><th>Migawka</th><th class="number">Odstęp (dni)</th><th class="number">Populacja</th><th class="number">Zmiana</th><th class="number">Na dobę</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

/**
 * The history counter, which doubles as the fetch progress bar — and, while it is running,
 * as the price of what is being fetched.
 *
 * It counts against every dated snapshot the world has, never against how many arrived:
 * "10 migawek" under a world that has 12 reads as a complete set of data, and a range
 * quietly short is worse than a range openly incomplete.
 *
 * The price is here because the transfer budget is not. Nobody is stopped at a ceiling any
 * more, so the only thing left that keeps the transfer knowingly bought is naming it while
 * it is being spent — a number nobody sees is a number bought blind.
 *
 * What it prices is what is still coming, not the whole set: snapshots already in memory
 * from an earlier filter cost nothing to draw again, and a figure that counted them would
 * overstate the transfer every time after the first.
 *
 * It is approximate and says so with a `~`: `bytes` in `trends.json` is the gzip size of
 * the world's NEWEST snapshot and the older ones are smaller, because the population grew.
 * Measured on aether, 12 × 98.5 KB = 1.15 MB against 1.156 MB actually on disk — close,
 * but a number that might be wrong may not look like one that is right (§9.6).
 *
 * @param bytes gzip size of one snapshot; 0 = not measured
 * @param progress the pass in flight; the loading line may be written only while one is
 */
export function renderHistoryStatus(
  loaded: number,
  available: number,
  bytes: number,
  progress: { running: boolean; failed: number },
) {
  const node = getElement("historyStatus");
  if (available === 0) {
    node.textContent = "brak datowanych migawek";
    return;
  }
  if (loaded >= available) {
    node.textContent = `${available} ${available === 1 ? "migawka" : "migawek"}`;
    return;
  }
  // Not the whole set. "Wczytywanie…" may be written only while something is still in
  // flight — otherwise the status stays forever on a progress bar that has stopped.
  const parts = [
    progress.running
      ? `wczytywanie dokładnych danych… ${loaded} z ${available} migawek`
      : `${loaded} z ${available} migawek`,
  ];
  // Absent is not zero: a world whose price was never measured gets no figure rather than
  // a "0 KB" nobody wrote (§9.5).
  if (progress.running && bytes > 0) parts.push(`~${formatBytes((available - loaded) * bytes)}`);
  if (!progress.running && progress.failed > 0) parts.push(`${progress.failed} nie wczytano`);
  node.textContent = parts.join(" · ");
}
