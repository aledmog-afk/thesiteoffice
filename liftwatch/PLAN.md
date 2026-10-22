# LiftWatch pilot: build plan

LiftWatch (working name, set in `src/config.ts` as `APP_NAME`) helps an Appointed
Person (AP) check a planned crane lift against the wind forecast and record a
decision. It is decision support. It never authorises a lift.

## Pilot scope

- One scenario: timber frame panels, floor cassettes and similar flat loads on a
  mobile crane, on a UK site.
- Not in this build: logins, billing, alerts, lightning feeds, crane library.

## Layout

The app lives in `liftwatch/` and is separate from the existing Site Office pages
in the repository root. It has its own `package.json` and deploys as its own
Cloudflare Pages project.

```
liftwatch/
  PLAN.md  METHOD.md  README.md
  index.html                 Vite entry
  src/
    config.ts                brand name, endpoints, constants, method version
    wind/                    pure wind maths: no DOM, no network (unit tested)
    data/                    postcode lookup, forecast fetch and parsing
    storage/                 RecordStore interface, IndexedDB and in-memory stores
    pdf/                     jsPDF export of a decision record
    ui/                      screens: set-up, assessment, decision, records
  worker/                    Cloudflare Worker: Open-Meteo proxy with a 60 min cache
  tests/                     Vitest tests (the wind maths ones were written first)
```

## Steps (each one is a small commit)

1. PLAN.md and METHOD.md.
2. Tooling: Vite, TypeScript, Vitest, jsPDF. No other dependencies without asking.
3. Wind module tests first: CPA worked example, compact load, height factors,
   mean-to-gust, threshold edges, invalid inputs. Then `src/wind/` until they pass.
4. Worker: round lat/long to 2 dp, build the Open-Meteo URL from config, cache
   for 60 min, return the fetch time with the data.
5. Client data layer: postcodes.io lookup, forecast fetch (through the Worker, or
   direct to Open-Meteo when no Worker URL is configured), parsing.
6. Storage: `RecordStore` interface, IndexedDB implementation, JSON export/import.
7. Screens: set-up (live working), assessment (banner, chart, periods, 7-day
   strip), decision, records list.
8. PDF export.
9. README: local run, deploy, config, known limitations.

## Rules for the wording

- The status banner says only "Within limits", "Near limit" or "Over limit",
  followed by "forecast assessment against the limits you entered".
- Never "safe", "clear to lift" or "go".
- Status always has a text label as well as a colour.
- Weather flags never count as a pass.

## Phase 2 (built after the first pilot review)

Driven by the CPA/TCIG 2507 guide and the research in docs/RESEARCH.md:

1. Terrain setting (open country, town, city), method LW-M1.1.
2. Load schedule: many loads, pasted from a panel schedule; the most wind-sensitive governs.
3. Checks tab: crane capacity, slings, outrigger ground bearing, LOLER dates, cards,
   pre-lift checklist, crew sign-on.
4. Lift-day wind log with the CPA 6.4.3 stop / wait / reset pattern, compared with the forecast.
5. One-page crew briefing sheet, reuse a set-up, offline use.

TESTING.md is the step-by-step test script.

