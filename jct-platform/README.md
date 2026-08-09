# JCT Compensation Event Platform

Standalone multi-tier platform for JCT diary capture, AI-assisted Relevant
Event / Relevant Matter matching, and notice-deadline tracking. This is a
**separate app from the existing tracker** at
`claude-construction-tracking.thesiteoffice.pages.dev` — its own auth, its
own database, its own (deliberately thin) diary capture. It shares this
repo and this Netlify site only for convenience of deployment.

## What's built (Phase 1 + partial Phase 2)

- **Phase 1 — Foundation**: org signup/login, `organizations` /
  `project_memberships` / `project_invitations` tables, invite-by-email
  flow with token acceptance, RLS-enforced tier visibility (with a
  `project_permissions` override table so the defaults can be adjusted
  per project without a redeploy), and diary entry capture.
- **Phase 2 — JCT reference + flagging**: `jct_clause_reference` seeded
  with JCT D&B 2016, a Claude-powered matching function that runs after
  every diary entry save, and a dashboard panel of flagged events.
- **Not built yet**: Phase 3 (draft notice generation, PDF export) and
  Phase 4 (SBC/IC clause tables — the schema already supports them, only
  the seed data is missing).

## Getting it running

This repo ships as pure static HTML + Netlify Functions with **no npm
dependencies and no build step** (same convention as the existing
`create-payment-intent.js` Stripe function) — every server-side call to
Supabase or Anthropic goes over plain `https`.

### 1. Create a Supabase project

Use a **new** Supabase project — do not reuse another project in the
account, since this platform's data model (and RLS) is independent of
anything else running there.

Apply the schema in order:

```
supabase/migrations/0001_init.sql
supabase/seed/0002_seed_jct_db_2016.sql
```

Either via the Supabase SQL editor, or the CLI:

```
supabase db push --db-url "postgresql://…"
```

### 2. Set Netlify environment variables

| Variable | Where it's used |
|---|---|
| `SUPABASE_URL` | frontend config + all functions |
| `SUPABASE_ANON_KEY` | frontend config (safe to expose — RLS governs access) |
| `SUPABASE_SERVICE_ROLE_KEY` | `accept-invite`, `match-entry` functions only — never exposed to the browser |
| `ANTHROPIC_API_KEY` | `match-entry` function (AI clause matching) |
| `RESEND_API_KEY` | optional — `invite-org` function emails the invite link if set; otherwise the link is returned in the response for the inviter to share manually |
| `RESEND_FROM_EMAIL` | optional — defaults to a Resend sandbox sender |

### 3. Configure Supabase Auth

In the Supabase dashboard, add this site's URL (and `http://localhost:8888`
for local `netlify dev`) under Authentication → URL Configuration, so
password-reset and (if enabled) email-confirmation links resolve correctly.
Email confirmation can be left on or off — `index.html` handles both: if a
session comes back immediately after sign-up it finishes org setup right
away, otherwise it finishes on first sign-in after confirming.

### 4. Run it

```
netlify dev
```

Visit `/jct-platform/index.html`.

## Data model

See `supabase/migrations/0001_init.sql` for the full schema and RLS
policies. Summary:

- `organizations`, `profiles` — each org is a standalone workspace; a
  profile is one auth user tied to one org.
- `projects`, `project_memberships`, `project_invitations` — a project has
  one `owner_org_id` plus zero or more other orgs joined via membership.
  **Tier is per-membership, not per-org** — the same org can be Main
  Contractor on one project and Subcontractor on another.
- `diary_entries` — deliberately thin: date, category, free text, photo
  URLs. No programme linking, no resource allocation — that's the tracker
  app's job.
- `jct_clause_reference` — seeded reference data, not org-scoped.
- `flagged_events` — AI matching output, written by `match-entry.js`.
- `project_permissions` — per-project override of the default visibility
  table below. Empty by default; the RLS policies fall back to the
  hardcoded defaults when no override row exists for a given
  `(project, tier, data_scope)`.

### Default visibility (can be overridden per project via `project_permissions`)

| Data | Client | Main Contractor | Subcontractor | Employer's Agent |
|---|---|---|---|---|
| Own tier's diary entries | own only | own only | own only | own only |
| Other tiers' diary entries | none (row-level) | subs' entries | none | all |
| Flagged events | all, read-only | all, can action | own only | all, can action |

## AI matching pipeline

`netlify/functions/match-entry.js` is called by the client right after a
diary entry is saved. It reads the entry, pulls the project's contract's
clause list from `jct_clause_reference`, and asks `claude-opus-5` (via
`output_config.format` JSON-schema forcing, so the response is guaranteed
parseable — no regex extraction) whether the entry supports any Relevant
Event / Relevant Matter. Matches with confidence ≥ 0.4 are written to
`flagged_events`. A nightly batch job over unprocessed entries would call
the same function — not wired up yet (needs a scheduled Netlify Function
or similar, left for Phase 3+).

## Open questions from the build spec (still unresolved)

- Should a Subcontractor's flagged events be visible to the Client at all,
  even summarized? Current default: no (matches the spec's stated
  assumption). Adjustable per project via `project_permissions`.
- Does the EA need write access to issue formal instructions, or just
  visibility + notice drafting? Notices aren't built yet (Phase 3), so
  this hasn't been decided in code.
- Billing model once multiple orgs share one project — not implemented;
  no billing/seats code exists yet.
