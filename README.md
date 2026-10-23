# thesiteoffice

This repository serves **The Site Office** on https://thesiteoffice.uk (Cloudflare Pages, no build step).

- `/` is a plain front page (`index.html`) with sign-in links. `404.html`, `privacy.html` and `terms.html` sit beside it; privacy and terms are DRAFT placeholders.
- `/tracker/` is the app itself. See [`tracker/README.md`](tracker/README.md). Every app URL stays under `/tracker/`, so approval links, invites and bookmarks already in use keep working.
- `_redirects` sends the old Site Office template pages to the front page, and anything under `/liftwatch` to the LiftWatch app (its code lives in `liftwatch/` but is deployed separately, at https://liftwatch.pages.dev). `_headers` sets the security headers.
- Tests: `npm test` (see [`tests/README.md`](tests/README.md)).
