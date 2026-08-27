/**
 * The binary size ladder, and nothing else.
 *
 * Three places turn a byte count into text for a person — the dashboard in Polish and
 * capped at MB, `bun run rebuild` in MB alone, `bun run data:status` up to GB — and all
 * three used to spell the ladder themselves: `1024 * 1024`, `bytes / 1024 / 1024 / 1024`,
 * `n >= MB`. Eleven occurrences of 1024 across the three, and nothing connecting them.
 *
 * The formatting stays where it is. A single formatter would need a locale and a set of
 * units passed in, which is more machinery than the duplication costs (§7.1) — what is
 * genuinely one answer is the ladder itself, so that is what lives here.
 *
 * Binary, not decimal: this measures files on disk and transfers over the wire, where a
 * kilobyte is 1024 bytes. A GB here is what a filesystem calls a GiB, which is also what
 * GitHub Pages means by its 1 GB limit (§9.9).
 */

export const BYTES_IN_KILOBYTE = 1024;
export const BYTES_IN_MEGABYTE = BYTES_IN_KILOBYTE * 1024;
export const BYTES_IN_GIGABYTE = BYTES_IN_MEGABYTE * 1024;
