# LiftWatch: working rules

- Decision support only. Never use "safe", "clear to lift" or "go" in anything a user sees.
- Author is "LiftWatch" everywhere. No personal names, employers or emails in code, metadata or commits.
- Ask before adding any dependency beyond Vite, TypeScript, Preact, jsPDF and Vitest.
  Approved for docs tooling only (not the app): Python 3 with reportlab, for `docs/explainer/build.py`.
- Wind maths stays pure in `src/wind/`, with each formula's source in a comment and in METHOD.md.
  Change `METHOD_VERSION` when any number or rule in the method changes.

## Keep the platform explainer up to date

`docs/LiftWatch-platform-explained.pdf` is a full explanation of the platform, used for research with
other AI tools. Whenever the platform changes (features, method, checks, wording, architecture):

1. Update the text in `docs/explainer/build.py` so the document describes the platform as it now is.
2. Rebuild it: `npm run docs:explainer` (Python 3 with reportlab).
3. Commit the PDF and `docs/explainer/stamp.json` with the change.

`tests/docs/explainer.spec.ts` fails if the source has changed since the PDF was last built.

Also keep METHOD.md, README.md, TESTING.md and docs/RESEARCH.md in step with the change.
