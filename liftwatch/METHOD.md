# LiftWatch method (version LW-M1.2)

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
| CPA | CPA/TCIG 2507, *Planning and Control of Lifting Operations in Wind*, V1, July 2025 (Construction Plant-hire Association, Crane and Tower Crane Interest Groups). Page numbers below are the guide's own (“Page n of 57”). |
| EN13000 | BS EN 13000:2010+A1:2014, *Cranes. Mobile cranes*, in-service wind clause 4.1.2.2.2. Load charts assume a load wind area of 1.0 m² per tonne with a drag coefficient cw of 1.2, so 1.2 m² of effective wind area (Ap × cw) per tonne (CPA pages 10–11, citing cl. 4.1.3.1.2). |
| BS7121 | BS 7121-1:2016, *Code of practice for safe use of cranes. General*, Annex D-1: flow chart for assessing loads with a large wind area (reproduced as CPA Figure 5, page 18). |
| Liebherr | Liebherr, *Wind influences on cranes* (2017): gust factors with height (Table 2) and drag coefficients (Table 1), as quoted by CPA. |
| OM | Open-Meteo forecast API, https://open-meteo.com/en/docs. Variables are listed below. |

## Units

- Wind speeds are in m/s throughout. mph is shown alongside: 1 m/s = 2.236936 mph
  (1 mph = 0.44704 m/s exactly, by definition).
- Mass in the inputs is in kg. The ratio below uses tonnes (t = kg / 1000).
- Heights are in metres above ground level.

## Step 1: 10 m gust corrected to height

Open-Meteo gives `wind_gusts_10m`, the gust at 10 m. Wind increases with height, so
the gust is scaled to the height of the boom / jib head, which the AP enters. CPA
says the crane's limit is checked against the wind at the boom / jib head, where the
crane's anemometer is, because it is the crane the limit protects (pages 22–23).

Gust factors from Liebherr Table 2, quoted in CPA page 21 (“1.181 at 50m AGL, 1.272
at 100m AGL and 1.329 at 150m AGL. This assumes a wind gust speed has been supplied
in the forecast”):

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

The interpolation between the published heights is LiftWatch's choice; CPA gives
the factors at 50, 100 and 150 m only.

### Terrain: open country, town or city (added in LW-M1.1; not applied from LW-M1.2)

> **Interim rule (LW-M1.2).** The town and city factors below have not yet been
> checked against EN 1991-1-4 and the UK National Annex by a qualified Appointed
> Person. Until they are, **the factor used is the highest of the open country, town
> and city factors at that height, whatever terrain is chosen.** In practice that is
> the city factor above 10 m and 1.000 at or below 10 m. The chosen terrain is still
> recorded, and is shown as "for information, not yet applied (pending AP review)".
> The switch is `APPLY_CHOSEN_TERRAIN` in `src/wind/constants.ts` (false). Turning it
> on needs the review, a new method version and an update to this file.
>
> This can only raise the gust at height, never lower it, compared with LW-M1.1. On
> open-country sites it is more cautious than the published Liebherr factors (at
> 30 m, 1.285 instead of 1.124, about 14 % higher).

How much the wind increases with height depends on the upwind terrain (CPA section
5.2 and Annex H). Rough ground (towns, city centres) slows the wind near the ground
more, so the gust rises more between 10 m and the jib head. CPA warns that default
parameters often suit open countryside and that city centres are much rougher.
The AP picks the terrain around the site (recorded, for information only under the interim rule):

| Setting | Means | EN 1991-1-4 category | z0 (m) | zmin (m) |
|---|---|---|--:|--:|
| Open country | Fields, coast, airfields, scattered buildings | II | 0.05 | 2 |
| Town | Suburbs, villages, industrial estates, woodland | III | 0.3 | 5 |
| City | City centre, ≥ 15 % covered by buildings over 15 m | IV | 1.0 | 10 |

Roughness lengths and minimum heights are from EN 1991-1-4 Table 4.1. CPA Annex H
gives similar classes (open agricultural land 0.03 m, villages and small towns 0.4 m,
larger cities 0.8 m).

- **Open country** uses the published Liebherr factors above, unchanged.
- **Town and city** use the gust profile of EN 1991-1-4 (clauses 4.3–4.5), as a ratio
  to the gust at 10 m. The basic wind speed cancels out:

