# Testing LiftWatch: step by step

About 20 minutes on your phone at **https://liftwatch.pages.dev**. Each step says
what to do and what you should see. If anything doesn't match, screenshot it and
send it over.

If you used LiftWatch before this update, your earlier records and set-up are kept.
If the page looks old, close the tab and open it again.

## 1. Set-up with terrain (2 minutes)

1. Tap **1 Set-up**. Enter your site postcode and tap **Find**.
2. Under **Terrain around the site**, tap **Open country**, then **Town**, then **City**.
3. Fill in:
   - Crane: any description
   - In-service wind limit: `17`
   - Where it came from: `Test`
   - Tap **Gust**
   - Boom / jib head height: `30`
   - Main load: reference `W01`, length `3.6`, height `2.4`, mass `1300`

**You should see** in **Working**: permitted **6.6 m/s (15 mph)**. The "Gust factor
at 30 m" line changes with the terrain: **1.124** for open country, **1.204** for
town, **1.285** for city.

## 2. Load schedule (3 minutes)

1. Under **Other loads in this plan**, tap **Paste from a panel schedule**.
2. Paste these lines (or copy rows from a real panel schedule in a spreadsheet):

```
W02, 4.8, 2.4, 1650
C01, 2.4, 1.2, 2.5t
G01, 6, 3, 900
```

3. Tap **Add these loads**.

**You should see** "3 loads added", and each load showing its own permitted speed.
G01 (a big, light gable) should be lowest at about **3.8 m/s**. C01 (a heavy, compact
load) should be highest at about **15.8 m/s**, close to the 17 m/s chart limit.

4. Tap **Check against the forecast**.

**You should see** "Governing load: G01" under the banner, and a **Loads hour by
hour** table with ○ ! ✕ (below, near, above the permitted speed) for each load in
each daylight hour, most wind-sensitive first. The banner reads, for example,
"Below permitted speed (62 % of limit)" in blue-grey: never green, never a tick.

## 3. Checks (5 minutes)

Tap **3 Checks**.

1. **Thorough examinations:** enter a crane examination date more than 12 months
   before the lift date. **You should see** a red "Out of date" line. Change it to
   a recent date and the line turns neutral grey (no tick, no green).
2. **Pre-lift checklist:** answer a few items. Tap **No** on "Overhead power
   lines". **You should see** it listed under **Summary → need attention**.
3. **Calculators switched off:** the **Crane capacity**, **Slings** and **Outrigger
   ground bearing** cards each say "Not available: awaiting review by a qualified
   Appointed Person". Steps 3a to 3c apply only to a review build made with
   `VITE_ENABLE_CALCULATORS=true`.

3a. **Crane capacity:** tap **+ Add a capacity check**. Enter radius `24`, chart
   capacity `1800` and hook block `250` (load and accessories fill in from the
   set-up). **You should see** "Hook load 1550 kg: 86 % of rated capacity: above
   75 %, justify in the plan."
3b. **Slings:** tap **+ Add a sling check**. Enter leg length `3`, between lifting
   points `3`, single-leg WLL `1000`. **You should see** "Leg angle 30° (0–45°
   band), mode factor 1.4: each leg needs a WLL of at least 929 kg". Change the
   spread to `5.5`. **You should see** over 60°, "Not permitted".
3c. **Outrigger ground bearing:** tap **+ Add an outrigger check**. Enter load `22`
   (tonnes), mat `1.2` × `1.2`, allowable `150`. **You should see** about
   150 kN/m², "100 %" or just over. Try a `1.5` × `1.5` mat and it drops to about
   96 kN/m².
4. **Crew briefing sign-on:** add two names with roles and tap **Sign on** for
   each. **You should see** them listed with the time.

## 4. Decision and records (3 minutes)

1. Tap **4 Decision**. **You should see** a Checks summary card at the top.
2. Choose **Proceed with conditions**, fill in your name and a condition, tick both
   boxes, and tap **Save record**.
3. On the record, tap:
   - **PDF**: the full record. Check it has the loads table, the terrain, the
     **Checks** section and the method link at the end.
   - **Briefing sheet**: one page. Check the **STOP** table shows each load's
     limit in m/s, mph, km/h and knots, the restart rule, and your crew names with
     blank signature lines.

## 5. Wind log on the day (4 minutes)

1. On the record, tap **Wind log on the day**.
2. Set the unit to **mph**. Log `5`. **You should see** a blue-grey "Last reading below the permitted speed" panel.
3. Log `20` (above the G01 limit of about 9 mph). **You should see** a red
   **"Stop: reading above the permitted limit"**, and under **Loads at the last
   reading**, "below" for the loads whose own limit is still above 20 mph (no ticks).
4. Log `6`. **You should see** an amber **"Waiting: below the limit since …"** with
   "0 of 30 minutes".
5. Keep alternating `20` and `6`. Each `20` after a `6` resets the wait. On the
   third reset, the panel quotes CPA's advice that the day may need to be declared
   winded off.
6. Add a note, then go back to the record and tap **PDF**. **You should see** the
   **Wind log on the day** section with every entry.

## 5a. Footer, privacy and terms (1 minute)

1. Scroll to the bottom of any screen. **You should see** links to **Method**,
   **Privacy (draft)** and **Terms (draft)**.
2. Open each. **You should see** a DRAFT banner, the CONFIG-CONTROLLER and
   CONFIG-CONTACT placeholders, and highlighted SOLICITOR / CONFIG items.
3. On **Records**, **you should see** a line saying whether persistent storage was
   granted. With records saved and no export in the last 7 days, **you should see**
   an **Export reminder**. Tap **Export all (JSON)** and it goes away.

## 6. Offline (2 minutes)

1. Open the app once with signal and run an assessment for your site.
2. Turn on **aeroplane mode**, close the tab, and open liftwatch.pages.dev again.

**You should see** the app open. Tap **2 Assessment**: a red-bordered **"Offline:
saved forecast"** notice with the time the forecast was fetched.

3. Turn aeroplane mode off and tap **Refresh forecast**. The notice goes.

## 7. Reuse (1 minute)

On a saved record, tap **Use as new set-up**. **You should see** the set-up screen
with the same site, terrain, crane and loads. On Checks, the dates, cards and
calculations are kept, and the checklist answers and sign-ons are cleared.

## What to look out for

- Any wording that could be read as permission to lift. It should never say
  "safe", "clear to lift" or "go".
- Numbers that don't match your own calculation or the CPA guide.
- Anything hard to tap with gloves or read in bright light.
- Checklist items that are missing or wrong for your sites.
