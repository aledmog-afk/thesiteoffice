# LiftWatch method (version LW-M1.0)

This is the method used by `src/wind/`. Every formula below also carries its source
in a code comment next to the code that applies it. The method version is stored
in every decision record (`METHOD_VERSION` in `src/config.ts`). Change the version
whenever any number or rule in this file changes.

LiftWatch is decision support. It compares a forecast with limits the Appointed
Person (AP) has entered. It does not authorise a lift and does not replace the
lift plan, the AP's judgement, manufacturer data, BS 7121 or on-site wind checks.

## Sources

| Ref | Source |
|-----|--------|
| CPA | Construction Plant-hire Association / Tower Crane Interest Group (CPA/TCIG), *Planning and Control of Lifting Operations in Wind*, July 2025. Quotes Liebherr gust factors and mean-to-gust factors, and gives a worked example of a flat panel. |
| EN13000 | BS EN 13000, *Cranes. Mobile cranes*. Mobile crane in-service wind limits on load charts assume a load with a wind area of 1.2 m² per tonne of load and a drag coefficient of 1.2. |
| BS7121 | BS 7121-1, *Code of practice for safe use of cranes. General*, Annex D: the method for reducing the permitted wind speed for loads with a large wind area. |
| OM | Open-Meteo forecast API, https://open-meteo.com/en/docs. Variables are listed below. |

## Units

- Wind speeds are in m/s throughout. mph is shown alongside: 1 m/s = 2.236936 mph
  (1 mph = 0.44704 m/s exactly, by definition).
- Mass in the inputs is in kg. The ratio below uses tonnes (t = kg / 1000).
- Heights are in metres above ground level.

## Step 1: 10 m gust corrected to height

Open-Meteo gives `wind_gusts_10m`, the gust at 10 m. Wind increases with height, so
the gust is scaled to the height used for the lift (the higher of the jib head and
the load during the lift; the AP enters it).

Gust factors from Liebherr, quoted in CPA:

| Height (m) | Factor |
|-----------:|-------:|
| 10  | 1.000 |
| 50  | 1.181 |
| 100 | 1.272 |
| 150 | 1.329 |

Between two tabulated points the factor is interpolated linearly in log(height):

```
t = ln(h / h_lo) / ln(h_hi / h_lo)
F(h) = F_lo + t × (F_hi − F_lo)
```

- Below 10 m the factor is 1.0 (no reduction is taken below the reference height).
- Above 150 m the app refuses with "outside method range".
- Gust at height: `v_gust(h) = v_gust(10 m) × F(h)`.

Example: at 25 m, t = ln(25/10) / ln(50/10) = 0.5693, so F = 1 + 0.5693 × 0.181 = 1.103.

## Step 2: 10-minute mean to gust at height (for sources without gusts)

Some sources give only a 10-minute mean wind speed at 10 m. CPA gives these factors
to turn the 10 m mean into a gust at height:

| Height (m) | Factor |
|-----------:|-------:|
| 50  | 1.653 |
| 100 | 1.78  |
| 150 | 1.861 |

- Between 50 m and 150 m: same log-height interpolation as Step 1.
- Between 10 m and 50 m: interpolated from a 10 m factor that the AP enters (or that
  is set in config). With no 10 m factor set, the app refuses below 50 m. There is
  no default because the published table does not give a 10 m value.
- At or below 10 m: the 10 m factor itself (it must be set).
- Above 150 m: refused, outside method range.
- `v_gust(h) = v_mean(10 m) × G(h)`. Step 1 is then not applied again.

The pilot uses Open-Meteo gusts, so this path is not used by the screens yet. It is
implemented and tested so a future mean-only source can use it.

## Step 3: permitted wind speed for the load (wind-area reduction)

Source: EN13000 assumption, method as BS7121 Annex D, worked example in CPA.

1. Projected area of the face presented to the wind:
   `Ap = length × height` (m²). For a panel lifted upright this is the panel face.
