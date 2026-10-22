# LiftWatch (pilot)

LiftWatch helps an Appointed Person (AP) check a planned crane lift against the
wind forecast and record their decision.

**It is decision support. It is never an authorisation to lift.** Forecasts are
modelled estimates, not measurements. This assessment supports, and does not
replace, the lift plan, the Appointed Person's judgement, manufacturer data,
BS 7121 and on-site wind checks.

"LiftWatch" is a working name. Change it in one place: `APP_NAME` in
`src/config.ts` (and the `<title>` in `index.html`).

Pilot scope: timber frame panels, floor cassettes and similar flat loads lifted by
a mobile crane on a UK site. There are no logins, billing, alerts, lightning feeds
or crane library.

- How the numbers are worked out, with sources: [METHOD.md](METHOD.md). The app also shows it as a page at `/method`
  (built from the same file), and every PDF links to it.
- Build plan: [PLAN.md](PLAN.md)

## What it does

1. **Set-up**: site (UK postcode or latitude/longitude), lift date, planned window,
   crane, the chart's in-service wind limit **and where that figure came from**,
   whether the limit is a gust or a mean, height for the wind correction, and the
   load's size, mass, rigging mass and drag coefficient. The permitted wind speed
   and the working update as you type.
2. **Assessment**: status banner ("Within limits / Near limit / Over limit —
   forecast assessment against the limits you entered"), gust at height against
   the permitted speed, % of the limit, direction, weather flags, the forecast
   source and fetch time, an hourly chart and table, daylight periods within
   limits and a 7-day outlook. The periods and the outlook are labelled planning
   guidance only.
3. **Decision**: Proceed, Postpone or Proceed with conditions, with name, role,
   notes and the two confirmations. Saving creates a timestamped, read-only
   record. It holds every input, the full calculation, the forecast values used,
   the forecast fetch time, the method version and a SHA-256 integrity hash.
4. **Records**: list, view, PDF export of any record, and JSON export/import.

## Run it locally

Needs Node 20.19+ or 22.12+.

```sh
cd liftwatch
npm install
npm test          # Vitest: wind maths, data parsing, Worker, records, PDF
npm run dev       # http://localhost:5173
```

With no `VITE_FORECAST_PROXY_URL` set, the browser calls Open-Meteo directly.
That is fine for local work.

To run the Worker locally as well:

```sh
cd liftwatch/worker
npx wrangler dev                     # http://localhost:8787/forecast?lat=53.48&lon=-2.24
# then, in liftwatch/.env.local:
# VITE_FORECAST_PROXY_URL=http://localhost:8787/forecast
```

Other scripts: `npm run build` (typecheck + production build into `dist/`),
`npm run preview`, `npm run typecheck` (app and Worker).

## Configuration

Front end (build-time `VITE_*` variables, e.g. in `.env.local` or the Pages
project settings):

| Variable | Default | Purpose |
|---|---|---|
| `VITE_FORECAST_PROXY_URL` | empty | URL of the Worker's `/forecast` endpoint. Empty: call Open-Meteo directly. |
| `VITE_OPEN_METEO_BASE_URL` | `https://api.open-meteo.com/v1/forecast` | Endpoint for direct calls only. |
| `VITE_OPEN_METEO_API_KEY` | empty | Direct calls only. It ends up in the browser bundle, so put a commercial key in the Worker instead. |

Worker (`worker/wrangler.toml` `[vars]`, plus secrets):

| Variable | Default | Purpose |
|---|---|---|
| `OPEN_METEO_BASE_URL` | `https://api.open-meteo.com/v1/forecast` | Free endpoint (non-commercial). Commercial: `https://customer-api.open-meteo.com/v1/forecast`. |
| `OPEN_METEO_API_KEY` | unset | Commercial key: `npx wrangler secret put OPEN_METEO_API_KEY`. |
| `ALLOWED_ORIGIN` | `*` | Set to the Pages site origin once deployed. |

Method constants live in `src/wind/constants.ts` and are re-exported from
`src/config.ts`: gust and mean-to-gust factor tables, the reference ratio
r0 = 1.2 m²/t, the default cw = 1.2, the status thresholds, the flag thresholds,
the optional 10 m mean-to-gust factor (unset by default) and `METHOD_VERSION`.
Change `METHOD_VERSION` and METHOD.md whenever any of these change.

## Deploy to Cloudflare

LiftWatch deploys separately from the Site Office pages in the repository root.

**1. Worker (forecast proxy and cache)**

```sh
cd liftwatch/worker
npx wrangler login
npx wrangler deploy
# note the URL, e.g. https://liftwatch-forecast.<account>.workers.dev
```

The Worker rounds latitude and longitude to 2 dp (about 1 km). It caches each
site's Open-Meteo response for 60 minutes with the Workers Cache API, so users at
the same site share one upstream call. Responses carry the time the Worker fetched
from Open-Meteo, and an `X-LiftWatch-Cache: HIT|MISS` header. Only UK and Ireland
coordinates are accepted.

**2. Pages (front end)**

Create a new Cloudflare Pages project connected to this repository with:

- Root directory: `liftwatch`
- Build command: `npm run build`
- Build output directory: `dist`
- Environment variable: `VITE_FORECAST_PROXY_URL = https://liftwatch-forecast.<account>.workers.dev/forecast`

Then set `ALLOWED_ORIGIN` in `worker/wrangler.toml` to the Pages URL and redeploy
the Worker.

## Records and storage

Records are kept in IndexedDB in the browser that saved them, behind the
`RecordStore` interface (`src/storage/types.ts`). The interface is append-only:
there is no update. To move to Supabase later, write a `SupabaseRecordStore` that
implements `list`, `get` and `add`, and return it from `createDefaultStore()`.

Use **Records → Export all (JSON)** to back up or move records. Import skips
records that already exist and rejects any record whose content no longer matches
its integrity hash.

## Layout

```
src/wind/      pure wind maths (no UI, no network). Every formula cites its source.
src/data/      Open-Meteo request/parse (shared with the Worker), forecast fetch, postcodes.io
src/lift/      set-up validation, lift assessment, decision records, method summary
src/storage/   RecordStore interface, IndexedDB and memory stores, JSON export/import
src/pdf/       jsPDF record export (loaded on demand)
src/ui/        screens, chart, form helpers
worker/        Cloudflare Worker
tests/         Vitest (*.spec.ts)
```

Dependencies: Vite, TypeScript, Vitest (dev) and jsPDF. The Worker is deployed with
`npx wrangler`, which is not a project dependency.

## Known limitations

- **Forecast grid resolution.** Open-Meteo is a modelled forecast on a grid, a few
  km at best, and the Worker rounds the site to about 1 km. It does not resolve
  conditions at the exact crane position.
- **Local funnelling between buildings.** Wind accelerating between buildings,
  around structures, over ridges or at the edges of tall buildings is not
  modelled. On-site measurement with an anemometer or the crane's jib anemometer
  is essential.
- **Single-scenario method.** The method covers flat loads (panels, cassettes) on a
  mobile crane with a gust-based chart limit, at heights up to 150 m. It does not
  cover tower cranes, other load shapes, dynamic effects, out-of-service wind or
  the crane's own wind area. If the chart limit is a 10-minute mean, the app does
  not assess, and asks for the gust figure.
- **Records stored on this device only.** Records live in one browser's
  IndexedDB. Clearing site data, private browsing, or losing or changing the
  device loses them. Export to JSON regularly. There is no sync, no sign-in and no
  central audit trail in the pilot.
- **Open-Meteo free tier is non-commercial.** The default endpoint is for
  non-commercial use. Any commercial use needs an Open-Meteo commercial plan:
  set the endpoint and key in the Worker.
- **Model run time.** Open-Meteo's best-match forecast does not say which model
  run it used. LiftWatch shows and records the time the forecast was fetched from
  Open-Meteo. A cached response keeps its original fetch time, so what you see
  can be up to 60 minutes old. Use "Refresh forecast" to check the time.
- **Weather flags are indicators only.** CAPE is not a lightning detector, and
  there is no lightning feed in this build.
