# Site progress: one stage list feeding plot % and site % (v69, as built)

Status: **built on `feature/site-progress-stages`, not merged, not applied to live.** Merging and the live apply each need Aled's explicit yes on the PR.
Design decided by Aled; build approved by Adam. This file replaces the earlier proposal. Where the two differ, this file is the one that counts.

---

## 0. Plain summary

**Before.**
- The weekly report stage list and the plot page grid were two separate lists.
- Neither one changed a plot's %. Plot % was typed in by hand, or filled in with "Suggest from Milestones".
- Site % was worked out in the browser, and only after someone saved one of three pages.
- External works counted as one extra plot.

**Now.**
1. **One list of 33 stages** is used by both the weekly report dropdown and the plot page grid ("Build Stages").
2. **Saving a weekly report raises the tagged plots' stages.**
   - Raise-only: a report never lowers a stage.
   - Ranges such as "22-27" count for every plot in the range.
   - Block names, "External / Engineering Works" and unknown tags are skipped.
   - The plot page can set any value, including lowering one, and can mark a stage N/A.
3. **Plot % = the higher of a manual figure and the calculated figure.**
   - The calculated figure is the average of the plot's applicable stages.
   - A manual figure (an "override") needs a note. Who set it and when is stored, and the history is kept.
   - While the manual figure is higher, the plot shows **Manual**.
   - Once the calculated figure catches up, the plot goes back to **Automatic** by itself, and that is logged.
   - There is also a "Switch back to automatic" button.
4. **Site % is recalculated by the database** whenever a stage, plot, block or external works figure changes.
5. **External works** is one figure plus a **share** for each site.
   - It is never set automatically.
   - Every change needs a dated note.
   - If a site isn't complete and the figure hasn't been updated for 21 days, it is flagged.
   - It can optionally be split into named **packages**, each with its own %, share and notes. The site figure is then their weighted average.
   - Weekly report tasks tagged External are shown beside the matching package as read-only suggestions.
   - **No share set → today's formula exactly**, with a "share not set" flag.
6. **Nothing moves at go-live.** Every Heol Crwys and Tudor Inn plot keeps its current figure as a manual override, with the note "Carried over at go-live — site taken over mid-build". The migration refuses to apply if any plot or site figure would change.

---

## 1. The 33 stages

Reference table `public.progress_stages` (`stage_key`, `name`, `sort_order`, `house_default_applicable`, `flat_default_applicable`). Signed-in users can read it; only migrations change it. The JS constant `PROGRESS_STAGES` / `BUILD_MILESTONES` in `tracker/js/app.js` must match it, and `tests/frontend/progress_stages_parity.test.mjs` checks that.

