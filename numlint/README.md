# numlint

**A linter for the arithmetic inside prose.**

Spell-checkers read your words. Grammar-checkers read your sentences. Nothing reads your
numbers. numlint parses every quantity in a document — `8.5 km`, `£4.2m`, `two-thirds`,
`22.7 pct`, `Tuesday, 5 March 2026` — works out how those quantities relate to one
another, and reports the ones that cannot all be true at once.

```
$ numlint report.md
report.md:1:24 error  5 miles is 8.047 km, not 8.5 km.  [unit-conversion]
  The bypass runs 5 miles (8.5 km) around the town.
                          ^^^^^^
  5 × 1.609344 = 8.047 km
  suggested: 8 km

report.md:7:37 error  £4.2m across 12 boroughs is £350,000 each, not £420,000.  [per-unit]
  4,200,000 ÷ 12 = 350,000
```

It needs no data, no network and no model. It checks a document against **itself**, which
is why it can be deterministic, instant, and run on text you would never send anywhere.

---

## Why this doesn't already exist (and why it should)

Two narrow versions of this idea have been quietly catching errors in science for a decade.
[statcheck](https://en.wikipedia.org/wiki/Statcheck) recomputes p-values from the test
statistics printed beside them; roughly half the psychology papers it has been run over
contain at least one inconsistent statistic. The
[GRIM test](https://en.wikipedia.org/wiki/GRIM_test) checks whether a reported mean is
arithmetically possible for the sample size; around half of the papers it could be applied
to failed it.

Both are hyper-specific — one journal style, one statistic. Nobody generalised the idea to
the numbers in ordinary writing, even though the same trick works: a document usually
contains enough figures to check its own figures.

The timing matters. Language models write an enormous share of the world's reports now,
and arithmetic embedded in prose is exactly where they are weakest — accuracy that holds
up on isolated sums
[collapses when the same operations are wrapped in natural language](https://arxiv.org/pdf/2605.29586),
and a model asked to re-read its own numbers is not a reliable check on them. An external,
deterministic verifier is the cheap fix, for humans and machines alike.

## The idea: every number is an interval

Writing `8.5 km` asserts a true value somewhere in **8.45–8.55**. Writing `8 km` asserts
7.5–8.5. Writing `about 5 million` asserts something much vaguer, and `more than 500`
asserts a lower bound and nothing else.

numlint reads that precision off the page — decimal places, scale words, hedges like
*roughly*, *nearly*, *at least* — and turns each quantity into an interval. A finding is
raised **only when the interval a number states cannot overlap the interval its neighbours
imply**. This is what keeps it quiet: rounding is not an error, `41% + 33% + 27% = 101%` is
not an error, and `5 miles (8 km)` is not an error. What it flags is arithmetic that cannot
be right as written, and it shows the working every time.

## What it checks

| rule | catches |
| --- | --- |
| `unit-conversion` | `5 miles (8.5 km)` — a value restated in another unit, converted wrongly. 127 units (423 surface forms) across 16 dimensions — length, mass, volume, area, speed, energy, power, pressure, data, temperature, fuel economy and more, including reciprocal pairs like mpg ↔ L/100km. |
| `percent-of-base` | `45 of the 200 respondents (25%)` — the share does not match the part and whole beside it. |
| `percent-change` | `from $4.5m to $6.2m, a 33% increase` — and changes stated in the wrong direction. |
| `percentage-point-confusion` | `from 12% to 9%, a 3% drop` — it is 3 percentage points, or a 25% fall. |
| `multiplier-mismatch` | `doubled from 400 to 1,200`. |
| `sum-of-parts` | an explicitly stated total that does not match the items listed with it. |
| `percent-sum` | shares of one whole adding to more than 100%, unless the text says answers could overlap. |
| `table-sum` | markdown table totals, by row and by column. |
| `impossible-percentage` | `40% of the 7 patients` — no whole number of people produces 40% of 7. GRIM's logic, generalised, and assumption-free. |
| `grim-mean` | a mean impossible for the sample size when items are whole numbers (the GRIM test proper). |
| `weekday-date` | `Tuesday, 5 March 2026` was a Thursday. Also catches dates that do not exist. |
| `date-span` | `from 1990 to 2015, a 30-year period`. |
| `age-arithmetic` | `born in 1943 … died in 1999 at the age of 45`. |
| `per-unit` | averages that do not divide out and unit prices that do not multiply up. |
| `ratio-percent` | `one in five (25%)`. |
| `part-exceeds-whole` | `£25m of the £20m allocated`. |
| `currency-rate` | a currency conversion that contradicts the exchange rate given in the same sentence. |
| `scale-slip` | the same figure appearing as `$4.2 billion` in one paragraph and `$4.2 million` in another. |

## How well it works

**Benchmark** — 107 cases, 40 with planted errors and 67 that must stay silent. The silent
cases are adversarial: correct roundings, hedged figures, multi-select surveys, golf
scores, index numbers (`129% of the 1947-49 average`), money-market fractions
(`3-1/2 to three pct from 4-1/2`), fiscal-year spans, and verbatim newswire.

```
$ npm run eval
precision:  100.0%     recall: 100.0%     F1: 100.0%
```

**False positives on real text** — the number that actually matters for a linter. Run over
**6,503 documents / 31 MB / 110,747 quantities** of real published prose, numlint raised
**two** findings in total:

| corpus | what it is | documents | quantities | findings |
| --- | --- | ---: | ---: | ---: |
| Reuters-21578 | 1987 financial newswire | 4,802 | 45,586 | **2** |
| Gutenberg | literary prose | 659 | 31,125 | 0 |
| Brown | 1961 general American English | 500 | 12,939 | 0 |
| ABC news | 2000s broadcast news | 225 | 10,007 | 0 |
| webtext | 2000s web writing | 99 | 6,601 | 0 |
| State of the Union | political speech, 1945–2006 | 145 | 4,189 | 0 |
| Inaugural addresses | political speech, 1789–2009 | 73 | 300 | 0 |

The two findings:

```
90 km (50 miles) east of Quito     — 90 km is 55.92 miles
225 km (135 miles) east of Lima    — 225 km is 139.8 miles
```

Both are genuine errors in the source: Reuters correspondents converting kilometres to
miles with a factor of 0.6 instead of 0.621. They have sat there uncorrected since 1987.

That is a false-positive rate of zero across 110,000 quantities, and it is the property the
whole design is bent towards — a linter that cries wolf gets switched off. Reproduce it
with `bash eval/fetch-corpus.sh` (it downloads the corpora from the NLTK data mirror).

Getting there took real work. Early versions were far noisier, and every rule below was
narrowed by what the corpus run showed it actually did to real text — a cross-document
restatement check produced 927 false positives on 5,302 documents and now fires only on
the unambiguous scale-slip; a percentage-sum check had to learn that "50 percent richer,
50 percent better off, 50 percent happier" is rhetoric rather than a breakdown; a
conversion check had to learn that "4 minutes, 7 seconds" is one duration and not a
restatement of another.

**Speed** — about 5 MB of prose per second, single-threaded, no warm-up.

## Use it

```bash
npm install numlint          # library + CLI
```

```bash
numlint report.md docs/*.md        # lint files
cat draft.txt | numlint            # or a pipe
numlint --json report.md           # machine-readable
numlint --sarif docs/*.md          # CI annotations (see .github/workflows/numlint.yml)
numlint --min-confidence 0.6 x.md  # see marginal findings too
numlint --list-rules
```

```js
import { lint } from 'numlint';

const { findings } = lint(documentText);
for (const f of findings) {
  console.log(`${f.line}:${f.column} ${f.message} (${f.workings})`);
}
```

Every finding carries `rule`, `severity`, `confidence`, `message`, `stated`, `expected`,
`workings`, `span` (exact character offsets), `line`, `column`, `relatedSpans` and, where
unambiguous, a suggested `fix`.

### For AI agents

An MCP server ships with the package, so a model can check its own arithmetic before
handing you a document:

```bash
claude mcp add numlint -- npx numlint-mcp
```

It exposes `check_numbers` and `list_rules`. The tool description tells the model what the
checker can and cannot do — that it verifies internal consistency, never truth — so
findings come back as proofs, not opinions.

### As a web page

`web/index.html` is a complete client-side demo — paste a document and every finding comes
back as a correction slip with the excerpt, the claim and the arithmetic.
`web/standalone.html` is the same page with the engine inlined: a single file you can open
from disk or host anywhere. Nothing is uploaded. Both are generated from `web/page.html`
by `npm run build:web`.

### As an HTTP API

`worker/index.ts` is a `fetch` handler for Cloudflare Workers, Deno Deploy or Bun:

```bash
curl -s https://your-worker/lint -d '{"text":"The bypass runs 5 miles (8.5 km)."}'
```

## What it will not do

- **It does not know anything.** If a document says the population of France is 12, numlint
  is silent — that is a fact-check, not an arithmetic check. It only ever compares figures
  on the page with each other.
- **It cannot tell you which number is wrong**, only that two of them disagree. The
  suggested fix assumes the *other* figures are right, which is usually but not always the
  case.
- **English only**, for now. The interval model is language-independent; the phrase
  patterns are not.
- **Currency conversion needs a stated rate.** Exchange rates move, so a conversion without
  a rate on the page is unverifiable and numlint says nothing.

## Design notes

- **Zero runtime dependencies.** Runs in Node, the browser, Workers, Deno and Bun.
- **Precision over recall, everywhere.** Every rule has an escape hatch for constructions
  it cannot parse confidently, and takes it.
- **The tolerance model is the product.** Rounding slack derives from how the author wrote
  the number, not from a fudge factor. `--slack N` widens every tolerance if you want a
  quieter run.
- **Everything is explainable.** No scoring model, no thresholds on similarity. A finding
  is a piece of arithmetic you can check by hand in ten seconds, and the tool shows it to
  you.

## Repository layout

```
src/extract/   number and quantity parsing (digits, spelled forms, fractions,
               scale words, hedges, ranges, compound measures, currencies)
src/units.ts   127 units with dimensional analysis and exact conversion factors
src/interval.ts the tolerance model
src/checks/    one file per family of rules
bin/           the CLI
mcp/           the MCP server
worker/        the HTTP API
web/           the browser demo
eval/          the benchmark, the scorer, and the corpus runner
test/          42 tests: extraction, units, every rule, the API, the CLI, and a
               fuzz suite that throws 5,500 random documents at the parser
```

```bash
npm test          # unit tests + benchmark
npm run eval      # precision/recall on the benchmark
npm run build:web # rebuild the browser bundle
```

## Licence

MIT.