```
vm(z) ∝ ln(z / z0)                      mean wind, flat terrain
Iv(z) = 1 / ln(z / z0)                  turbulence intensity (kI = 1)
vp(z) = vm(z) × √(1 + 7 × Iv(z))        peak (gust) speed, from qp = [1 + 7 Iv] ½ ρ vm²
F(h)  = vp(max(h, zmin)) / vp(max(10 m, zmin))
```

  The factor is never less than the open-country factor and never below 1.0.

Check: the same profile for open country (category II) gives 1.214 at 50 m, 1.305
at 100 m and 1.358 at 150 m, within 3 % of the Liebherr 1.181, 1.272 and 1.329. That
is why the published factors are kept for open country.

| Height | Open country | Town | City |
|--:|--:|--:|--:|
| 20 m | 1.078 | 1.130 | 1.182 |
| 30 m | 1.124 | 1.204 | 1.285 |
| 50 m | 1.181 | 1.297 | 1.412 |
| 100 m | 1.272 | 1.421 | 1.580 |
| 150 m | 1.329 | 1.493 | 1.676 |

Limits of this step: it assumes the 10 m forecast gust applies to the site's own
terrain, uses flat-terrain profiles (no hills, cliffs or escarpments), and does not
model funnelling between buildings, which can be stronger than any of these
factors. The UK National Annex to EN 1991-1-4 has its own, more detailed procedure;
this is a simplified estimate. Use the crane's anemometer on the day.

## Step 2: 10-minute mean to gust at height (for sources without gusts)

Some sources give only a 10-minute mean wind speed at 10 m. CPA page 21 gives these
factors to turn the 10 m mean into a gust at height (“1.653 at 50m AGL, 1.78 at 100m
AGL and 1.861 at 150m AGL. This allows for converting the 10-minute mean wind to a
maximum gust”):

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

Source: EN13000 assumption (1.2 m² effective wind area per tonne); the formula is the
one in CPA section 4.3 (page 12) and the Annex A calculator (page 40), based on the
Liebherr wind document; BS7121 Annex D-1 sets out the same assessment as a flow chart.

1. Projected area of the face presented to the wind:
   `Ap = length × height` (m²). For a panel lifted upright this is the panel face.
2. Effective wind area: `Aw = Ap × cw`. Default `cw = 1.2` for flat panels. The AP
   can change it.
3. Mass: `m = (load mass + rigging mass) / 1000` (t). CPA's calculator counts the
   hoist load as the load plus lifting accessories, hook block and any relevant
   portion of hoist rope (Annex A, page 40). LiftWatch asks for the load and for
   "rigging, hook block and hoist rope" separately and adds them. Only count what is
   actually lifted: a higher mass gives a higher permitted speed.
4. Ratio: `r = Aw / m` (m²/t).
5. Reference ratio from EN13000: `r0 = 1.2 m²/t` (`REFERENCE_AREA_RATIO` in config).
6. Permitted wind speed:
   - if `r ≤ r0`: `v_perm = v_chart` (the crane chart limit, unchanged)
   - if `r > r0`: `v_perm = v_chart × √(r0 / r)`
7. `v_perm` is never above `v_chart` (CPA Annex A, Note 1).

Why the square root: wind force is proportional to v² × Aw. The chart limit
assumes a wind area of r0 × m. Holding the force at the chart's design value,
`v_perm² × Aw = v_chart² × r0 × m`, so `v_perm = v_chart × √(r0 × m / Aw) = v_chart × √(r0 / r)`.

### Worked example (LiftWatch)

A timber frame wall panel. This example is LiftWatch's own; it is not in the CPA guide.
Panel 3.6 m × 2.4 m, cw 1.2, mass 1,300 kg, no rigging, chart limit 17 m/s.

- Ap = 8.64 m²
- Aw = 10.368 m²
- r = 10.368 / 1.3 = 7.975 m²/t
- v_perm = 17 × √(1.2 / 7.975) = 6.59 m/s (14.8 mph).

### Checked against the CPA guide's worked examples

LiftWatch reproduces every worked example in the guide to within its rounding (one
decimal place). These are automated tests (`tests/wind/loadArea.spec.ts`).