| # | Stage | key | House | Flat |
|---|---|---|---|---|
| 1 | Site Set-Up / Enabling Works | st_site_setup | N/A | N/A |
| 2 | Groundworks | st_groundworks | ✓ | N/A |
| 3 | Foundations (Foots) | st_foundations | ✓ | N/A |
| 4 | Drainage (Below Ground) | st_drainage | ✓ | N/A |
| 5 | Slab Pour / Oversite | st_slab | ✓ | N/A |
| 6 | Timber Frame Erect | st_timber_frame | ✓ | N/A |
| 7 | Brick & Block Superstructure | st_brick_block | ✓ | N/A |
| 8 | Scaffold Erect | st_scaffold_erect | ✓ | N/A |
| 9 | Roofing | st_roofing | ✓ | N/A |
| 10 | Windows & External Doors | st_windows_doors | ✓ | N/A (switchable) |
| 11 | Scaffold Drop | st_scaffold_drop | ✓ | N/A |
| 12 | Render | st_render | ✓ | N/A |
| 13 | Cladding / External Finishes | st_cladding | ✓ | N/A |
| 14 | 1st Fix – Carpentry | st_1fix_carpentry | ✓ | ✓ |
| 15 | 1st Fix – Electrical | st_1fix_electrical | ✓ | ✓ |
| 16 | 1st Fix – Plumbing & Heating | st_1fix_plumbing | ✓ | ✓ |
| 17 | 1st Fix – Gas | st_1fix_gas | ✓ | N/A (switchable) |
| 18 | Plastering / Drylining | st_plaster_dryline | ✓ | ✓ |
| 19 | 2nd Fix – Carpentry | st_2fix_carpentry | ✓ | ✓ |
| 20 | 2nd Fix – Electrical | st_2fix_electrical | ✓ | ✓ |
| 21 | 2nd Fix – Plumbing & Heating | st_2fix_plumbing | ✓ | ✓ |
| 22 | Carpentry Finals | st_carpentry_finals | ✓ | ✓ |
| 23 | Kitchen Fit | st_kitchen | ✓ | ✓ |
| 24 | Bathroom Fit | st_bathroom | ✓ | ✓ |
| 25 | Painting & Decorating | st_decorating | ✓ | ✓ |
| 26 | Flooring | st_flooring | ✓ | ✓ |
| 27 | Mastic | st_mastic | ✓ | ✓ |
| 28 | Solar Panels (PV) | st_pv | ✓ | N/A |
| 29 | External Works / Landscaping | st_external_works | N/A | N/A |
| 30 | Testing & Commissioning | st_testing | ✓ | ✓ |
| 31 | Clean | st_clean | ✓ | ✓ |
| 32 | Snagging | st_snagging | ✓ | ✓ |
| 33 | Handover / Practical Completion | st_handover | ✓ | ✓ |

- A house has 31 applicable stages and a flat has 17. Every default is a per-plot switch on the plot page.
- Stages 1 and 29 are site-wide on every plot, so site-wide civils are counted only through external works. Nothing is counted twice.
- All 30 old weekly-report stage names appear in this list verbatim, so old reports resolve by exact name. The en dash in "1st Fix – …" must match byte for byte.

## 2. Per-plot stage rows (`internal_milestones`)

The existing table is reused, so its RLS is unchanged: editors and `programme_write` parties can write; editors and `programme_read`/`programme_write` parties can read.

It gains these columns: `stage_key`, `applicable`, `retired_at`, `updated_at`, `updated_by`, `last_source` (`plot_page` / `report` / `migration` / `backfill`) and `last_report_id`. A partial unique index on `(plot_id, stage_key)` covers live rows.

`seed_plot_defaults()` now seeds the 33 `st_*` rows for new plots; gates, documents and snags are unchanged. The old 16/18-row grid is **retired** (`retired_at`) and never deleted. The UI, the calculations and the handover export read only live `st_*` rows.

Two triggers sit on the table:
- **Before:** a client write may change only `percent` and `applicable`. The row is stamped `last_source='plot_page'`, `updated_at` and `updated_by`. Retired legacy rows are left alone.
- **After:** writes a `progress_stage_events` row (old and new %, old and new N/A, source, report id, who, when, note), then recalculates the plot.

## 3. Weekly report → stages (raise-only, in the database)

Trigger `trg_weekly_reports_v69_progress` runs `AFTER INSERT OR UPDATE OF progress_items ON weekly_reports` and calls `apply_weekly_report_progress(report, 'report')`, a definer function.
- It fires on every save that changes content, drafts included. Status-only changes don't fire it.
- **Per item:** the stage must be one of the 33 names, and the % must be a number from 0 to 100.
- `resolve_plot_tags(project, tag)` turns a tag into plots:
  - it splits the tag on commas;
  - a tag equal to a block name, or to "External / Engineering Works", is skipped;
  - ranges `N-M` are expanded, with an optional "Plot(s)"/"Flat(s)" prefix, a hyphen or en dash, and a span of at most 200;
  - every other token matches by its first run of digits (leading zeros stripped), or else by exact lower-case text;
  - unknown tokens (for example "S278") are skipped.
- **Per matched plot and stage:** the stage is raised to the item's % only if that is higher and the stage is applicable. N/A stages are never raised.
- Editing or deleting a report lowers nothing. Lowering is done on the plot page, and the latest write wins.
- A party that can write reports (for example the clerk of works) feeds stages through reports, but can't edit the grid unless it has `programme_write`.
- JS `resolvePlotTags()` follows the same rules. `tests/lib/plot_tag_cases.json` (30 cases) is run against both the JS and the SQL versions.

