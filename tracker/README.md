# Site Tracker

A small internal app for logging **weekly reports** and **snagging sheets** per site, and sending them to your main contractor. Lives at `/tracker/` on this site. Plain HTML/JS, no build step — same as the rest of this repo — backed by [Supabase](https://supabase.com) for login, the database, and photo storage.

## What it does

- **Sites** — one entry per project (address, contract ref, main contractor name/email, status).
- **Company logo** — set once in **Settings**, it appears on every printed weekly report and snag list.
- **Weekly reports** — programme status, weather, itemised "progress this week" and "plan for next week" lists (add/edit/delete each line), H&S notes, deliveries, issues/risks, photos. Every report has a clean printable view.
- **Snagging** — organised into named **snag lists** per site. Start a new list, add items to it (location, description, trade, priority, photo, open/closed — each editable and deletable), then export that specific list as a PDF.
- **Sending to the contractor** — every report/snag list has a "Print / Save as PDF" button (uses your browser's print-to-PDF) and an "Email to Contractor" button that opens a pre-filled email to the contractor's saved address — attach the PDF you just saved.
- **RAG status & progress** — set an overall Red/Amber/Green status and a baseline vs. actual progress % on each site (Site Details → Edit). Shown as a badge and dual progress bar on the dashboard and site page, with a plain-English slippage line ("-5% Behind Programme" / "On Programme" / "+X% Ahead").
- **Quality Gates** — 4 standard hold-points per site (Substructure & Drainage, Frame & Wind/Watertight, Pre-Plaster/First Fix, Pre-Handover/PC), each with a status and a checklist of client-side requirements. Ticking an item timestamps the sign-off. Created automatically for every site, including ones that already existed.
- **Commercials** — an early warning / proposed variation log per site, with cost and time impact, a status (pending/approved/rejected), and running totals for approved variations and pending exposure.
- **Handover Checklist** — 5 statutory documents per site (Building Control, air permeability/acoustic certs, electrical & gas certs, warranty cover note, O&M manuals), each with a status and a real file upload (stored in Supabase, not a mock). Also created automatically for every site.

There's no login for the contractor — they only ever receive the PDF/email you send them. Anyone who signs in to Site Tracker (your team) can see and edit everything; it's built as one shared internal workspace, not a multi-tenant SaaS.

## One-time setup

1. **Create a free Supabase project** at [supabase.com](https://supabase.com) (the free tier is more than enough for this).
2. In the Supabase dashboard, go to **SQL Editor → New query**, paste in the contents of [`sql/schema.sql`](../sql/schema.sql), and run it. This creates the tables, security policies, and the `site-photos` storage bucket.
3. Go to **Project Settings → API** and copy the **Project URL** and the **`anon` public key**.
4. Open `tracker/js/config.js` and paste them in:
   ```js
   export const SUPABASE_URL = "https://xxxx.supabase.co";
   export const SUPABASE_ANON_KEY = "eyJ...";
   ```
   The anon key is safe to ship in client-side code — the SQL script's Row Level Security policies are what actually control access (any signed-in user can read/write; nobody else can).
5. Deploy as normal (this repo's Cloudflare Pages integration picks up static files automatically). Visit `/tracker/`.
6. On first visit, click **Create one** on the sign-in page to make your first account (yourself). Anyone else on your team can do the same — Supabase's default settings will email a confirmation link.

### Updating an existing project (schema changes)

`sql/schema.sql` is written to be safe to re-run in full any time it changes — every statement is `if not exists` / `create or replace` / `drop policy if exists`. If you already have a Supabase project set up, just paste the **whole current file** into SQL Editor and run it again to pick up new tables/columns; nothing existing gets dropped or overwritten destructively.

### Turning off "confirm your email" (optional)

By default Supabase requires clicking a confirmation link before a new account can sign in. For an internal team tool you may prefer to skip this: in the Supabase dashboard go to **Authentication → Providers → Email** and turn off "Confirm email". You can also just leave it on — it only adds one click the first time.

## Adding a team member

Supabase → **Authentication → Users → Add user**, or have them sign up from the login page themselves.

## Notes for future changes

- All data access goes through the Supabase JS client (`tracker/js/supabase-client.js`) using the anon key + Row Level Security — there's no custom backend/API to maintain.
- Photos are stored in the public `site-photos` bucket so they load in printed/PDF reports without needing auth headers. If snag/report photos ever need to be private, switch the bucket to private and swap `getPublicUrl` for `createSignedUrl` in `tracker/js/app.js`.
- Weekly report, snag, and handover photos are resized (max 1920px on the longest side) and re-encoded as JPEG at ~78% quality in the browser before upload (`compressImage`/`uploadImage` in `tracker/js/app.js`), to keep Supabase's free 1GB storage tier from filling up. A typical phone photo drops from 5–8MB to under 1.5MB. The company logo (Settings) is deliberately left uncompressed — it's a single file, and re-encoding could strip transparency from a PNG logo.
- Actually sending email automatically (rather than opening a pre-filled draft) would need an email-sending service (e.g. Resend) wired into a Netlify function with an API key — not set up here to keep the app dependency-free out of the box.
