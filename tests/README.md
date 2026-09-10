# Site Tracker — automated tests

The application itself (`tracker/`) ships with zero build step and zero
runtime dependencies — that doesn't change. `package.json` at the repo
root exists only to pin the two tools this test suite needs (`jsdom`,
`pg`) so they install the same way locally and in CI.

## Running the tests

```
npm install
npm test
```

That's the one command — it runs every test file in `tests/` (Node's
built-in test runner auto-discovers `**/*.test.mjs`). Narrower commands
exist for working on one area at a time:

| Command | Runs |
|---|---|
| `npm test` | everything |
| `npm run test:security` | `tests/security/` only |
| `npm run test:database` | `tests/database/` only |
| `npm run test:frontend` | `tests/auth/`, `tests/frontend/`, `tests/uploads/` |

## What needs a database, and what doesn't

**`tests/security/` and `tests/database/` need a real PostgreSQL** —
they connect over TCP to `127.0.0.1:5432` as user `postgres` (password
`postgres` by default; override with `PGHOST`/`PGPORT`/`PGUSER`/
`PGPASSWORD` env vars) and create/drop their own disposable databases
per test file (`tracker_test_*`). This is the same connection shape
GitHub Actions' `postgres:` service container provides, so the exact
same test files run locally and in CI with no changes — see
`.github/workflows/test.yml`.

**`tests/auth/`, `tests/frontend/`, and `tests/uploads/` are pure
Node** — no database, no network. They run a tracker page's *real*
inline `<script type="module">` body under `jsdom` (see
`tests/lib/jsdom-harness.mjs`), with a mocked `supabase` object standing
in for the network. They never import a reimplementation of the app's
logic — the extraction step strips only the `import` line and runs the
rest of the file's actual source.

Nothing in this suite ever touches the real Supabase project. See
"Test data isolation" below.

## Structure