| CPA example | Guide | LiftWatch |
|---|--:|--:|
| Annex E Fig 15: shutter 2.4 × 6.6 m, 2.392 t, mobile crane 11 m/s | 4.3 | 4.27 |
| Annex E Fig 15: shutter 7.2 × 6.6 m, 7.215 t, mobile crane 11 m/s | 4.3 | 4.29 |
| Annex E Fig 15: pack of ply 2.4 × 0.7 m, 0.9 t, mobile crane 11 m/s | 8.1 | 8.05 |
| Annex E Fig 15: person basket 1.45 × 1.1 m, 0.64 t, mobile crane 11 m/s | 7.0 | 6.97 |
| Annex E Fig 14: shutter 2.4 × 6.6 m, 2.392 t, tower crane 17 m/s | 6.6 | 6.61 |
| Annex E Fig 14: pack of ply 2.4 × 0.7 m, 0.9 t, tower crane 17 m/s | 12.4 | 12.44 |
| Section 4.3: insulation pack 1.2 × 2.4 m, 113 kg, 11.1 m/s | 2.1 | 2.20 |

The insulation pack is the one difference. The guide works it as 11.1 × 0.198 and
prints 2.1, but 11.1 × 0.198 = 2.198, so 2.2 m/s. The guide's own description, “an
80% reduction”, matches 2.2 (2.2 is 19.8 % of 11.1), so the printed 2.1 is a rounding
slip in the guide, not a different method.

### The chart limit must be a gust

EN 13000 (clause 4.1.2.2, as quoted by CPA page 20) applies a 3-second gust to the
crane at height, and CPA says gusts, not means, should be used when deciding whether
a lift proceeds (section 3.3). LiftWatch compares gusts at height with that limit. If the AP
says the chart limit is a mean, the app does not assess. It asks for the gust figure
from the crane supplier or lift plan. Comparing a gust with a mean limit would
give a misleading result either way.

### What Open-Meteo's gust is (open item for AP review)

Open-Meteo's published definition of `wind_gusts_10m`, from its forecast API
documentation (https://open-meteo.com/en/docs, "Hourly Parameter Definition" table,
checked 25 October 2026):

> Variable `wind_gusts_10m`, valid time "Preceding hour max", unit km/h (mph, m/s,
> knots): "Gusts at 10 meters above ground as a maximum of the preceding hour"

The same page says: "Most weather variables are given as an instantaneous value for
the indicated hour. Some variables like precipitation are calculated from the
preceding hour as an average or sum." (Page source:
github.com/open-meteo/open-meteo-website, `src/routes/en/docs/+page.svelte`.)

How that compares with the gust EN 13000 assumes:

- **Averaging period not stated.** EN 13000 (clause 4.1.2.2, as quoted by CPA page 20)
  applies a **3-second gust** to the crane at height. Open-Meteo does not say over
  what period its gust is averaged. It is a value worked out by the weather model
  (the "best match" blend), not a measurement, and the models work gusts out in
  their own ways. LiftWatch therefore cannot show that the forecast gust is a
  3-second gust. It may be higher or lower than a 3-second gust measured at the
  same place.
- **10 m, over the model grid.** It is a gust at 10 m above ground for a grid
  square, not at the crane. LiftWatch scales it to height in step 1.
- **Which hour it belongs to.** The value stamped HH:00 is the highest gust in the
  hour **before** HH:00 (HH-1 to HH). LiftWatch shows and assesses each value as the
  hour **starting** at HH:00 (HH to HH+1), the same as the other forecast values.
  So, on a rising wind, the gust that falls in a given hour may only show up in the
  next hour's row, an hour late. The worst hour in a window can be understated by
  up to an hour of rising wind.

LiftWatch does not change any maths for this in LW-M1.2. It is listed as an open item
for AP review (below). Until it is reviewed, treat the forecast gust as an estimate
and rely on the crane's anemometer on the day.

## Step 4: hourly assessment

For each forecast hour:

```
ratio = v_gust(h) / v_perm
```

| Ratio | Status |
|-------|--------|
| below 0.80 | Below permitted speed (X % of limit) |
| 0.80 to 1.00 inclusive | Near permitted speed (X %) |
| above 1.00 | Above permitted speed (X %) |

X is the percentage of the permitted speed in the worst hour. Until LW-M1.1 these
were called "Within limits", "Near limit" and "Over limit"; the bands are unchanged.
"Below permitted speed" is shown in a neutral blue-grey with a plain circle, never
green or a tick: it is a comparison with the limit entered, not an approval.

