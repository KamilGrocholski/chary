// The filter bar: everything that reads or writes a form control, plus the two things that
// belong to it rather than to the page below — the chips summarising the active filters,
// and the drawer they open.
//
// It decides nothing about what to draw. Data arrives as arguments and the redraw is the
// caller's, so this module reads as one question: what is in the form right now?
//
// The `thresholdKeys` memory is the exception, and it is what makes the picker survive a
// rebuild of its own option list — see `fillThresholdSelect`.
//
// The strings here are Polish because a player reads them — see "Language" in AGENTS.md.

import {
  PROFESSION_COLORS,
  capitalize,
  formatSnapshotDate,
  getProfessionEntries,
  type Filters,
  type ManifestEntry,
} from "@/src/shared.ts";
import { composeFiltersParams, describeFilters } from "@/web/filters.ts";
import { composeViewParams, getThresholdByKey, getUsableThresholds } from "@/web/history.ts";
import { assert, assertDefined } from "@/src/lib/assert.ts";
import { getFiniteNumberFromText, getIntegerFromText } from "@/src/lib/number.ts";
import { getCheckboxes, getElement, getField } from "@/web/dom.ts";
import { formatNumber } from "@/web/format.ts";

/** One world as `manifest.json` lists it. */
export type ManifestWorld = { name: string; files: ManifestEntry[] };

// The last set of thresholds filled in, so choosing one is not undone by rebuilding the list.
let thresholdKeys = "";

// ── Reading the state out of the form ─────────────────────────────────────

export function readFieldNumber(id: string, fallback: number): number {
  const value = getField(id).value;
  if (value === "") return fallback;
  // A field left holding something unreadable falls back rather than becoming a number:
  // `Number("")` is 0, and a "0" in `minLevel` is a filter somebody could have meant.
  return getFiniteNumberFromText(value.trim()) ?? fallback;
}

/**
 * A profession id out of our own markup or out of `PROFESSION_NAMES`.
 *
 * An assertion rather than a fallback: these come from `index.html` and from a constant
 * in `shared.js`, both ours, so a value that is not 1-6 means the two went out of step
 * and no reading here could repair it (§9.5).
 */
export function requireProfessionId(value: string | number): number {
  const id = assertDefined(getIntegerFromText(String(value)), `a profession id is a whole number, got "${value}"`);
  assert(id >= 1 && id <= 6, `a profession id is 1-6, got ${id}`);
  return id;
}

export function readFilters() {
  const maxDays = readFieldNumber("onlineValue", Infinity);
  return {
    minLevel: readFieldNumber("minLevel", -Infinity),
    maxLevel: readFieldNumber("maxLevel", Infinity),
    minHonor: readFieldNumber("minHonor", -Infinity),
    maxHonor: readFieldNumber("maxHonor", Infinity),
    maxDays: maxDays < 0 ? Infinity : maxDays,
    professions: new Set(
      getCheckboxes("profCheckboxes", "input:checked").map((checkbox) => requireProfessionId(checkbox.value)),
    ),
  };
}

export function readView() {
  return {
    world: getField("worldSelect").value,
    date: getField("snapshotSelect").value,
    threshold: getField("thresholdSelect").value,
    share: getField("modeSelect").value === "udzial",
  };
}

/** The inverse of readFilters — puts the state from the URL back into the form fields. */
/**
 */
export function applyFilters(filters: Filters) {
  const setFieldValue = (id: string, value: number) => {
    getField(id).value = Number.isFinite(value) ? String(value) : "";
  };
  setFieldValue("minLevel", filters.minLevel);
  setFieldValue("maxLevel", filters.maxLevel);
  setFieldValue("minHonor", filters.minHonor);
  setFieldValue("maxHonor", filters.maxHonor);
  setFieldValue("onlineValue", filters.maxDays);
  getField("onlinePreset").value = Number.isFinite(filters.maxDays) ? String(filters.maxDays) : "all";
  for (const checkbox of getCheckboxes("profCheckboxes")) {
    checkbox.checked = filters.professions.has(requireProfessionId(checkbox.value));
  }
}

export function resetFilters() {
  for (const id of ["minLevel", "maxLevel", "minHonor", "maxHonor", "onlineValue"]) {
    getField(id).value = "";
  }
  getField("onlinePreset").value = "all";
  for (const checkbox of getCheckboxes("profCheckboxes")) checkbox.checked = true;
}

export function writeUrlState() {
  const params = composeFiltersParams(readFilters());
  for (const [key, value] of composeViewParams(readView())) params.set(key, value);
  params.sort();
  // The anchor stays: without it the first filter change after clicking "Historia"
  // wiped the anchor out of the address, so a reload returned to the top of the page.
  const hash = location.hash || "";
  const query = params.toString();
  const url = `${location.pathname}${query ? `?${query}` : ""}${hash}`;
  // `render()` runs on every character and on every history file fetched. Safari cuts
  // in after ~100 `replaceState` calls per 30 s, and an exception would take down the
  // render halfway — so we write only when the address actually changed.
  if (url === `${location.pathname}${location.search || ""}${hash}`) return;
  history.replaceState(null, "", url);
}

// The groups a chip's close button clears. Never a single field: "Poziom 250-400" is one
// thing to the reader, though two `<input>`s to the code.
const FILTER_GROUPS = {
  level: ["minLevel", "maxLevel"],
  honor: ["minHonor", "maxHonor"],
  days: ["onlineValue"],
};

/** @param key one of `FILTER_GROUPS`'s keys, or "prof" */
export function clearFilterGroup(key: string) {
  if (key === "prof") {
    for (const checkbox of getCheckboxes("profCheckboxes")) checkbox.checked = true;
  } else {
    for (const id of FILTER_GROUPS[(key as keyof typeof FILTER_GROUPS)] ?? []) getField(id).value = "";
    if (key === "days") getField("onlinePreset").value = "all";
  }
}