```
tests/
  lib/                    Shared test infrastructure, not tests themselves
    mock_setup.sql          Reconstructs auth.*/storage.* on a plain Postgres
    db.mjs                  pg connection + role-switching helpers
    jsdom-harness.mjs        Extracts + runs a real page's inline script

  security/               Real database, real non-superuser `authenticated`
                           role — the actual RLS/storage boundary, not a mock.
    org_isolation.test.mjs   Organisation A/B SELECT/INSERT/UPDATE/DELETE
                             isolation, including every child table and a
                             fully unrelated stranger. The highest-priority
                             file in this repo.
    project_roles.test.mjs  Owner / collaborator / snagging-only permissions
                             within one project.
    invites.test.mjs        Collaborator + snagging invite/join, correct org
                             enrolment, revoked/invalid codes, no downgrade.
    storage.test.mjs        site-photos bucket: path-derived project
                             authorisation, cross-org upload/delete denial,
                             snagging-only area restriction, bucket-level
                             size/MIME config.
    dashboard.test.mjs       Project Control Dashboard: proves the
                             dashboard's UNFILTERED-by-project query
                             shape (relying entirely on RLS to scope
                             results) still can't leak another
                             organisation's or project's rows, that a
                             snagging-only member's dashboard queries
                             return zero rows (not partial ones), and
                             that aggregate counts can't be used to
                             infer an inaccessible project's existence.
    inspections_performance.test.mjs  Seeds 15 projects / 75 inspections /
                             300 findings and proves the portfolio
                             finding-signal query stays one broad
                             select, backed by real index usage
                             (inspection_id and project_id+severity),
                             not a sequential scan.
    dashboard_performance.test.mjs  Seeds 25 projects / 500 actions and
                             proves the portfolio query shape stays a
                             fixed small number of broad queries (never
                             one per project — the N+1 pattern this
                             priority was told to watch for), backed by
                             real index usage (EXPLAIN).
    audit_log.test.mjs      Audit trail: INSERT/UPDATE/DELETE record
                             shape, chronological ordering, bulk-operation
                             fan-out, cross-org isolation, RLS mirroring
                             the audited table's own read rule, and
                             tamper prevention (no client can INSERT,
                             UPDATE, or DELETE an audit_log row directly).
    inspections.test.mjs    Inspections: CRUD (inspections, findings,
                             evidence), org_id derivation, cross-org and
                             cross-project isolation, snagging-only
                             members fully excluded, IDOR (a finding
                             cannot be attached to another project's
                             inspection; a linked Action must belong to
                             the finding's own project), audit
                             integration (including Action linkage and
                             that a rejected cross-org write fabricates
                             no audit row), and CHECK-constraint/
                             immutability edge cases.
    actions.test.mjs        Actions Engine: CRUD, org_id derivation
                             (never client-trusted, even when spoofed),
                             cross-org isolation, cross-project isolation
                             within the same org, snagging-only members
                             fully excluded, invalid-assignee rejection,
                             audit integration (via the existing generic
                             trigger — no second audit system), and
                             status/priority/transition validation edge
                             cases (including the completed->open reopen
                             path and cancelled being terminal).
    snags.test.mjs          Defects / Snagging rationalisation: assignee
                             validation (any project role, including
                             snagging-only — unlike Actions), action_id/
                             inspection_finding_id linkage IDOR (same-
                             project required, cross-project rejected),
                             the resolved-vs-verified model (editor-only,
                             closed-only, reopen always auto-clears with
                             no permission barrier), closed_date auto-
                             fill/clear, cross-org and cross-project
                             isolation, and audit integration proving the
                             pre-existing generic trigger needed zero
                             changes (including that a rejected
                             cross-project link fabricates no audit row).
    snags_performance.test.mjs  Seeds 15 projects / 60 plots / 300 snags
                             and proves the portfolio snag-signal query
                             stays one broad select, backed by real index
                             usage (project+status, project+due_date,
                             action_id), not a sequential scan.
    weekly_reports.test.mjs  Weekly Reporting: the draft->reviewed->
                             approved->issued lifecycle (including
                             rejecting a skipped stage and a backward
                             jump that isn't Revise), content-locking
                             once approved/issued (including a single
                             UPDATE that tries to transition into a
                             locked status while also sneaking in a
                             content edit), unchanged editor-only RLS
                             (snagging-only fully excluded), cross-org
                             and cross-project isolation (including that
                             the underlying Actions/Snags/Findings data
                             a report's position is built from can't
                             leak across projects through aggregation),
                             audit integration proving the pre-existing
                             generic trigger needed zero changes, and
                             inspection_findings.resolved_at's set/clear-
                             on-transition behaviour.
    weekly_reports_performance.test.mjs  Seeds 200 actions / 150 snags /
                             100 findings on one project (plus 20 other
                             projects in the same org with their own
                             data) and proves getWeeklyReportPosition()'s
                             six project-scoped queries stay fixed-cost
                             and unaffected by the rest of the
                             portfolio, backed by real index usage
                             (including the new weekly_reports
                             project+week_starting index).

  database/                Real database — migration integrity.
    migrations.test.mjs      Fresh install, required tables/functions/RLS,
                             idempotent re-run, the actual pre-existing
                             -data migration path (old schema + real data →
                             current schema, also re-run for idempotency),
                             audit-trail-specific checks (installing
                             audit_log on an existing database never
                             fabricates historical records for the
                             backfill itself, and its triggers are never
                             duplicated on repeated re-application), and
                             the equivalent pair for the Actions Engine
                             (no Actions or Actions audit history
                             fabricated from pre-existing data; its
                             table/indexes/triggers/policies are
                             idempotent). Also covers Defects / Snagging
                             (Priority 8): unlike Actions/Inspections,
                             snag_items already existed pre-migration, so
                             this proves a realistic PRE-EXISTING snag
                             (fixed id) survives with every existing
                             field/photo preserved and its new columns
                             (assigned_to/due_date/action_id/
                             inspection_finding_id/verified_at/
                             verified_by) simply null, never fabricated —
                             plus idempotency of the new columns/indexes/
                             trigger/helper function across repeated
                             re-application. Also covers Weekly
                             Reporting (Priority 9): like snag_items,
                             weekly_reports already existed pre-
                             migration, so this proves a realistic PRE-
                             EXISTING report (fixed id) keeps its human-
                             entered content untouched and is
                             automatically given status='draft' (the
                             correct, non-destructive default for
                             historical data — it never retroactively
                             becomes "issued"), plus idempotency of the
                             new columns/indexes/trigger and of
                             inspection_findings.resolved_at.
    fixtures/
      pre_organisations_schema.sql   sql/schema.sql as it existed immediately
                                     before Priority 1 (git rev 0b37633) — a
                                     static snapshot, not a live git lookup,
                                     so CI needs no special git history access.
      seed_pre_existing.sql          Representative pre-existing production
                                     data applied on top of it.

  auth/                    Pure Node + jsdom.
    login_logout.test.mjs   requireAuth()/signOut() from app.js, plus
                             login.html's real sign-in form.
    password_reset.test.mjs "Forgot password?" through to reset-password.html.

  frontend/                Pure Node + jsdom.
    dashboard_project_creation.test.mjs   Loading, empty state, and the
                             ensure_organisation()-before-insert flow.
    reliability_writes.test.mjs   A failed database write reverts the
                             optimistic UI instead of showing false success
                             (plot-detail.html's gate-status handler).
    weekly_report_save.test.mjs   The same class of fix in the main weekly
                             report save path (syncCommercialItems()).
    xss.test.mjs             escapeHtml() itself, plus real rendering
                             functions (dashboard, commercials, snagging)
                             fed <script>/onerror payloads — asserts the
                             payload became inert text, not that it was
                             merely absent.
    inspections_helpers.test.mjs  countFindingSignals() and the two new
                             computeControlStatus() rules it feeds —
                             critical open findings, and high-severity
                             findings escalated only via their linked
                             Action's own due_date (findings have no
                             due date of their own) — against fixed
                             dates.
    inspections_workflow.test.mjs  inspection-detail.html's real inline
                             script: create inspection -> add finding ->
                             create Action -> verify the linkage renders
                             -> resolve finding, plus proof that
                             completing the linked Action elsewhere
                             never auto-resolves the finding. Also
                             covers Create Snag from the same finding
                             (Priority 8) — independent of the Action,
                             and the finding card renders the linked
                             snag.
    dashboard_helpers.test.mjs  categoriseAction()/aggregateActionCounts()/
                             countHighSeverityHsIssues()/computeControlStatus()
                             — overdue/due-today/due-soon boundaries, the
                             completed/cancelled exclusion, and every
                             Attention/Watch/On-Track rule, all against
                             fixed date strings, never the real clock.
                             Also covers categoriseSnag()/countSnagSignals()
                             (Priority 8) — the same due_date boundaries
                             applied to snags, high-priority-with-no-due-
                             date as a Watch-only signal (never Attention
                             on priority alone), and the new Attention/
                             Watch reasons computeControlStatus() derives
                             from them.
    dashboard_control.test.mjs  dashboard.html's real inline script:
                             totals/project-list/attention-list
                             rendering, both filters, project/action
                             navigation links, the empty-attention-list
                             state, and — the state a control dashboard
                             must never blur — a genuinely FAILED query
                             rendered as a real error with Retry, never
                             as misleading zeros.
    actions_helpers.test.mjs  actionDueState() (overdue/due-today/
                             upcoming/completed/cancelled/none) and
                             validActionStatusTransitions(), the client-
                             side mirror of the server's transition table.
    actions_workflow.test.mjs  actions.html's real inline script: the
                             critical create -> assign -> update ->
                             complete workflow, plus the default "Active"
                             filter correctly hiding completed work.
    weekly_report_helpers.test.mjs  summariseActionsForReport()/
                             summariseSnagsForReport()/
                             summariseInspectionsForReport()/
                             summariseHsForReport()/
                             computeReportExceptions()/
                             computeReportActivity() — period-boundary
                             matching (inclusive both ends), overdue/
                             due-during-period anchored on the report's
                             own week_ending never the real clock, and
                             the reused Attention/Watch/On Track rules
                             — all against fixed date strings.
    weekly_report_workflow.test.mjs  weekly-report-form.html's and
                             weekly-report-view.html's real inline
                             scripts: a new report auto-generates a
                             system position, Refresh Position calls
                             through with the current period, an
                             approved/issued report disables the form
                             and offers Revise (which unlocks it again),
                             and the view page's lifecycle buttons show
                             only the real valid next steps and call
                             the right function.

  uploads/
    client.test.mjs          uploadPhoto()'s client-side size/MIME
                             pre-check — UX only; the real boundary is
                             tests/security/storage.test.mjs.
```