The 0.80 "Near permitted speed" band is LiftWatch's own choice, set for this pilot. It is not
from CPA or any standard. CPA does stress allowing time to finish a lift and make
the crane safe before the limit is reached (section 6.1.3).

If the gust is missing for an hour, that hour has no status ("No data"). It does not
pass.

### Flags

Flags are shown next to the status. A flag never makes an hour pass, and the
absence of a flag never makes an hour pass either. The flags and their thresholds
are LiftWatch's own choices for this pilot, not from CPA or any standard.

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
The banner shows the worst hour in that window, ranked Above permitted speed, then
No data, then Near permitted speed, then Below permitted speed. Within one status the highest ratio is shown.

### Planning guidance

- Periods: runs of at least 2 consecutive hours that are below the permitted speed and in
  daylight. Labelled "Planning guidance only".
- 7-day outlook: for each day, the worst status in daylight hours and the highest
  gust at height. Labelled "Outlook — planning guidance only".

## Load schedule (several loads)

Each load in the plan gets its own permitted speed (step 3) and is assessed against
the same gust at height. Because the gust is the same for every load, the load with
the lowest permitted speed is the worst in every hour: that "governing" load sets
the banner and the record's headline figures. The assessment also shows, for each
daylight hour, which loads are below the permitted speed, to help sequence the day (CPA page
22). Rows pasted from a panel schedule are: reference, length, height, mass, and
optionally rigging and cw.

## Other checks (Checks tab)

These sit beside the wind method. They are saved with the decision record, but they
never change the wind status and never block a decision.

| Check | Rule | Source |
|---|---|---|
| Crane capacity | hook load = load + accessories + hook block and rope; utilisation = hook load ÷ chart capacity at radius. Flagged above 75 % and 90 %; over 100 % is over the chart | Hook load as CPA Annex A. The 75 % and 90 % bands are company-rule settings (`src/checks/capacity.ts`), not legal limits |
| Slings | β = asin(d ÷ leg length), d = half the spacing (2 legs), half the diagonal (4 legs) or spacing ÷ √3 (3 legs). Mode factor: 2 legs 1.4 (β ≤ 45°), 1.0 (≤ 60°); 3–4 legs 2.1, 1.5; over 60° not permitted. Required single-leg WLL = load ÷ factor | Uniform load method: BS EN 818-4, BS EN 13414-1, BS EN 1492-1; LEEA Code of Practice |
| Outrigger ground bearing | pressure = (outrigger load × 9.81 if in tonnes + mat mass × 9.81 ÷ 1000) ÷ mat area (kN/m²); compared with the allowable pressure; minimum mat area = load ÷ allowable | Simple uniform-pressure check. Assumes a stiff mat; CPA *Ground conditions for construction plant* (2014). Outrigger load from the manufacturer, allowable pressure from the ground assessment |
| Thorough examinations | crane in date if the lift date is within 12 months of the last examination; lifting accessories within 6 months | LOLER 1998 regulation 9 (HSE). A written scheme of examination can set other intervals |
| Cards | valid if the expiry date is on or after the lift date | — |
| Checklist and crew sign-on | Yes / No / N/A answers and names with times | Items drawn from common reasons plans fail review, CPA and STA guidance |

## Wind log on the day

Readings from the crane's anemometer (a gust at the boom / jib head) are compared
directly with the governing load's permitted speed. No height factor is applied.

| State | When |
|---|---|
| Below permitted speed | the last reading is below 80 % of the permitted speed |
| Near permitted speed | the last reading is 80 % to 100 % of it |
| Stop | a reading is above the permitted speed |
| Waiting | after a stop, readings are back at or below the limit; the wait runs from the first such reading |
| Wait period elapsed. The crane operator decides whether to restart | readings have stayed at or below the limit for the wait time (default 30 minutes, CPA 6.4.3; 10 or 20 can be chosen, BS 7121-5 uses 10 for tower cranes) |
| Winded off | logged as winded off for the day |

A reading above the limit while waiting resets the wait. After three resets the log
quotes CPA 6.4.3: the day may need to be declared winded off. Units: 1 mph =
0.44704 m/s, 1 km/h = 1/3.6 m/s, 1 knot = 1852/3600 m/s.

For information only, each reading is also compared with the forecast gust at
height for the same hour, and the average measured ÷ forecast ratio is shown
(CPA 5.2.2). It does not change any status.