**Quality gates:** `syncGateStatusFromMilestones()` uses the shared JS parser (range-aware, block names skipped).
- It still only considers house plots.
- It still only moves `not_started`/`in_progress` up to `under_review`. It never approves, never downgrades, and leaves N/A, Under Review and Approved gates alone.

## 4. Plot %: calculated, with an optional manual override

New columns on `plots`: `progress_calculated`, `progress_override`, `progress_override_note`, `progress_override_by`, `progress_override_at`.
- A check constraint requires a note of at least 3 characters whenever an override is set.
- `recalc_plot_progress(plot)`:
  - `calculated = round(avg(percent) of live applicable stages, 1)` (0 if none);
  - if an override exists and `calculated >= override`, the override is **superseded**: it is cleared and logged;
  - `progress_pct = greatest(override, calculated)`.
- The UI shows **Manual** while `override > calculated`, otherwise **Automatic**.
- RPCs (definer, `search_path` set, `authenticated` only):
  - `set_plot_override(plot, percent, note)`: the caller must be an editor, a note is required, and the figure must be higher than the calculated one;
  - `clear_plot_override(plot, note)`: "Switch back to automatic".
- History lives in `plot_progress_overrides`, with actions `set` / `cleared` / `superseded` / `carried_over`, note, who (id and email) and when. Members can read it; clients can't write it.
- Guard `plots_v69_progress_guard`: client writes to `progress_pct`, `progress_calculated` or the override columns are **ignored**. They're restored, not rejected, so a cached old page doesn't break.
- The typed plot % input and "Suggest from Milestones" have been removed from the plot page.

## 5. Site % (`projects.actual_progress_pct`)

`recalc_project_progress(project)` runs from triggers on plot, block and external works changes.

```
plots_part = ( Σ plots.progress_pct + Σ blocks.progress_pct × max(flats in block, 1) )
             ÷ ( #plots + Σ max(flats in block, 1) )            -- today's block weighting

share set:   site % = share/100 × ext + (1 − share/100) × plots_part
share unset: site % = round((Σ plots + Σ block × max(flats,1) + ext) ÷ (#plots + Σ max(flats,1) + 1), 1)
             -- today's formula exactly, plus a "share not set" flag
no plots/blocks: site % = ext
```

- Results are rounded to 1 dp.
- Client writes to `actual_progress_pct` are ignored.
- `recalculateActualProgress()` and `suggestPlotProgress()` have been removed from `app.js`.
- Block % stays typed on the block page. The block page's Suggest button (which mismatched block names) has been removed.

## 6. External works

- New `projects` columns: `external_works_share` (0–100, null = not set) and `external_works_updated_at`. `external_works_pct` is kept.
- **Never set automatically.**
- Guard `projects_v69_progress_guard`: a direct client change to `external_works_pct` or `external_works_share` raises "External works changes need a note. Use Site Details." (42501).
- **RPCs** (definer, editor **and not party-only**, a note of 3–500 characters, `authenticated` only):
  - `set_external_works(project, percent|null, share|null, note)`: a null % keeps the current figure. Changing the % directly while packages exist is refused, because the packages drive it.
  - `save_external_works_package(project, package_id|null, name, share, percent, report_stages[], note)`.
  - `retire_external_works_package(package_id, note)`: retires the package, never deletes it.
- **Packages** live in `external_works_packages` (name, share >0–100, %, the report stages it covers, retired_at). With live packages, `external_works_pct` = their share-weighted average. Shares are relative weights; they don't need to add up to 100.
- **History** lives in `external_works_updates`, with kinds `site` / `package_added` / `package_updated` / `package_retired`, old and new values, note, who and when. Members can read it; clients can't write it.
- **Report suggestions (read-only):**
  - Weekly report tasks tagged "External / Engineering Works" are grouped by stage.
  - Each group is shown beside the package whose `report_stages` includes that stage, or else in an "Unassigned" list.
  - They are never applied.
