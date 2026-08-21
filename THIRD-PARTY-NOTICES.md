# Third-party notices

Third-party code used in this project. It is not covered by [`LICENSE`](LICENSE) — each
item has its own licence, listed below.

The split into two groups matters, because the obligations differ: what **ships to the
site** is redistributed and therefore requires a licence notice to travel with it. What runs
**only during the build and the scrape** is not redistributed by us and is listed here for
completeness.

---

## Redistributed (lands on GitHub Pages)

### Chart.js 4.4.7 — MIT

- File: `public/vendor/chart.umd.min.js` (vendored, unmodified)
- Licence: [`public/vendor/LICENSE.chartjs`](public/vendor/LICENSE.chartjs)
- Copyright (c) 2014-2024 Chart.js Contributors
- https://www.chartjs.org

MIT requires the copyright notice to accompany every copy. The minified file carries it in a
banner at the top, but banners are lost on further minification, which is why the full
licence text sits next to it as a separate file. **When updating Chart.js, replace
`LICENSE.chartjs` too** — the version number and the year in the copyright may change.

---

## Build and scrape only (does not reach the site)

| Package | Licence | What for |
|---|---|---|
| `cheerio` | MIT | parsing the ranking HTML in `src/parser.ts` |
| `typescript` | Apache-2.0 | `bun run typecheck` |
| `@types/bun`, `bun-types`, `@types/node` | MIT | types |

The `cheerio` dependency tree additionally brings in packages under **MIT** (`parse5`,
`htmlparser2`, `undici`, `iconv-lite`, `dom-serializer` and others), **BSD-2-Clause**
(`domhandler`, `domutils`, `domelementtype`, `entities`, `css-select`, `css-what`,
`nth-check`, `cheerio-select`) and **ISC** (`boolbase`).

Every dependency is under a permissive licence — **there is no copyleft in the tree**, so
nothing conflicts with this project's MIT. The current list:

```bash
for p in node_modules/*/ node_modules/@*/*/; do
  [ -f "$p/package.json" ] && grep -m1 '"license"' "$p/package.json"
done | sed 's/.*: *"//;s/".*//' | sort -u
```

---

## The ranking data — this is not third-party code

The contents of `public/worlds/`, `public/manifest.json`, `public/trends.json` and
`test/fixtures/` come from margonem.pl and **are not** open-source software. The MIT licence
in `LICENSE` does not cover them, and the right to redistribute them does not travel with a
fork.