## Not in this method

- **Wind direction.** CPA gives a rule of thumb, used mainly for crawler cranes on
  wind farms, of reducing the permissible speed by about 1 m/s for oblique winds and
  2 m/s for side-on winds (section 5.2.1, Figure 8). LiftWatch shows the direction but
  does not apply a reduction.
- **The crane operator decides.** CPA section 6.4: the crane operator has the final
  decision whether a lift starts, continues or is aborted. LiftWatch asks the AP to
  confirm this in every decision to proceed.

## Forecast request (Open-Meteo)

```
hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,wind_speed_80m,
       wind_speed_120m,cape,precipitation_probability,visibility,temperature_2m
daily=sunrise,sunset
wind_speed_unit=ms
timezone=Europe/London
timeformat=unixtime
forecast_days=7
```

### Times and the clock change (LW-M1.2)

`timeformat=unixtime` makes Open-Meteo return each hour, sunrise and sunset as an
exact instant, not a UK clock time. LiftWatch does all time arithmetic (hour ends,
the lift window, daylight, joining hours into periods, matching wind log readings
to forecast hours) with these instants and shows UK local time (Europe/London)
only for display. Earlier versions read the local clock times as if they were UTC.

- **Last Sunday in October** (25 October 2026): 01:00–02:00 happens twice. The day
  has 25 hourly values. The repeated hour is shown as "01:00 BST" then "01:00 GMT".
  A planned window that starts or ends at a repeated time starts at the first one
  and ends at the second, so it never loses the extra hour.
- **Last Sunday in March** (29 March 2026): 01:00–02:00 does not happen. The day has
  23 hourly values. A planned time inside the gap (for example 01:30) is moved
  forward by the hour that was skipped (02:30 BST).
- Records and saved forecasts from before LW-M1.2 hold local times only. They are
  read with the rule that a repeated clock time in a run of hours is the later one.

CPA notes that forecasts are usually for 10 m above ground and for the middle of a
grid square, so they can miss local features and neighbouring buildings (page 20),
and that any forecast data used to make decisions should be recorded (page 20).
LiftWatch stores the forecast values it used in every record.

The Worker rounds latitude and longitude to 2 decimal places (about 1 km) and caches
each site's response for 60 minutes. The fetch time and source are shown on screen
and stored in each record. Open-Meteo's default "best match" picks and blends
weather models for the location. The forecast response does not say which model
run was used, so LiftWatch records the time the forecast was fetched from
Open-Meteo.

## Open items for AP review

These are known questions about the method. Each needs a decision by a qualified
Appointed Person before the pilot is relied on. None of them is resolved by the
software.

1. **Terrain factors (step 1).** Check the town and city factors against
   EN 1991-1-4 and the UK National Annex. Until then the highest factor is used
   whatever terrain is chosen (interim rule, LW-M1.2).
2. **Forecast gust definition.** Open-Meteo's `wind_gusts_10m` is a model gust,
   "a maximum of the preceding hour", with no stated averaging period. Decide how it
   should be compared with the 3-second gust EN 13000 assumes, and whether a margin
   is needed (see "What Open-Meteo's gust is").
3. **Preceding-hour timing.** The gust stamped HH:00 covers HH-1 to HH, but is
   assessed as HH to HH+1. Decide whether each hour should also take the next value
   into account.
4. **The 80 % "Near permitted speed" band and the weather flag thresholds** are
   LiftWatch pilot choices, not from CPA or a standard.
5. **Capacity, sling and ground-bearing calculators.** Switched off from LW-M1.2
   until reviewed (see "Other checks").

## Version history

| Version | Change |
|---|---|
| LW-M1.0 | First pilot method. |
| LW-M1.1 | Terrain setting: town and city use the EN 1991-1-4 gust profile (categories III and IV); open country unchanged. Records saved under LW-M1.0 used open country. Load schedule, checks and wind log added; they do not change the wind maths. |
| LW-M1.2 | Interim terrain rule: the highest of the open country, town and city factors is used whatever terrain is chosen; the choice is recorded for information only. Forecast times are exact instants (Open-Meteo `timeformat=unixtime`), so the October and March clock changes are handled. Open-Meteo's gust definition documented, with open items for AP review. Status wording changed (no change to the bands). Capacity, sling and bearing calculators switched off pending review. |
