# DATA-NOTICE — whose the data in this repository is

This file exists because [`LICENSE`](LICENSE) cannot cover everything that sits in this
repo. You can only license what you have rights to. The code is mine and goes under MIT.
**The ranking data is not mine and I cannot license it to anybody** — this document says
what may and may not be done with it, and does not pretend the matter is simpler than it
is.

This is not legal advice. It is a description of the facts and of the grounds that bear on
them.

> **Why the caveat is not in `LICENSE` itself.** The `LICENSE` file is the literal,
> unmodified MIT text — GitHub detects a licence by similarity to a template (a ~98%
> threshold), so a dozen-line addition would change the detected licence to "Other" and the
> project would stop showing up as open source. The scope lives here and in `README.md`.
> **Do not add exceptions to `LICENSE`** — add them to this file.

---

## The boundary

| Covered by the MIT licence | **Not covered** |
|---|---|
| `src/`, `test/*.ts` | `public/worlds/**` (~137 MB, 404 files, 202 snapshots) |
| `public/*.html`, `public/*.js` | `public/manifest.json`, `public/trends.json` |
| `docs/`, `README.md`, `AGENTS.md` | `test/fixtures/ladder-aether-p1.html`, `test/fixtures/legacy-snapshot-aether.json` |
| | `public/vendor/` → [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) |

The right-hand column is material originating from margonem.pl. The left-hand column is the
program that fetches and draws it — and only that column is open source.

---

## Where the data comes from

Exclusively from publicly available ranking pages:

```
https://www.margonem.pl/ladder/<world>/players?page=N
```

No login, no account, no cookies, no game API of any kind, `GET` requests only. Nothing is
written to the site and no action is taken in the game. Details of the scraper's behaviour
below.

## Whose it is