- **Stale flag:** the site isn't complete, and the last external works update (or the site creation date) is more than 21 days ago. It is computed when the page is read, and shown on Site Details and the dashboard tile.
- **New site form:** an optional share, saved through `set_external_works` with the note "Set at site setup".

## 7. Go-live data step (inside v69, one time, guarded)

The step is guarded by a `progress_migration_runs` marker. On a re-run of `schema.sql`, it only re-retires legacy-key rows that earlier sections may re-insert. In order:
1. **Snapshot:** `legacy_v69_internal_milestones`, `_plot_progress`, `_block_progress`, `_project_progress`.
2. **33 `st_*` rows per plot** with default N/A. The old grid is carried across:
   - copy by key;
   - Dry Lining and Plastering are averaged into Plastering / Drylining;
   - every mapping is logged in `progress_stage_mapping_log` and `progress_stage_events`;
   - plots where the two are more than 25 points apart are flagged in `progress_migration_flags`.
3. **Retire** the legacy rows.
4. **Backfill** every past report, raise-only (`source='backfill'`).
5. **Compute** `progress_calculated` for every plot.
6. **Carry over:** every plot with a stored % above 0 gets an override equal to its stored %, with the note "Carried over at go-live — site taken over mid-build" (action `carried_over`). This covers every Heol Crwys and Tudor Inn plot. Red Dragon and County Flats are all at 0, so nothing is carried there. A carried figure that the calculated figure already reaches is superseded at once and logged (none on live).
7. **Recalculate** plots, set `projects.stage_progress_since`, then recalculate sites.
8. **Hard acceptance:** if any plot, block or site figure differs from the snapshot, it raises `v69 go-live stopped: figures would change (…)`. `schema.sql` runs as one transaction, so **nothing is applied**.
9. Write the marker row, with counts.

The early-stage tick list (`EARLY_STAGES.md`, 770 proposed values) is **not** applied. Overrides replace it, and it stays as reference only.

**Monthly reports:** for the first monthly report created after `stage_progress_since`, `monthly_reports.progress_basis_note` gets one line (`MONTHLY_PROGRESS_BASIS_NOTE` in `app.js`): "From this report, site progress is worked out from each plot's build stages (raised by weekly reports). Plots taken over mid-build keep their previous figure as a manual starting point until the stages catch up." It is shown on the report view and in print. Past reports are unchanged.

**Plot Handovers export:** only live stage rows are exported, N/A shows as "N/A", and the list shows a "manual" label.

**Rollback:** no rollback function is shipped.
- **Before the live apply:** don't apply.
- **After it:** the snapshots hold every pre-v69 value and nothing was deleted. To roll back by hand: un-retire the legacy rows, set the figures back from the snapshots, and drop the v69 triggers.

## 8. Permissions summary

| Object | Read | Write |
|---|---|---|
| progress_stages | authenticated | migrations only |
| internal_milestones | unchanged | unchanged (client may change `percent` and `applicable` only) |
| progress_stage_events | editors and programme parties | definer functions only |
| plot_progress_overrides, external_works_packages, external_works_updates | members | RPCs only |
| progress_migration_* , legacy_v69_* | none (revoked from anon and authenticated) | migration only |

- Every SECURITY DEFINER function sets `search_path = public`.
- Internal functions have execute revoked from public, anon and authenticated.
- The 5 RPCs are granted to `authenticated` only. Nothing is granted to anon.

## 9. Risks

- **Draft saves raise stages.** It's visible in the event log ("Last set by: weekly report") and fixable on the plot page.
- **Every recalculation of `projects` writes an `audit_log` row** through `trg_audit_projects`.
- **The stale flag shows on all four live sites** until Aled saves a note for each.
- `plot_progress_overrides.changed_by_email` stores the email of whoever changed the override, so members can see who did it.
- **The live apply must run as a single transaction**, so that a STOP leaves nothing applied.
- **Triggers are row-level.** A very large report save recalculates once per stage change.