/**
 * The chips for the active filters in the bar. Baymard: sites showing the active filters
 * both in the panel and as a summary above the results have markedly fewer user errors
 * than sites with only one of those patterns — so we have both.
 *
 * The chips are a view of `readFilters()`, not their own state: `describeFilters`
 * computes the labels, and the close button writes back into the same form fields.
 */
export function renderChips(filters: Filters) {
  const chips = describeFilters(filters);
  const box = getElement("filterChips");
  // The chips are rebuilt on every render, so pressing a close button destroyed the
  // element that held focus — focus fell back to `<body>` and two filters could not be
  // removed in a row from the keyboard. So we remember where it was.
  const active = typeof document !== "undefined" ? document.activeElement : null;
  const hadFocus =
    active && box.contains?.(active)
      ? ((active as HTMLElement).dataset?.clear ?? "")
      : null;

  box.innerHTML = chips
    .map(
      ({ key, label }) =>
        `<span class="chip" title="${label}">${label}<button type="button" data-clear="${key}" aria-label="Usuń filtr: ${label}">×</button></span>`,
    )
    .join("");
  getElement("filtersToggle").textContent = chips.length > 0 ? `Filtry (${chips.length})` : "Filtry";

  if (hadFocus === null) return;
  const buttons = [...box.querySelectorAll("button")];
  // The same chip if it survived; otherwise the first one left; and when the last one is
  // gone — the button the chips grow out from.
  const next = buttons.find((button) => button.dataset?.clear === hadFocus) ?? buttons[0] ?? getElement("filtersToggle");
  next.focus?.();
}

export function setFieldsOpen(open: boolean) {
  // Closing hides the drawer with `display: none`. If focus were inside, the browser
  // would drop it onto `<body>` and the next Tab would start from the top of the
  // document — so we hand it to the button that opens the drawer.
  const fields = getElement("filterFields");
  const active = typeof document !== "undefined" ? document.activeElement : null;
  const focusWasInside = !open && active && fields.contains?.(active);

  fields.hidden = !open;
  getElement("filtersToggle").setAttribute("aria-expanded", String(open));
  if (focusWasInside) getElement("filtersToggle").focus?.();
}


// ── The selects ───────────────────────────────────────────────────────────

/**
 * @param selected the world to keep chosen, where one is to be kept
 */
export function fillWorldSelect(worlds: ManifestWorld[], selected?: string | null) {
  getElement("worldSelect").innerHTML = worlds
    .map((world) => `<option value="${world.name}">${capitalize(world.name)}</option>`)
    .join("");
  if (selected && worlds.some((world) => world.name === selected)) getField("worldSelect").value = selected;
}

/**
 * @param selected the id to keep chosen, where one is to be kept
 */
export function fillSnapshotSelect(entries: ManifestEntry[], selected?: string | null) {
  const files = [...entries].reverse(); // the newest at the top
  getElement("snapshotSelect").innerHTML = files
    .map((filters) => `<option value="${filters.id}">${formatSnapshotDate(filters)}</option>`)
    .join("");
  if (selected && files.some((filters) => filters.id === selected)) getField("snapshotSelect").value = selected;
}

export function buildProfessionCheckboxes() {
  const container = getElement("profCheckboxes");
  getProfessionEntries().forEach(([id, name]) => {
    const color = assertDefined(PROFESSION_COLORS[id], `profession ${id} has a colour`);
    const label = document.createElement("label");
    label.style.color = color;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = String(id);
    checkbox.checked = true;
    checkbox.style.accentColor = color;
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(name));
    container.appendChild(label);
  });
}

/**
 * Thresholds wider than the activity filter leave the picker: under such a filter they
 * would count exactly the same players as the isMatch chart, so they would collapse onto
 * it into one line that looks like confirmation of something.
 */
export function fillThresholdSelect(maxDays: number, preferred?: string) {
  const usable = getUsableThresholds(maxDays);
  const keys = usable.map((threshold) => threshold.key).join(",");
  // The choice is read BEFORE the options are replaced. `innerHTML` on a `<select>`
  // resets the value to the first option, so reading it afterwards would always give
  // "< 24h" — dropping the user onto a series that swings by 14.7% and freezing that
  // into the link.
  const wanted = preferred ?? getField("thresholdSelect").value;

  if (keys !== thresholdKeys) {
    thresholdKeys = keys;
    getElement("thresholdSelect").innerHTML = usable.map((threshold) => `<option value="${threshold.key}">${threshold.label}</option>`).join("");
  }
  const chosen = getThresholdByKey(wanted, maxDays);
  if (chosen) getField("thresholdSelect").value = chosen.key;

  getField("thresholdSelect").disabled = usable.length === 0;
  getElement("actChartBox").hidden = usable.length === 0;
  getElement("thresholdNote").hidden = usable.length === getUsableThresholds(Infinity).length;
  if (!getElement("thresholdNote").hidden) {
    const limit = `≤ ${maxDays === 0 ? "< 24h" : `${formatNumber(maxDays)} dni`}`;
    getElement("thresholdNote").innerHTML =
      `<span aria-hidden="true">ℹ</span><span><b>Filtr aktywności zawęził progi.</b> ` +
      (usable.length === 0
        ? `Każdy próg jest szerszy niż filtr (${limit}), więc wykres aktywnych rysowałby tę samą linię co wykres pasujących — ukryty.`
        : `Progi szersze niż filtr (${limit}) zniknęły z wyboru: pod nim liczyłyby dokładnie tych samych graczy.`) +
      `</span>`;
  }
  return usable;
}