There's no separate `tests/migrations/` folder even though the brief
that shaped this suite suggested one — migration integrity is entirely
about schema application, so it lives under `tests/database/` instead of
splitting into an near-empty sibling directory.

## Preventing false positives

Every RLS/storage assertion in `tests/security/` runs as a real,
non-superuser Postgres role (`authenticated`, with the session GUC
`auth.uid()` reads set via `set_config()`) against a database with the
real policies from `sql/schema.sql` applied — never the schema-applying
superuser, which bypasses RLS entirely, and never a mocked Supabase
client standing in for the database itself. A test that asserted
"RLS works" against a mock would be worthless; these assert it against
the actual boundary.

`tests/lib/mock_setup.sql` reconstructs just enough of `auth.*` and
`storage.*` for this to work (including `storage.foldername()`, used by
the storage policies) — it is **not** a Supabase emulator. It doesn't
reproduce Supabase Storage's HTTP API, so `tests/security/storage.test.mjs`
verifies the bucket's `file_size_limit`/`allowed_mime_types` by reading
the config row rather than by attempting a real rejected upload — that
boundary genuinely lives in Supabase's hosted storage service, not in
Postgres, and is documented as such where it's tested.

## Test data isolation

Nothing here runs against the live Supabase project. `tests/security/`
and `tests/database/` create and drop their own disposable
`tracker_test_*` databases on whatever Postgres they're pointed at
(local, or CI's service container) — production is never that Postgres.
`tests/auth/`, `tests/frontend/`, and `tests/uploads/` never open a
network connection at all; their "Supabase" is a plain JS object
provided by the test.

## CI

`.github/workflows/test.yml` runs `npm test` against a `postgres:16`
service container on every push and pull request — see that file for
the exact steps. A failing test fails the workflow.
