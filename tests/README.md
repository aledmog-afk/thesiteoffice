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
    audit_log.test.mjs      Audit trail: INSERT/UPDATE/DELETE record
                             shape, chronological ordering, bulk-operation
                             fan-out, cross-org isolation, RLS mirroring
                             the audited table's own read rule, and
                             tamper prevention (no client can INSERT,
                             UPDATE, or DELETE an audit_log row directly).
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
                             idempotent).
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
    actions_helpers.test.mjs  actionDueState() (overdue/due-today/
                             upcoming/completed/cancelled/none) and
                             validActionStatusTransitions(), the client-
                             side mirror of the server's transition table.
    actions_workflow.test.mjs  actions.html's real inline script: the
                             critical create -> assign -> update ->
                             complete workflow, plus the default "Active"
                             filter correctly hiding completed work.

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
