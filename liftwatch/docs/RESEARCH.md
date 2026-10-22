# What gets in the way of planning and approving crane lifts

Research notes for the LiftWatch pilot, written from the point of view of an
Appointed Person (AP) and lift supervisor on a UK timber frame site. Each problem
says what the evidence is, and what LiftWatch now does about it.

**About the sources.** The main source is the CPA/TCIG 2507 guide, *Planning and
Control of Lifting Operations in Wind* (V1, July 2025), which was read in full.
Other sources are industry guidance, a few trade bodies (LEEA, STA, HSE) and
software and consultancy websites. Most of the "why plans fail" evidence comes
from practitioners and vendors, not independent studies, so treat it as experience
rather than statistics. Some websites could not be opened from the build
environment, so for those only search summaries were used. Sources are listed at
the end.

## The problems, and what LiftWatch does

### 1. Wind is the hardest part to plan, and the easiest to get wrong

- Forecasts are for 10 m above ground, often as a 10-minute mean, for the middle of
  a grid square. The crane's limit is a 3-second gust at the jib head (CPA pages
  20–21).
- APs "struggle to understand the shape-factor assessment", and few lifts are
  planned with it (CPA 4.4).
- Wind at height depends on the terrain: city sites differ from open country (CPA
  5.2, Annex H).
- Anemometers and forecasts use different units: m/s, mph, km/h and knots.

**LiftWatch:** gust height factors, a terrain setting (open country, town, city),
the wind-area reduction with the working shown step by step, and limits printed in
all four units on the briefing sheet and in the wind log.

### 2. More time is lost to poor sequencing than to wind

- CPA 4.4: "winding off due to wind sensitive loads is a smaller percentage than
  lost time due to inefficient use of load bays / site logistics".
- CPA page 22: do the wind-sensitive lifts in calmer periods and the heavy, compact
  lifts when it is windier.
- A timber frame day is many different panels, not one load.

**LiftWatch:** a load schedule. Paste the supplier's panel schedule, and every
panel gets its own permitted speed. A table shows which loads are within limits in
each daylight hour, so the day can be sequenced around the wind. The most
wind-sensitive load sets the status.

### 3. Capacity not checked against the configuration on the day

- Reviewers say the most common reason a plan fails review is that the load chart
  capacity was not checked against the actual configuration. Plans running close
  to capacity without justification are returned.
- Lifting accessories, the hook block and hoist rope are often left out of the
  hook load (CPA Annex A counts them).

**LiftWatch:** a capacity check on the Checks tab. Load + accessories + hook block
and rope against the chart capacity at radius, flagged above 75 % and 90 %
(company-rule settings, not legal limits).

### 4. Load weight assumed, not confirmed

"About 5 tonnes" is not a basis for a lift plan. Unverified weight is called the
most dangerous error.

**LiftWatch:** a checklist item, and panel weights taken straight from the
supplier's schedule instead of retyped.

### 5. Ground bearing assumed, not calculated

Ground failure under an outrigger (punching shear under one pad) is a leading
cause of overturning. Bearing pressure is often assumed rather than calculated
against the ground information, and many clients do not realise ground conditions
are their responsibility (CPA ground conditions guidance).

**LiftWatch:** an outrigger mat check: (outrigger load + mat weight) ÷ mat area
against the allowable pressure, with the minimum mat area. Outrigger loads come
from the manufacturer's software and the allowable pressure from the ground
assessment. LiftWatch does not guess either.

### 6. Sling angles and leg ratings

Leg angles above 60° to the vertical, and WLLs read off the wrong angle band, are
classic rigging errors.

**LiftWatch:** a sling check. It works out the leg angle from the leg length and
the spacing of the lifting points, applies the uniform load method factors (LEEA,
BS EN 818-4 / 13414-1 / 1492-1), and gives the minimum single-leg WLL needed.

### 7. Exclusion zones and overhead lines

Exclusion zones are drawn round the crane base instead of the load's swept area.
Overhead lines need GS6 controls (National Grid minimum distances: 7 m at
275/400 kV, 6 m at 132 kV, 3 m at 11/33 kV, 1 m at LV).

**LiftWatch:** checklist items. There is no drawing tool yet (see "Not built").

### 8. Certificates out of date

Under LOLER regulation 9, lifting accessories need a thorough examination every 6
months and cranes every 12. Slings are their own lifting equipment and are the
item most often missed.

**LiftWatch:** examination dates and card expiry dates are checked against the
lift date, not today's date.

### 9. The briefing is not done, or not recorded

The lifting team must know the permissible wind speed (CPA 6.1.3). STA guidance
defines the AP and lift supervisor roles and calls for weather checks before a
lift. Paperwork scattered between operators, slingers and APs is a recurring
complaint.

**LiftWatch:** crew sign-on on the phone with times, and a one-page briefing sheet
with the stop reading for every load in four units, the restart rule, the day's
flags, checks needing attention and signature lines.

### 10. Stopping and restarting is not recorded

CPA 6.4.3: wait 30 minutes after the wind drops below the limit; the timer resets
if it goes over again; after three or four resets, consider winding off for the
day; "keeping accurate records should remain essential". The crane operator has the
final say (CPA 6.4). If something goes wrong, the AP must be able to show the
manufacturer's instructions were considered (CPA 4.4).