The rights to the site and to the ranking database belong to the publisher of Margonem (in
the site's terms of service: **"Usługodawca"**, the service provider). Two independent
grounds matter:

**1. The Terms of Service of the Margonem Site and Game**
([pomoc.margonem.pl](https://pomoc.margonem.pl/index/view,323)). They bind every visitor,
not only logged-in players — `I.4.g)` defines a *Użytkownik* (User) as "każdą osobę
korzystającą z Serwisu w jakiejkolwiek formie, w tym przeglądając go" ("any person using the
Site in any form, including by browsing it"). The relevant clauses:

| Clause | In brief |
|---|---|
| `XIX.2` | the licence to use the Site covers **personal purposes** |
| `XIX.4` | the permission **does not cover** redistribution on other websites |
| `VII.2.m)` | copying and redistributing the Site or its elements is forbidden |
| `VII.2.k)` | using the Site for **commercial** or political purposes is forbidden |

Section `VII` is "DZIAŁANIA ZABRONIONE" (Forbidden Actions), section `XIX` is "LICENCJA NA
KORZYSTANIE Z SERWISU" (Licence to Use the Site).

**2. The sui generis database right** — the Polish Act on the Protection of Databases,
implementing Directive 96/9/EC. It protects a database independently of copyright and
**independently of the terms of service**: it forbids the extraction and re-utilisation of
*a substantial part* of a database's contents. 202 snapshots of ~586 thousand rows per round
are not "an insubstantial part" under any sensible reading.

**The honest conclusion: publishing this data on GitHub Pages happens without the
rightsholder's consent and is not covered by the licence in `XIX.2`.** The project exists in
that state knowingly, as a non-commercial tool for the game's community, and is ready to
disappear on request — see "Deleting data".

## What this project does NOT grant

I have no rights to the ranking data, so **I grant no licence to it**. In particular:

- the data in `public/worlds/`, `manifest.json`, `trends.json` and the captures in
  `test/fixtures/` **are not** open source, are not public domain and are not covered by the
  MIT licence in `LICENSE`;
- forking this repo **does not give** you the right to redistribute the data. You get the
  code; the data in a fork remains in exactly the same legal situation as here, and you
  answer for it yourself;
- **this data must not be used commercially** — `VII.2.k)` of the terms forbids it, and I
  cannot release anybody from somebody else's terms of service;
- I give no warranty as to the correctness or completeness of the data.

If you need ranking data on any firm footing — ask the Margonem administration, not me.

## Trademarks

"Margonem", the world and profession names and the game's other marks are the trademarks and
intangible property of its publisher. They are used here descriptively only, to say what the
statistics are about. This project **is not** affiliated with, supported by or authorised by
the publisher of Margonem.

---

## Personal data (GDPR / RODO)

The snapshots contain data relating to natural persons, and that has to be said outright.
Per character, what is stored is:

| Field | File | What it is |
|---|---|---|
| `name` | `.n.json` | the character's nickname |
| `charId` | `.n.json` | the stable character ID from the profile link |
| `level`, `profession`, `honor` | `.f.json` | progress in the game |
| `days` | `.f.json` | how many days ago the account was last online |

A nickname is a pseudonym, but a pseudonym tied to activity data may constitute **personal
data** within the meaning of Art. 4(1) GDPR if the person is identifiable — and Margonem
profiles are public, with the nickname leading straight to them. The `days` field is
behavioural data on top of that: it says when a particular person last played.

The facts, without embellishment:

- the data comes from a **publicly available source**, published by the site itself, and is
  in no way enriched here with data from other sources;
- I collect no email addresses, IP addresses, contact details or anything beyond what the
  ranking shows to every visitor;
- **`.n.json` is not read anywhere** — the dashboard filters and draws from `.f.json` alone;
  the nicknames sit in the repo as material for a future search that does not exist;
- the absence of a formal processing notice, a named controller and a documented legal basis
  is a **known gap**, not an oversight swept under the rug.

### Deleting data

If you are a player and do not want your nickname or `charId` to be in this repository —
**write to me and I will remove it.** No questions about why, no justification needed.

If you represent the publisher of Margonem and want the data or the whole dashboard gone —
**write to me and I will take it down.** I will not drag it out or negotiate.

**Contact:** mikololo26@gmail.com
or an issue in [Issues](https://github.com/KamilGrocholski/chary/issues).

A technical note: historical ranking data cannot be reproduced (the site publishes no
history), so deletion is irreversible. That is not an argument against deleting — it is
notice that there is no way back afterwards.

---

## How the scraper behaves

Written down here because good faith is checkable in the code, not declarative:

| | |
|---|---|
| Paths | only `/ladder/<world>/players` — **listed in Margonem's own [`sitemap.xml`](https://www.margonem.pl/sitemap.xml)**, i.e. invited for indexing |
| `robots.txt` | does not forbid `/ladder`; it blocks only `/intro?url=`, `/intro?googlelogin=1`, `/intro?applelogin=1`, `/newintro/` |
| Pace | 1 request/s by default, a hard floor of 250 ms (`MIN_INTERVAL_MS`) |
| User-Agent | `Mozilla/5.0 (margostat scraper)` — it identifies itself, it does not impersonate a player |
| Errors | `Retry-After` honoured, backoff 5 s → 10 s → 20 s, a 120 s ceiling, 3 attempts per page |
| Authentication | none — no account, no login, no cookies |
| Direction | `GET` only; nothing written to the site, no action in the game |
| Frequency | by hand, a few times a month (intervals of 3-17 days), not from cron |

The terms' clause on "Niedozwolone Oprogramowanie" (Prohibited Software, `VII.2.g)`) concerns
software that interacts with the Game by intercepting, emulating or redirecting its
communication, automating play, modifying how the Game works and hiding identifying data. A
reader of the ranking's HTML, running without an account and taking no part in the game, does
none of those things. **This project's problem is the redistribution of the data, not the way
it is fetched** — and that is how this document is to be read.

---

## If you fork this

1. Take the code freely — MIT, do as you like.
2. **Do not assume you may republish the data.** The right to it does not travel with the
   fork.
3. Before starting the scraper: `bun run scrape:check`, leave the interval at 1 s and do not
   disguise the UA as a browser. The site you are using is maintained by somebody else, at
   their own expense.
4. Commercially — no. See `VII.2.k)`.