2. Effective wind area: `Aw = Ap × cw`. Default `cw = 1.2` for flat panels. The AP
   can change it.
3. Mass: `m = (load mass + rigging mass) / 1000` (t). Rigging is entered separately
   and added.
4. Ratio: `r = Aw / m` (m²/t).
5. Reference ratio from EN13000: `r0 = 1.2 m²/t` (`REFERENCE_AREA_RATIO` in config).
6. Permitted wind speed:
   - if `r ≤ r0`: `v_perm = v_chart` (the crane chart limit, unchanged)
   - if `r > r0`: `v_perm = v_chart × √(r0 / r)`
7. `v_perm` is never above `v_chart`.

Why the square root: wind force is proportional to v² × Aw. The chart limit
assumes a wind area of r0 × m. Holding the force at the chart's design value,
`v_perm² × Aw = v_chart² × r0 × m`, so `v_perm = v_chart × √(r0 × m / Aw) = v_chart × √(r0 / r)`.

### Worked example (CPA)

Panel 3.6 m × 2.4 m, cw 1.2, mass 1,300 kg, no rigging, chart limit 17 m/s.

- Ap = 8.64 m²
- Aw = 10.368 m²
- r = 10.368 / 1.3 = 7.975 m²/t
- v_perm = 17 × √(1.2 / 7.975) = 6.59 m/s (14.8 mph). CPA quotes about 6.5 m/s.

### The chart limit must be a gust

EN 13000 load charts give the in-service limit as a 3-second gust at the highest
point of the crane. LiftWatch compares gusts at height with that limit. If the AP
says the chart limit is a mean, the app does not assess. It asks for the gust figure
from the crane supplier or lift plan. Comparing a gust with a mean limit would
give a misleading result either way.

## Step 4: hourly assessment

For each forecast hour:

```
ratio = v_gust(h) / v_perm
```

| Ratio | Status |
|-------|--------|
| below 0.80 | Within limits |
| 0.80 to 1.00 inclusive | Near limit |
| above 1.00 | Over limit |

If the gust is missing for an hour, that hour has no status ("No data"). It does not
pass.

### Flags

Flags are shown next to the status. A flag never makes an hour pass, and the
absence of a flag never makes an hour pass either.

| Flag | Rule (Open-Meteo variable) |
|------|----------------------------|
| Thunderstorm risk | `cape` > 500 J/kg |
| Possible thunder | 100 ≤ `cape` ≤ 500 J/kg |
| Poor visibility | `visibility` < 5,000 m |
| Rain likely | `precipitation_probability` ≥ 70 % |
| Frost / ice risk | `temperature_2m` ≤ 1 °C |
| Outside daylight | hour starts before `sunrise` or at or after `sunset` |
| Data missing | a variable used for a flag is missing |

### Planned lift window and banner

The AP can set a planned lift window (default: sunrise to sunset on the lift date).
The banner shows the worst hour in that window, ranked Over limit, then No data,
then Near limit, then Within limits. Within one status the highest ratio is shown.

### Planning guidance

- Periods: runs of at least 2 consecutive hours that are within limits and in
  daylight. Labelled "Planning guidance only".
- 7-day outlook: for each day, the worst status in daylight hours and the highest
  gust at height. Labelled "Outlook — planning guidance only".

## Forecast request (Open-Meteo)

```
hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,wind_speed_80m,
       wind_speed_120m,cape,precipitation_probability,visibility,temperature_2m
daily=sunrise,sunset
wind_speed_unit=ms
timezone=Europe/London
forecast_days=7
```

The Worker rounds latitude and longitude to 2 decimal places (about 1 km) and caches
each site's response for 60 minutes. The fetch time and source are shown on screen
and stored in each record. Open-Meteo's default "best match" picks and blends
weather models for the location. The forecast response does not say which model
run was used, so LiftWatch records the time the forecast was fetched from
Open-Meteo.
