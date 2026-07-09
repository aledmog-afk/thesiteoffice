# Site Tracker

A small internal app for logging **weekly reports** and **snagging sheets** per site, and sending them to your main contractor. Lives at `/tracker/` on this site. Plain HTML/JS, no build step — same as the rest of this repo — backed by [Supabase](https://supabase.com) for login, the database, and photo storage.

## What it does

- **Sites** — one entry per project (address, contract ref, main contractor name/email, status).
- **Weekly reports** — programme status, progress summary, H&S notes, deliveries, issues/risks, next week's plan, photos. Every report has a clean printable view.
- **Snagging** — an ongoing, numbered list of snags per site (location, description, trade, priority, photo, open/closed). Export a filtered snagging sheet (open only / closed only / all) as a printable document at any point.
- **Sending to the contractor** — every report/sheet has a "Print / Save as PDF" button (uses your browser's print-to-PDF) and an "Email to Contractor" button that opens a pre-filled email to the contractor's saved address — attach the PDF you just saved.

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
5. Deploy as normal (Netlify picks up static files automatically). Visit `/tracker/`.
6. On first visit, click **Create one** on the sign-in page to make your first account (yourself). Anyone else on your team can do the same — Supabase's default settings will email a confirmation link.

### Turning off "confirm your email" (optional)

By default Supabase requires clicking a confirmation link before a new account can sign in. For an internal team tool you may prefer to skip this: in the Supabase dashboard go to **Authentication → Providers → Email** and turn off "Confirm email". You can also just leave it on — it only adds one click the first time.

## Adding a team member

Supabase → **Authentication → Users → Add user**, or have them sign up from the login page themselves.

## Notes for future changes

- All data access goes through the Supabase JS client (`tracker/js/supabase-client.js`) using the anon key + Row Level Security — there's no custom backend/API to maintain.
- Photos are stored in the public `site-photos` bucket so they load in printed/PDF reports without needing auth headers. If snag/report photos ever need to be private, switch the bucket to private and swap `getPublicUrl` for `createSignedUrl` in `tracker/js/app.js`.
- Actually sending email automatically (rather than opening a pre-filled draft) would need an email-sending service (e.g. Resend) wired into a Netlify function with an API key — not set up here to keep the app dependency-free out of the box.