**LiftWatch:** a wind log attached to the decision record. It shows the stop and
wait states, counts resets, prompts about winding off after three, and keeps an
append-only record with names and times. It never says a lift may go ahead.

### 11. Plans change on the day

Schedule pressure drives informal changes at the point of lift. If the planned
method no longer works, the lift should stop and be reassessed.

**LiftWatch:** "Use as new set-up" re-runs a saved plan in seconds for a new date,
crane configuration or set of loads, with the checks carried over.

### 12. No signal on site

Sites often have poor signal.

**LiftWatch:** works offline. The app and PDF library stay on the phone, and the
last forecast for the site is used with a clear "offline" warning and its fetch
time.

### 13. Nobody knows how good the forecast is at their site

CPA 5.2.2: contractors are trialling comparing forecasts with on-site readings to
correct future forecasts.

**LiftWatch:** the wind log compares each reading with the forecast gust at height
for that hour and shows the average ratio. Over a pilot, this is the evidence for
whether to trust the forecast at a site.

## Not built yet, and why

| Idea | Why it matters | Why not yet |
|---|---|---|
| Multi-person approval (AP → principal contractor → client), shared plans | Principal contractors approve every subcontractor plan; paper sign-off is slow | Needs accounts and a server (planned: Supabase) |
| Lift categorisation (basic / intermediate / complex, BS 7121) | Under-classifying a complex lift is a root cause of incidents | Only secondary sources found for the BS 7121 wording; needs the standard |
| Manufacturer outrigger loads and load charts | Removes retyping and reading errors | Manufacturer data and licensing (e.g. Liebherr LICCON, Crane Planner) |
| Site plan with crane, radius, exclusion zone and overhead lines | Exclusion zones round the load path; GS6 distances | A drawing tool is a large piece of work |
| Wind direction reduction (1 m/s oblique, 2 m/s side-on) | CPA 5.2.1 rule of thumb | Mainly for crawler cranes on wind farms; needs the jib orientation |
| Alerts when the forecast changes | Earlier warning of wind-off days | Needs a server and notifications |
| Live crane anemometer feed | No retyping of readings | Needs telemetry access per crane make |
| Tandem lifts | Highest-risk lifts | Outside the timber frame pilot |

## Choices that need an AP's review

These are LiftWatch defaults, not rules from a standard:

- Capacity bands at 75 % and 90 %.
- The "Near limit" band at 80 % of the permitted wind speed.
- The weather flags and their thresholds.
- The 14 checklist items.
- The 30-minute restart wait (CPA 6.4.3 "common practice"; 10 and 20 minutes can
  be chosen).
- The terrain categories mapping to EN 1991-1-4 categories II, III and IV.

## Sources

- CPA/TCIG 2507, Planning and Control of Lifting Operations in Wind, V1, July 2025 (primary; read in full).
- LEEA COPSULE, Rating for various modes of use: https://copsule.leeaint.com/copsule/en-GB/latest/id-ec70f5a1-4e20-4c49-9679-1f8e626d5cfc.html
- HSE, Thorough examination of lifting equipment: https://hse.gov.uk/work-equipment-machinery/thorough-examinations-lifting-equipment.htm
- National Grid, overhead line exclusion zones: https://customer.nationalgrid.co.uk/downloads-view-reciteme/670406
- STA Health and Safety Code of Practice: https://sipbuilduk.co.uk/wp-content/uploads/2023/03/Health-and-Safety-Code-of-Practice.pdf
- RMT Safety Solutions, Lift plan checking: what we check and why plans fail: https://www.rmtsafetysolutions.com/blog/lift-plan-checking-what-gets-checked-and-why-plans-get-rejected
- Construction Suite, Lifting plan guide: https://construction-suite.com/guides/lifting-plan
- Evolution Safety Solutions, When are lifting plans required: https://evolutionsafetysolutions.co.uk/when-are-lifting-plans-required/
- Trade2Base, Appointed Person for lifting operations: https://www.trade2base.com/blog/appointed-person-lifting-uk
- HSE Blog, Crane safety in piling operations (ground bearing): https://www.hseblog.com/crane-safety-piling-operations/
- Cranes for You, Ground conditions for construction plant: https://www.cranesforyou.com/knowledge/ground-conditions-construction-plant/
- Construction Briefing, CPA outrigger load calculator: https://www.constructionbriefing.com/news/cpa-provides-outrigger-load-calculator/1102277.article
- SRM minimum standards for lifting operations (lift categories): https://www.srm.com/media/bdnfaeqs/srm-minimum-standards-lifting-and-rigging-operations-for-subcontractors.pdf
- Balfour Beatty, Suppliers guide to lifting procedures for lorry loaders: https://www.balfourbeatty.com/media/317043/hsf-rm-0039d-a-suppliers-guide-to-lifting-procedures-for-lorry-loaders.pdf
- Crane Team (digital lift plans and pre-use checks): https://www.craneteam.co.uk/
- LiftPlanProUK: https://www.liftplanprouk.com/
- Liebherr Crane Planner 2.0: https://www.liebherr.com/en-us/mobile-and-crawler-cranes/service/crane-planner-2-0-4407488
- Construction Magazine, UK tower crane incidents: https://www.constructionmagazine.uk/2026/07/uk-tower-crane-incidents-causes-enforcement-lessons.html
