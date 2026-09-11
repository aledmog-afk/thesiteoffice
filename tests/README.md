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
    documents.test.mjs       Document Management foundation: org_id
                             derivation (never client-trusted),
                             document_type/status defaults and CHECK
                             constraints, revision_number server
                             computation and increment, project_id
                             derivation for a revision from its parent
                             document (never client-trusted — the same
                             IDOR class Priority 7/8 closed), the
                             unique(document_id, revision_number)
                             backstop (proven with the before-insert
                             trigger disabled, to isolate the
                             constraint itself from the trigger's
                             happy-path arithmetic), current_revision_id
                             promotion + supersede-the-previous-
                             revision on each new upload,
                             current_revision_id's absolute
                             client-immutability (even to a real
                             revision id already belonging to the same
                             document), document_revisions' total
                             absence of an UPDATE policy (immutability
                             enforced by RLS, not app discipline),
                             owner/collaborator/snagging-only/stranger/
                             cross-org RLS across read, create, upload,
                             metadata update and archive (including a
                             spoofed project_id on a revision insert),
                             and audit integration (creation, revision
                             upload, archive, and that a snagging-only
                             member — who can read the document — can
                             also read its audit history, plus that the
                             audit actor can never be forged).
    documents_storage.test.mjs  The private controlled-documents
                             bucket: bucket config (private, 50MB, no
                             SVG/HTML), editor-only upload vs.
                             member-level read (the inverse of
                             site-photos/drawings' own snagging-write
                             access), cross-org upload/read denial by
                             any path shape, a fabricated or malformed
                             project-id path segment rejected outright,
                             and the total absence of an update/delete
                             policy for anyone.
    documents_performance.test.mjs  Seeds 150 documents on one project
                             (plus 20 other projects in the same org
                             with their own documents) and proves
                             listDocuments()'s query shape stays
                             exactly 2 broad, project-scoped queries
                             regardless of document count (never one
                             per document), backed by real index usage
                             (documents' project+status and
                             project+type indexes, and
                             document_revisions' document+revision_number
                             index).
    programme.test.mjs       Programme Control foundation: org_id/
                             project_id derivation (from the parent
                             programme, never client-trusted), the
                             one-active-programme-per-project partial
                             unique index (a second active row
                             rejected, multiple drafts allowed),
                             programme status NOT force-reset on
                             insert (deliberately unlike
                             weekly_reports), programme_activities
                             creation, the plot_id-same-project and
                             assigned_to-real-member IDOR checks (the
                             latter proven to accept a snagging-only
                             member — a legitimate responsible party
                             even though they can't see Programme
                             Control at all), forecast defaulting from
                             planned dates on insert (and never
                             overwritten if explicitly supplied), the
                             status/percent_complete/actual_finish
                             coupling (complete forces 100% + stamps
                             actual_finish once; not_started forces
                             0%; reopening preserves actual_finish),
                             every date-ordering CHECK constraint,
                             external_id uniqueness scoped per
                             programme, owner/collaborator/
                             snagging-only/stranger/cross-org RLS
                             (editor-only throughout — snagging-only
                             excluded even from reading, unlike
                             Documents), the no-delete-policy-on-
                             programmes vs. editors-can-delete-
                             activities distinction, and audit
                             integration (including that a snagging-
                             only member cannot read programme audit
                             rows, matching their own SELECT RLS).
    programme_performance.test.mjs  Seeds 5,000 activities on one
                             project (plus 15 other projects in the
                             same org with their own activities) and
                             proves activity retrieval at 50/500/5,000
                             rows stays fast and backed by real index
                             usage (project+status,
                             project+forecast_finish), unaffected by
                             the rest of the portfolio.

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
                             inspection_findings.resolved_at. Also
                             covers Document Management (Priority 10):
                             unlike every table above, this proves the
                             migration DOES backfill existing data —
                             pre-existing drawings/specifications rows
                             get a correctly-mapped documents +
                             Revision-1 document_revisions row each
                             (title, doc_number from plot_number,
                             storage_bucket='site-photos', the original
                             file URL preserved byte-for-byte, never
                             re-hosted), the backfill is idempotent
                             (re-applying schema.sql 3 times never
                             duplicates it), the legacy drawings/
                             specifications tables and rows are
                             completely untouched, and the old
                             snag_items.drawing_id/quality_gates.drawing_id
                             foreign keys still accept the legacy
                             drawings.id afterwards — plus idempotency
                             of documents/document_revisions' own
                             tables/indexes/triggers/RLS policies and
                             the controlled-documents storage bucket
                             across repeated re-application. Also
                             covers Programme Control (Priority 11):
                             unlike every migration test above,
                             programmes/programme_activities have NO
                             legacy predecessor at all — a fresh
                             install has zero rows in either table, no
                             backfill to prove — so this only verifies
                             idempotency of the schema itself (tables/
                             indexes/triggers/RLS policies, and the
                             one-active-programme + external_id
                             partial unique indexes) across repeated
                             re-application.
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
    documents_export_helpers.test.mjs  The pure calculation helpers
                             behind bulk export — sanitizeExportFilename()
                             (Windows/SharePoint-illegal characters,
                             trailing dot/space, empty-name fallback,
                             length cap), exportFilenameFor() (doc
                             number/title/revision naming, extension
                             lowercased, the true original filename
                             never touched), dedupeExportFilenames()
                             (deterministic (2)/(3).../ suffixes,
                             stable order, never two identical outputs),
                             buildExportManifestCsv() (header + escaping),
                             and planDocumentExport() (current-revision-
                             only by default, a document with no
                             current revision skipped rather than
                             exported empty, includeHistory's Current/
                             vs. Revision History/ subfolders, and
                             same-folder filename collisions
                             de-duplicated) — all against the real
                             app.js source, no JSZip or network
                             involved.
    documents_workflow.test.mjs  documents.html's and
                             document-detail.html's real inline
                             scripts: the document list renders title/
                             type/status/current revision, an editor
                             sees creation controls a snagging-only
                             member does not (while still seeing the
                             read-only list), submitting the New
                             Document form calls createDocument with
                             the entered fields and file, selecting
                             documents and exporting calls
                             exportDocumentsZip with only the selected
                             set, the revision history correctly marks
                             Current vs. Superseded, uploading a new
                             revision calls addDocumentRevision with
                             the right ids and file, Archive requires
                             confirmation and calls through only when
                             confirmed, a snagging-only member sees the
                             document read-only (no edit/archive/
                             upload-revision controls), and an already-
                             archived document hides the upload-
                             revision card even for an editor.
    programme_import_contract.test.mjs  The pure, synchronous import-
                             contract functions established this
                             phase (no working importer exists yet) —
                             parseImportDate() (ISO string/Excel
                             serial number/JS Date accepted, malformed
                             shapes rejected rather than guessed at),
                             validateImportRow() (missing title,
                             invalid/malformed dates reported
                             together not just the first, finish-
                             before-start, invalid percent_complete,
                             a missing external_id allowed as a soft
                             fallback case), matchImportRowToActivity()
                             (the external_id-first, (plot,title)-
                             fallback identity strategy — proving
                             title alone is never enough, and an
                             externally-identified activity is never
                             matched by the fallback path),
                             PROGRAMME_IMPORT_OWNED_FIELDS/
                             PROGRAMME_APP_OWNED_FIELDS (proven
                             disjoint — an import must never be able
                             to touch forecast/actual/status), and
                             planProgrammeImport() (a mixed valid/
                             invalid batch correctly split into
                             create/update/invalid, a duplicate
                             external_id WITHIN one import batch
                             caught before the database, plot_number
                             resolved via a caller-supplied lookup).
    programme_workflow.test.mjs  programme.html's real inline script:
                             the no-programme-yet empty state and
                             Create Programme flow, a draft
                             programme's Activate button (absent once
                             active), Activate/Archive calling
                             through and updating the status badge
                             (Archive gated on confirmation),
                             activities rendering with the right
                             columns, creating an activity via the
                             form, editing an existing activity
                             (pre-fills the form and calls
                             updateProgrammeActivity, never
                             createProgrammeActivity), deleting an
                             activity, the status filter narrowing
                             rendered rows, and the empty-activities
                             state. Row action buttons use an inline
                             onclick attribute (the same pattern
                             documents.html/drawings.html already
                             use) rather than addEventListener —
                             jsdom's "outside-only" script mode (this
                             harness's mode) never wires those up into
                             live listeners, so these tests call the
                             exposed window.editActivity()/
                             window.deleteActivity() directly, the
                             same functions a real click resolves to.

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
