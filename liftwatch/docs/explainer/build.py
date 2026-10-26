"""
Builds docs/LiftWatch-platform-explained.pdf: a full, text-based explanation of the
platform for use with other AI tools.

Run from liftwatch/:  npm run docs:explainer   (needs Python 3 and reportlab)

Keep this in step with the platform. Whenever the app, the method or the checks
change, update the text below and rebuild. The build also writes
docs/explainer/stamp.json, a hash of the source files; the test
tests/docs/explainer.spec.ts fails when the source has changed since the last build.
The method version, the checklist items and the date are read from the source.
"""
import datetime
import hashlib
import json
import re
import sys
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (KeepTogether, PageBreak, Paragraph, Preformatted, SimpleDocTemplate, Spacer, Table,
                                TableStyle)

ROOT = Path(__file__).resolve().parents[2]  # liftwatch/
OUT = sys.argv[1] if len(sys.argv) > 1 else str(ROOT / 'docs' / 'LiftWatch-platform-explained.pdf')
STAMP = ROOT / 'docs' / 'explainer' / 'stamp.json'

# Files whose change means this document may be out of date. Must match tests/docs/explainer.spec.ts.
def source_files():
    files = sorted(ROOT.glob('src/**/*.ts')) + sorted(ROOT.glob('worker/src/*.ts')) + [ROOT / 'METHOD.md']
    return sorted(files, key=lambda f: f.relative_to(ROOT).as_posix())


def source_hash():
    h = hashlib.sha256()
    for f in source_files():
        h.update((f.relative_to(ROOT).as_posix() + '\n' + f.read_text(encoding='utf-8') + '\n').encode('utf-8'))
    return h.hexdigest()


VERSION = re.search(r"METHOD_VERSION = '([^']+)'", (ROOT / 'src/wind/constants.ts').read_text()).group(1)
CHECKLIST = re.findall(r"\{ id: '[^']+', text: '([^']+)'", (ROOT / 'src/checks/model.ts').read_text())
TODAY = datetime.date.today()
DATE = f'{TODAY.day} {TODAY:%B %Y}'

FONT_DIR = '/usr/share/fonts/truetype/dejavu/'
pdfmetrics.registerFont(TTFont('Sans', FONT_DIR + 'DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('Sans-Bold', FONT_DIR + 'DejaVuSans-Bold.ttf'))
pdfmetrics.registerFont(TTFont('Sans-Oblique', FONT_DIR + 'DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('Mono', FONT_DIR + 'DejaVuSansMono.ttf'))
pdfmetrics.registerFontFamily('Sans', normal='Sans', bold='Sans-Bold', italic='Sans-Oblique', boldItalic='Sans-Bold')

ACCENT = colors.HexColor('#3343a8')
INK = colors.HexColor('#111418')
MUTED = colors.HexColor('#4b5560')
RULE = colors.HexColor('#c9d0d8')
SOFT = colors.HexColor('#eef0f8')

body = ParagraphStyle('body', fontName='Sans', fontSize=9.6, leading=13.4, textColor=INK, spaceAfter=5)
small = ParagraphStyle('small', parent=body, fontSize=8.4, leading=11.2, textColor=MUTED)
cell = ParagraphStyle('cell', parent=body, fontSize=8.3, leading=10.8, spaceAfter=0)
cellb = ParagraphStyle('cellb', parent=cell, fontName='Sans-Bold')
h1 = ParagraphStyle('h1', fontName='Sans-Bold', fontSize=15, leading=19, textColor=ACCENT, spaceBefore=10, spaceAfter=6)
h2 = ParagraphStyle('h2', fontName='Sans-Bold', fontSize=11.2, leading=14.5, textColor=INK, spaceBefore=8, spaceAfter=4)
title = ParagraphStyle('title', fontName='Sans-Bold', fontSize=26, leading=31, textColor=ACCENT, spaceAfter=8)
subtitle = ParagraphStyle('subtitle', fontName='Sans', fontSize=12.5, leading=17, textColor=INK, spaceAfter=4)
bullet = ParagraphStyle('bullet', parent=body, leftIndent=12, bulletIndent=2, spaceAfter=2.5)
code = ParagraphStyle('code', fontName='Mono', fontSize=8.2, leading=11, textColor=INK, backColor=SOFT,
                      borderPadding=(5, 6, 5, 6), leftIndent=6, rightIndent=6, spaceBefore=3, spaceAfter=8)
note = ParagraphStyle('note', parent=body, backColor=SOFT, borderPadding=(6, 7, 6, 7), leftIndent=7, rightIndent=7,
                      spaceBefore=4, spaceAfter=10)

story = []
section_no = [0]


def H1(text):
    section_no[0] += 1
    story.append(Paragraph(f'{section_no[0]}. {text}', h1))


def H2(text):
    story.append(Paragraph(text, h2))


def P(text, style=body):
    story.append(Paragraph(text, style))


def B(items):
    for it in items:
        story.append(Paragraph(it, bullet, bulletText='•'))
    story.append(Spacer(1, 4))


def N(items):
    for i, it in enumerate(items, 1):
        story.append(Paragraph(it, bullet, bulletText=f'{i}.'))
    story.append(Spacer(1, 4))


def CODE(text):
    story.append(Preformatted(text, code))


def NOTE(text):
    story.append(Paragraph(text, note))


def T(rows, widths, header=True):
    data = [[Paragraph(str(c), cellb if (header and r == 0) else cell) for c in row] for r, row in enumerate(rows)]
    t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1 if header else 0)
    style = [
        ('GRID', (0, 0), (-1, -1), 0.4, RULE),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]
    if header:
        style.append(('BACKGROUND', (0, 0), (-1, 0), SOFT))
    t.setStyle(TableStyle(style))
    story.append(t)
    story.append(Spacer(1, 8))


# ---------------------------------------------------------------- cover
story.append(Spacer(1, 30 * mm))
P('LiftWatch', title)
P('Platform explained: what it does, how it works, the method, and open questions', subtitle)
P(f'Pilot version · method {VERSION} · built {DATE}', small)
story.append(Spacer(1, 10 * mm))
NOTE('<b>What LiftWatch is.</b> A mobile web app that helps an Appointed Person (AP) check a planned crane lift '
     'against the wind forecast, run the other pre-lift checks, and record a decision. It is <b>decision support, '
     'never an authorisation to lift</b>. The crane operator always has the final say.')
NOTE('<b>Why this document exists.</b> It is a complete, self-contained description of the platform for use with '
     'other AI tools for further research. Every formula, number, rule and assumption is written out, with its '
     'source. Section 15 lists open research questions, and section 16 gives ready-made prompts. Where something '
     'is a LiftWatch choice rather than a rule from a standard, it says so.')
P('“LiftWatch” is a working name. Live pilot: https://liftwatch.pages.dev (method page: /method). Code: the '
  '<font face="Mono">liftwatch/</font> folder of a private GitHub repository.', small)
story.append(Spacer(1, 8 * mm))
H2('Contents')
for i, s in enumerate([
    'Summary', 'The problem it addresses', 'Who uses it', 'Scope of the pilot', 'How it works: the screens',
    'The wind method in full', 'Load schedule', 'The other checks', 'Lift-day wind log', 'Records, PDFs and audit',
    'Data sources', 'Architecture and technology', 'Design and wording rules', 'Limitations and assumptions',
    'Open research questions', 'Prompts for other AI tools', 'Glossary and references'], 1):
    P(f'{i}. {s}', ParagraphStyle('toc', parent=body, spaceAfter=1.5))
story.append(PageBreak())

# ---------------------------------------------------------------- 1
H1('Summary')
T([
    ['Item', 'Detail'],
    ['Purpose', 'Check a planned crane lift against the wind forecast and other pre-lift checks, and record the '
                'Appointed Person’s decision with a full audit trail.'],
    ['Users', 'Appointed Person (AP) and lift supervisor on UK construction sites; crane operator and '
              'slinger/signaller see the briefing and wind log.'],
    ['Pilot scenario', 'Timber frame wall panels, floor cassettes and similar flat loads, lifted by a mobile crane on '
                       'a UK site.'],
    ['Status', 'Working pilot, deployed on Cloudflare Pages, with an automated test suite run in CI. Not yet reviewed '
               'by a qualified AP; interim rules apply until it is (section 14).'],
    ['Main outputs', 'A status per hour (Below / Near / Above permitted speed, with the % of the limit), a permitted '
                     'wind speed for each load, checks results, a timestamped decision record with an integrity check '
                     'that detects accidental changes, a full PDF, a one-page crew briefing sheet, and a lift-day wind log.'],
    ['Key sources', 'CPA/TCIG 2507 “Planning and Control of Lifting Operations in Wind” (July 2025); BS EN 13000; '
                    'BS 7121-1; EN 1991-1-4; LOLER 1998; LEEA guidance; Open-Meteo forecasts; postcodes.io.'],
    ['Technology', 'Vite + TypeScript (no framework), jsPDF, Vitest; IndexedDB on the device; optional Cloudflare '
                   'Worker as a forecast cache; works offline.'],
    ['Not included', 'Logins, sharing between people, billing, alerts, lightning data, a crane library.'],
], [38, 132])

# ---------------------------------------------------------------- 2
H1('The problem it addresses')
P('In the UK, every lifting operation must be planned by a competent person, supervised and carried out safely '
  '(LOLER 1998). BS 7121 is the code of practice, and the planner is called the Appointed Person. Wind is one of the '
  'hardest parts of a lift plan, and large light loads such as timber frame panels are the most sensitive to it.')
H2('Why wind planning goes wrong')
B([
    'Forecasts give wind at 10 m above ground, often as a 10-minute mean, for the middle of a grid square. The crane’s '
    'limit is a 3-second gust at the jib head (CPA pages 20–21).',
    'Crane load charts assume a load with 1.2 m² of effective wind area per tonne. A big light panel has far more, '
    'so its permitted wind speed is lower than the chart limit. The CPA guide notes that APs “struggle to understand '
    'the shape-factor assessment” (section 4.4).',
    'Wind increases with height, and by how much depends on the terrain (open country, towns, cities).',
    'Anemometers and forecasts use different units: m/s, mph, km/h and knots.',
])
H2('Other common reasons lift plans fail review')
P('From industry guidance and lift-plan reviewers (practitioner evidence, not formal studies):')
B([
    'Capacity not checked against the crane’s actual configuration; lifting accessories and hook block left out.',
    'Load weights assumed rather than confirmed.',
    'Ground bearing pressure under outriggers assumed rather than calculated.',
    'Sling angles and ratings wrong.',
    'Exclusion zones drawn round the crane instead of the load’s swept path; overhead power lines missed.',
    'Lifting accessories past their 6-month thorough examination.',
    'Briefings not done or not recorded; stops and restarts in wind not recorded.',
    'Changes on the day made informally instead of re-planning.',
])
P('The CPA guide also notes that more lifting time is lost to poor use of load bays and site logistics than to '
  'winding off, and recommends doing wind-sensitive lifts in calmer hours (section 4.4, page 22).')

# ---------------------------------------------------------------- 3
H1('Who uses it')
T([
    ['Role', 'What they do in LiftWatch'],
    ['Appointed Person (AP)', 'Enters the lift, reads the assessment, completes the checks, records the decision '
                              '(their own decision: proceed / postpone / proceed with conditions).'],
    ['Lift supervisor', 'Runs the briefing and crew sign-on, keeps the wind log on the day.'],
    ['Crane operator', 'Has the final decision to lift, continue or stop (CPA 6.4). Reads the briefing sheet; their '
                       'anemometer readings go into the wind log.'],
    ['Slinger / signaller', 'Signs on to the briefing.'],
    ['Principal contractor / client', 'Receives the PDF record. (Approval inside the app is not built yet.)'],
], [45, 125])

# ---------------------------------------------------------------- 4
H1('Scope of the pilot')
T([
    ['In scope', 'Out of scope (for now)'],
    ['UK sites; timber frame panels, cassettes and similar flat loads; mobile crane; forecasts up to 7 days; '
     'one or many loads per plan; checks for examinations, cards, a checklist and crew sign-on (capacity, sling and '
     'ground-bearing calculators built but switched off pending review); '
     'decision records on the phone; PDFs; offline use.',
     'Logins and accounts; sharing and approval between people; billing; alerts; lightning feeds; a crane library or '
     'manufacturer data; tower cranes (method not designed for them); tandem lifts; lifting people; drawing a site '
     'plan.'],
], [85, 85])

# ---------------------------------------------------------------- 5
H1('How it works: the screens')
P('Five tabs along the bottom of the phone screen: Set-up, Assessment, Checks, Decision, Records. Inputs are saved on '
  'the phone as you type.')
H2('5.1 Set-up')
B([
    '<b>Site:</b> UK postcode (looked up with postcodes.io) or latitude/longitude.',
    '<b>Terrain:</b> open country, town or city. Recorded for information, not yet applied (pending AP review): '
    'the highest of the three factors is used (section 6.2).',
    '<b>Lift:</b> date (today to 6 days ahead), optional planned start and finish time, crane description.',
    '<b>Crane wind limit:</b> the in-service limit from the load chart in m/s, <b>where that figure came from</b> '
    '(required, e.g. “Lift plan LP-014 / LTM 1090 load chart”), whether it is a gust or a mean, and the boom / jib '
    'head height (up to 150 m).',
    '<b>Main load:</b> reference, length and height of the face presented to the wind, mass, rigging mass (slings, '
    'hook block and hoist rope), drag coefficient cw (default 1.2).',
    '<b>Other loads (optional):</b> typed in, or pasted from a supplier’s panel schedule.',
    '<b>Working:</b> the permitted wind speed and every step of the calculation update as you type, plus the gust '
    'factor at height, the “near permitted speed” threshold, and the same limit expressed as a 10 m forecast gust.',
])
H2('5.2 Assessment')
B([
    'Fetches the 7-day forecast for the site and works out each hour of the lift day.',
    '<b>Status banner</b> with only this wording: “Below permitted speed (X % of limit) / Near permitted speed (X %) / '
    'Above permitted speed (X %) — forecast assessment against the limits you entered”, X being the worst hour in the '
    'lift window. Below is a neutral blue-grey with a plain circle, never green or a tick; near is amber, above is red.',
    'Gust at height vs permitted speed, % of the limit, wind direction, weather flags.',
    'The forecast source, model and fetch time, always shown.',
    'An hourly bar chart (gust at height against a dashed permitted line, night shaded) and an hour-by-hour table.',
    'Hours are labelled in UK time; on the October clock change the repeated hour shows as “01:00 BST” then '
    '“01:00 GMT”.',
    'With several loads: the governing (most wind-sensitive) load, and a table of which loads are below the permitted '
    'speed in each daylight hour, with each load’s times labelled “planning guidance only”.',
    '“Planning guidance only”: daylight periods of 2+ hours below the permitted speed. “Outlook — planning guidance only”: a '
    '7-day strip; tap a day to assess it.',
])
H2('5.3 Checks')
P(f'Thorough examination dates, competence card expiry, a {len(CHECKLIST)}-item pre-lift checklist and crew briefing '
  'sign-on. A summary shows how many items need attention and how many are not done, in neutral wording (“No items '
  'flagged by these checks”, “All items marked done”). The crane capacity, sling and outrigger ground-bearing '
  'calculators are switched off by a feature flag: each shows “Not available: awaiting review by a qualified Appointed '
  'Person”. Nothing here blocks a decision. Details in section 8.')
H2('5.4 Decision')
B([
    'Shows the status, the worst hour and a summary of the checks.',
    'The AP records their own decision: “Your decision: proceed”, “Your decision: postpone” or “Your decision: proceed '
    'with conditions”, with name, role and notes (conditions are required for proceed with conditions). Every label '
    'reads as the user’s decision, never LiftWatch’s; PDFs say “Decision recorded by &lt;name&gt; (&lt;role&gt;)” and that it '
    'is not LiftWatch’s decision.',
    'Two confirmations, required for either kind of Proceed: “I have checked on-site wind with an anemometer or the '
    'crane’s jib anemometer before lifting” and “The crane operator retains the final decision to lift, continue '
    'or stop”.',
    'Saving creates a timestamped record with an integrity check that detects accidental changes (section 10).',
])
H2('5.5 Records')
B([
    'List of saved records on this phone; view any record in full.',
    '<b>PDF</b>: the full record. <b>Briefing sheet</b>: one page for the crew and the cab.',
    '<b>Wind log on the day</b> (section 9).',
    '<b>Use as new set-up</b>: start a new lift from a saved one.',
    'Export all records and wind logs as JSON; import them on another phone. The screen prompts an export when none '
    'has been made for 7 days.',
    'Shows whether the browser granted persistent storage (navigator.storage.persist()), which asks it not to clear '
    'the records when space runs low.',
])
P('A neutral grey banner, “Test version – not for operational use. Feedback only.”, is on every screen, every page '
  'of both PDFs and the method, privacy and terms pages. Every page carries robots noindex, nofollow; robots.txt '
  'disallows all crawling and the headers send X-Robots-Tag: noindex, nofollow. The Role field on the Decision '
  'screen starts empty every time (hint “e.g. Appointed Person, Lift Supervisor, Crane Operator”) and is required; '
  'saved records keep their role.')
P('Every screen has a footer linking the method page and a draft privacy notice and terms of use (marked DRAFT, with '
  'controller and contact placeholders and items marked for a solicitor).')

# ---------------------------------------------------------------- 6
H1('The wind method in full')
P(f'Method version {VERSION}, stored in every record. The code that applies it is a pure module with no screen or network '
  'code (<font face="Mono">src/wind/</font>), and every formula carries its source in a comment.')
H2('6.1 Step 1: the 10 m gust corrected to boom / jib head height')
P('Open-Meteo provides the gust at 10 m. It is multiplied by a height factor F(h). For open country, LiftWatch uses '
  'the Liebherr factors quoted in the CPA guide (page 21):')
T([['Height (m)', '10', '50', '100', '150'], ['Gust factor F', '1.000', '1.181', '1.272', '1.329']], [40, 32, 32, 32, 34])
P('Between table points, F is interpolated linearly in log(height):')
CODE('t    = ln(h / h_lo) / ln(h_hi / h_lo)\nF(h) = F_lo + t × (F_hi − F_lo)\ngust at height = gust at 10 m × F(h)')
B(['Below 10 m: F = 1.0 (no reduction).', 'Above 150 m: refused, “outside method range”.',
   'Example: at 25 m, F = 1.103; at 30 m, F = 1.124.'])
H2('6.2 Terrain: open country, town or city')
P('<b>Interim rule (method LW-M1.2):</b> until the town and city factors have been checked against EN 1991-1-4 and the '
  'UK National Annex by a qualified AP, the factor used is the <b>highest</b> of open country, town and city at that '
  'height, whatever terrain is chosen (in practice the city factor above 10 m). The chosen terrain is recorded and shown '
  'as “for information, not yet applied (pending AP review)”. The profiles below are kept for that review.')
P('Wind near the ground is slowed more by rough terrain, so the gust rises more with height in towns and cities (CPA '
  'section 5.2 and Annex H). Town and city use the gust (peak velocity) profile of EN 1991-1-4, as a ratio to the gust '
  'at 10 m. The basic wind speed cancels out:')
CODE('vm(z) ∝ ln(z / z0)                   mean wind, flat terrain\nIv(z) = 1 / ln(z / z0)               turbulence intensity\n'
     'vp(z) = vm(z) × √(1 + 7 × Iv(z))     peak (gust) speed\nF(h)  = vp(max(h, zmin)) / vp(max(10, zmin))')
T([
    ['Setting', 'Meaning', 'EN 1991-1-4 category', 'z0 (m)', 'zmin (m)'],
    ['Open country', 'Fields, coast, airfields, scattered buildings', 'II', '0.05', '2'],
    ['Town', 'Suburbs, villages, industrial estates, woodland', 'III', '0.3', '5'],
    ['City', 'City centre, ≥ 15 % covered by buildings over 15 m', 'IV', '1.0', '10'],
], [26, 66, 32, 22, 24])
P('Open country keeps the published Liebherr factors because the EN 1991-1-4 category II profile gives 1.214 / 1.305 / '
  '1.358 at 50 / 100 / 150 m, within 3 % of them. Town and city are never below the open-country factor.')
T([
    ['Height', 'Open country', 'Town', 'City'],
    ['20 m', '1.078', '1.130', '1.182'], ['30 m', '1.124', '1.204', '1.285'], ['50 m', '1.181', '1.297', '1.412'],
    ['100 m', '1.272', '1.421', '1.580'], ['150 m', '1.329', '1.493', '1.676'],
], [40, 43, 43, 44])
H2('6.3 Step 2: 10-minute mean to gust (for future sources)')
P('If a source gives only a 10-minute mean at 10 m, CPA page 21 gives factors to a gust at height: 50 m 1.653, 100 m '
  '1.78, 150 m 1.861, interpolated the same way. Below 50 m a 10 m factor must be entered (there is no published '
  'value, so the method refuses without one). Built and tested, but not used in the pilot because Open-Meteo '
  'provides gusts.')
H2('6.4 Step 3: permitted wind speed for the load (wind-area reduction)')
P('Source: BS EN 13000 assumption (load charts assume 1.0 m² per tonne with cw 1.2, i.e. 1.2 m² of effective wind area '
  'per tonne); formula as CPA section 4.3 and Annex A, from the Liebherr wind document; BS 7121-1:2016 Annex D-1 '
  'sets out the same assessment as a flow chart.')
CODE('Ap = length × height                     projected area (m²)\nAw = Ap × cw                             effective wind area (m²)\n'
     'm  = (load mass + rigging mass) / 1000   total mass (t)\nr  = Aw / m                              ratio (m²/t)\nr0 = 1.2 m²/t\n'
     'if r ≤ r0:  permitted = chart limit\nif r > r0:  permitted = chart limit × √(r0 / r)   (never above the chart limit)')
P('Why the square root: wind force is proportional to v² × Aw. Holding the force at the chart’s design value gives '
  'v_perm² × Aw = v_chart² × r0 × m.')
P('<b>Worked example (LiftWatch’s own):</b> panel 3.6 × 2.4 m, cw 1.2, 1,300 kg, chart limit 17 m/s → Ap 8.64 m², Aw '
  '10.368 m², r 7.975 m²/t, permitted 17 × √(1.2 / 7.975) = <b>6.59 m/s</b> (14.8 mph).')
P('<b>Checked against the CPA guide’s own worked examples</b> (automated tests):')
T([
    ['CPA example', 'Guide', 'LiftWatch'],
    ['Annex E Fig 15: shutter 2.4 × 6.6 m, 2.392 t, mobile crane 11 m/s', '4.3', '4.27'],
    ['Annex E Fig 15: shutter 7.2 × 6.6 m, 7.215 t, mobile crane 11 m/s', '4.3', '4.29'],
    ['Annex E Fig 15: pack of ply 2.4 × 0.7 m, 0.9 t, mobile crane 11 m/s', '8.1', '8.05'],
    ['Annex E Fig 15: person basket 1.45 × 1.1 m, 0.64 t, mobile crane 11 m/s', '7.0', '6.97'],
    ['Annex E Fig 14: shutter 2.4 × 6.6 m, 2.392 t, tower crane 17 m/s', '6.6', '6.61'],
    ['Annex E Fig 14: pack of ply 2.4 × 0.7 m, 0.9 t, tower crane 17 m/s', '12.4', '12.44'],
    ['Section 4.3: insulation pack 1.2 × 2.4 m, 113 kg, 11.1 m/s', '2.1', '2.20'],
], [120, 25, 25])
P('The insulation pack is the one difference: the guide prints 11.1 × 0.198 = 2.1, but the product is 2.198. The '
  'guide’s own “80 % reduction” matches 2.2, so the printed 2.1 appears to be a rounding slip.', small)
H2('6.5 The chart limit must be a gust')
P('EN 13000 applies a 3-second gust to the crane at height, and CPA says decisions use gusts, not means (section 3.3). '
  'If the AP says the chart limit is a 10-minute mean, LiftWatch does not assess and asks for the gust figure.')
H2('6.6 What the forecast gust is (open item)')
P('Open-Meteo’s published definition of wind_gusts_10m (open-meteo.com/en/docs): “Gusts at 10 meters above ground as a '
  'maximum of the preceding hour”. It does not state an averaging period; EN 13000 assumes a 3-second gust. It is a '
  'model value, not a measurement, so LiftWatch cannot show it equals a 3-second gust. The value stamped HH:00 covers '
  'HH-1 to HH. The averaging period remains an open item for AP review.')
P('<b>Gust timing rule (method LW-M1.3):</b> each hour H to H+1 is assessed against the <b>higher</b> of the values '
  'stamped H and H+1, so a rising wind is never shown late. Both must be known, or the hour has no data. H+1 is found '
  'by instant, so on 25 October 2026 01:00 BST pairs with the value stamped 01:00 GMT, and on 29 March 2026 00:00 GMT '
  'pairs with 02:00 BST. The rule applies to the banner, lift window, chart, hour table, planning periods, per-load '
  'times, outlook, PDFs, briefing sheet and the wind log comparison. Records store both values for each hour.')
CODE('gust for H = max(gust stamped H, gust stamped H+1)')
H2('6.7 Step 4: hourly status')
CODE('ratio = gust at height / permitted wind speed')
T([['Ratio', 'Status'], ['below 0.80', 'Below permitted speed (X % of limit)'], ['0.80 to 1.00 inclusive', 'Near permitted speed (X %)'],
   ['above 1.00', 'Above permitted speed (X %)'], ['gust missing', 'No data (never a pass)']], [70, 100])
P('The 0.80 band is a LiftWatch pilot choice, not from CPA or any standard. The percentage shown never contradicts '
  'the status: near a threshold it shows one decimal place, or “&lt; 80 %” / “&gt; 100 %”.')
H2('6.8 Weather flags (LiftWatch choices; never a pass)')
T([
    ['Flag', 'Rule (Open-Meteo variable)'],
    ['Thunderstorm risk', 'CAPE above 500 J/kg'], ['Possible thunder', 'CAPE 100–500 J/kg'],
    ['Visibility below 5 km', 'visibility under 5,000 m'], ['Rain likely', 'precipitation probability ≥ 70 %'],
    ['Frost / ice risk', 'temperature ≤ 1 °C'], ['Outside daylight', 'hour starts before sunrise or at/after sunset'],
    ['Data missing', 'any value used for a flag is missing'],
], [55, 115])
H2('6.9 Lift window, planning periods and outlook')
B([
    'Lift window: the AP’s planned start–finish, or sunrise to sunset. The banner shows the worst hour in it (ranked '
    'Above, No data, Near, Below permitted speed; then highest ratio).',
    'Planning periods: runs of 2+ consecutive daylight hours below the permitted speed, clipped to sunset.',
    'Times: Open-Meteo returns exact instants (timeformat=unixtime). All time arithmetic uses instants; UK local time is '
    'for display only. On the last Sunday of October the day has 25 hours (01:00 BST and 01:00 GMT); on the last '
    'Sunday of March it has 23 (no 01:00), and a planned time in the gap moves forward an hour.',
    '7-day outlook: per day, the worst daylight status and the highest gust at height.',
])
H2('6.10 Units')
P('m/s first, mph second. 1 mph = 0.44704 m/s; 1 km/h = 1/3.6 m/s; 1 knot = 1852/3600 m/s.')

# ---------------------------------------------------------------- 7
H1('Load schedule')
P('A timber frame day is many panels, not one load. Other loads can be typed in or pasted from a supplier’s panel '
  'schedule: rows of reference, length (m), height (m), mass (kg, or tonnes with “t”), and optionally rigging (kg) '
  'and cw, separated by tabs, commas or semicolons. A header row is skipped; bad rows are reported by line number.')
B([
    'Each load gets its own permitted speed (section 6.4).',
    'Every load sees the same gust, so the load with the lowest permitted speed is the worst in every hour. That '
    '<b>governing</b> load sets the banner and the record’s headline figures.',
    'A table shows, for each daylight hour, which loads are below the permitted speed (○ below, ! near, ✕ above), most '
    'wind-sensitive first, with each load’s times below its limit, labelled planning guidance only. This supports CPA’s advice to lift light, large '
    'loads in calm hours and heavy, compact ones in windier hours (page 22).',
])

# ---------------------------------------------------------------- 8
H1('The other checks')
P('These sit beside the wind method. They are saved in the decision record and printed in the PDF, but they never '
  'change the wind status and never block a decision. <b>The capacity, sling and ground-bearing calculators are switched '
  'off</b> (feature flag, off by default) until reviewed by a qualified AP; their rules are listed here for that review.')
T([
    ['Check', 'Rule', 'Source / status'],
    ['Crane capacity', 'hook load = load + accessories + hook block and rope; utilisation = hook load ÷ rated '
                       'capacity from the chart at the planned radius. Flagged above 75 % (justify in plan) and '
                       '90 % (high); over 100 % is over the chart.',
     'Hook load as CPA Annex A. The 75 % / 90 % bands are company-rule settings, not legal limits.'],
    ['Slings', 'Leg angle β = asin(d ÷ leg length); d = half the spacing (2 legs), half the diagonal (4 legs), '
               'spacing ÷ √3 (3 legs). Mode factor: 2 legs 1.4 (β ≤ 45°), 1.0 (≤ 60°); 3–4 legs 2.1, 1.5; over '
               '60° not permitted. Required single-leg WLL = load ÷ factor.',
     'Uniform load method: BS EN 818-4, BS EN 13414-1, BS EN 1492-1; LEEA Code of Practice.'],
    ['Outrigger ground bearing', 'pressure = (outrigger load + mat weight) ÷ mat area, in kN/m² (tonnes × 9.81); '
                                 'compared with the allowable pressure; minimum mat area = load ÷ allowable.',
     'Simple uniform-pressure check; assumes a stiff mat. Outrigger load from the manufacturer, allowable pressure '
     'from the ground assessment (CPA Ground conditions for construction plant, 2014).'],
    ['Thorough examinations', 'Crane in date if the lift date is within 12 months of its last examination; '
                              'lifting accessories within 6 months.',
     'LOLER 1998 regulation 9 (a written scheme can set other intervals).'],
    ['Competence cards', 'Operator, slinger/signaller and lift supervisor: card scheme and number, valid if the '
                         'expiry is on or after the lift date.', '—'],
    ['Crew sign-on', 'Names, roles and sign-on times after the briefing.', 'CPA 6.1.3: brief the permissible wind '
                                                                            'speed to the team.'],
], [32, 82, 56])
H2(f'The {len(CHECKLIST)}-item pre-lift checklist (Yes / No / N/A)')
N(CHECKLIST)

# ---------------------------------------------------------------- 9
H1('Lift-day wind log')
P('Opened from a saved record. Readings from the crane’s anemometer (a gust at the boom / jib head) are entered in m/s, '
  'mph, km/h or knots and compared directly with the governing load’s permitted speed. No height factor is applied, '
  'because the anemometer is already at height. The pattern follows CPA section 6.4.3.')
T([
    ['State', 'When'],
    ['Below permitted speed', 'the last reading is below 80 % of the permitted speed'],
    ['Near permitted speed', 'the last reading is 80 % to 100 % of it'],
    ['Stop', 'a reading is above the permitted speed'],
    ['Waiting', 'after a stop, readings are back at or below the limit; the wait runs from the first such reading'],
    ['Wait period elapsed. The crane operator decides whether to restart',
     'readings have stayed below the limit for the wait time (default 30 minutes per CPA 6.4.3; 10 or 20 selectable; '
     'BS 7121-5 uses 10 for tower cranes).'],
    ['Winded off', 'logged as winded off for the day'],
], [32, 138])
B([
    'A reading above the limit while waiting resets the wait. After three resets the log quotes CPA 6.4.3: the day may '
    'need to be declared winded off.',
    'It shows which loads in the schedule are below or above their own limit at the last reading (words, no ticks).',
    'For information only, each reading is compared with the forecast gust at height for that hour, and the average '
    'measured ÷ forecast ratio is shown (CPA 5.2.2: contractors are trialling forecast correction from site readings).',
    'The app has no way to edit or delete an entry. Each has a time and optional name, and is printed in the PDF.',
    'The log never says a lift may go ahead.',
])

# ---------------------------------------------------------------- 10
H1('Records, PDFs and audit')
H2('What a decision record holds')
B([
    'Every input (site, terrain, date, window, crane, chart limit and its source, limit type, height, all loads).',
    'The full calculation for every load, the height factor and the hourly assessment for the lift day.',
    'The raw forecast values used for the lift day, the forecast source, endpoint, model, grid point and fetch time.',
    'The decision, name, role, notes and the two confirmations.',
    'The checks with every result worked out.',
    'The method version, the app name, a timestamp, and a SHA-256 integrity check of the whole record.',
])
P('A saved record is a timestamped record with an integrity check that detects accidental changes. The app has no edit '
  'button; a record whose content no longer matches its check is flagged on screen, in the PDF, and rejected on import. '
  'The check has no key, so it is not tamper-proof: anyone who edits a record can recompute it.')
H2('PDF outputs')
T([
    ['Output', 'Contents'],
    ['Full record PDF', 'Status, decision, lift, calculation, loads table, forecast details, hourly chart and table, '
                        'planning guidance, checks, wind log, method summary, sources, integrity check, and the '
                        'disclaimer footer on every page.'],
    ['Briefing sheet (1 page)', 'Stop reading for every load in m/s, mph, km/h and knots; the restart rule; the '
                                'operator’s final say; the decision as recorded by the named person (not LiftWatch); '
                                'lift window and flags; checks needing attention, or “No items flagged by these checks” '
                                'in blue-grey; crew names and blank signature lines.'],
], [40, 130])
P('Footer on every PDF: “Forecasts are modelled estimates, not measurements. This assessment supports, and does not '
  'replace, the lift plan, the Appointed Person’s judgement, manufacturer data, BS 7121 and on-site wind checks.”',
  small)

# ---------------------------------------------------------------- 11
H1('Data sources')
H2('Forecast: Open-Meteo')
CODE('hourly = wind_speed_10m, wind_gusts_10m, wind_direction_10m, wind_speed_80m,\n         wind_speed_120m, cape, '
     'precipitation_probability, visibility, temperature_2m\ndaily  = sunrise, sunset\nwind_speed_unit=ms  '
     'timezone=Europe/London  timeformat=unixtime  forecast_days=7')
B([
    'Model: Open-Meteo’s “best match” blend for the location. The response does not say which model run was used, so '
    'LiftWatch records the time it fetched the forecast.',
    'The free endpoint is for non-commercial use; a commercial endpoint and API key are configurable.',
    'Wind speed units are checked on every response, so a configuration slip cannot mix km/h into m/s.',
    'Coordinates are rounded to 2 decimal places (about 1 km). An optional Cloudflare Worker caches each site’s '
    'forecast for 60 minutes so many users share one call; it only accepts browser calls from '
    'https://liftwatch.pages.dev. The pilot currently calls Open-Meteo directly.',
    'wind_gusts_10m is “a maximum of the preceding hour” with no stated averaging period (section 6.6).',
])
H2('Location: postcodes.io')
P('Free UK postcode lookup to latitude/longitude. Latitude/longitude can also be entered by hand. Only UK and Ireland '
  'coordinates are accepted.')

# ---------------------------------------------------------------- 12
H1('Architecture and technology')
T([
    ['Part', 'Detail'],
    ['Front end', 'Vite 8 + TypeScript, no framework, mobile-first. Five screens, an SVG hourly chart, a method page '
                  'built from METHOD.md.'],
    ['Pure logic', '<font face="Mono">src/wind</font> (wind maths), <font face="Mono">src/checks</font> (capacity, '
                   'slings, bearing, dates, checklist), <font face="Mono">src/windlog</font> (stop/wait/reset), '
                   '<font face="Mono">src/lift</font> (set-up, assessment, records). No screen or network code.'],
    ['Data', '<font face="Mono">src/data</font>: Open-Meteo request and parsing (shared with the Worker), postcode '
             'lookup, offline forecast copy.'],
    ['Storage', 'IndexedDB on the phone (records and wind log), behind an append-only RecordStore interface '
                '(list, get, add, addLogEntry, listLog) so it can move to Supabase. Drafts in localStorage.'],
    ['PDFs', 'jsPDF in the browser, loaded on demand.'],
    ['Offline', 'A service worker keeps the app and PDF library on the phone. The last forecast per site (up to 48 h '
                'old) is used with no signal, with a clear warning and its fetch time.'],
    ['Server', 'Optional Cloudflare Worker: forecast proxy with 60-minute cache. No other server.'],
    ['Hosting', 'Cloudflare Pages (liftwatch.pages.dev), built from the repository on every push; other branches get '
                'preview URLs.'],
    ['Tests', 'Vitest (npm test): CPA worked examples, factors, terrain and the interim rule, clock changes (25 Oct and '
              '29 Mar 2026), the gust timing rule (rising and falling wind, clock changes), decision wording, a sweep of '
              'user-facing text for banned words, thresholds, wording and colours, invalid inputs, parsing, Worker, records and integrity, '
              'export/import and reminders, checks and the calculator flag, wind log, PDFs, privacy and terms pages. '
              'GitHub Actions runs npm test and npm run typecheck in liftwatch/ on every push. Plus scripted browser runs.'],
    ['Feature flags', 'Capacity, sling and ground-bearing calculators: off (VITE_ENABLE_CALCULATORS=true for a review '
                      'build).'],
    ['Dependencies', 'Vite, TypeScript, Vitest, jsPDF only.'],
], [30, 140])

# ---------------------------------------------------------------- 13
H1('Design and wording rules')
B([
    'The status banner uses only “Below permitted speed (X % of limit) / Near permitted speed (X %) / Above permitted '
    'speed (X %) — forecast assessment against the limits you entered”. Never “safe”, “clear to lift” or “go”.',
    'Status is never shown by colour alone: always an icon and a text label (blue-grey ○ / amber ! / red ✕). The below '
    'state is never green and never a tick, in the app, chart, PDFs or wind log.',
    'Records are never described as locked or tamper-proof.',
    'Weather flags never count as a pass. Missing data never counts as a pass.',
    'High contrast for bright daylight; large tap targets for gloves; light and dark themes; works one-handed.',
    'The forecast source and fetch time are always shown.',
    'The AP decides; nothing blocks a decision; the crane operator has the final say on the day.',
])

# ---------------------------------------------------------------- 14
H1('Limitations and assumptions')
H2('Known limitations')
B([
    '<b>Forecast resolution:</b> a modelled forecast on a grid; it does not resolve the crane position.',
    '<b>Local funnelling</b> between buildings, around structures and over ridges is not modelled.',
    '<b>Terrain</b> is recorded but not applied: the highest factor is used until reviewed. The profiles are flat-terrain; '
    'hills and the UK National Annex’s detailed procedure are not used.',
    '<b>Forecast gust definition:</b> a model maximum over the preceding hour, not a stated 3-second gust (section 6.6).',
    '<b>Single scenario:</b> flat loads, mobile crane, gust-based chart limit, up to 150 m.',
    '<b>Records on the device only:</b> lost if site data is cleared or the phone is lost; the app asks for persistent '
    'storage and prompts an export every 7 days.',
    '<b>Open-Meteo free tier</b> is non-commercial.',
    '<b>Calculators switched off:</b> capacity, sling and bearing are simple calculations (chart figure entered; '
    'centred hook and equal legs; stiff mat) and are off until reviewed.',
    '<b>Privacy notice and terms are drafts</b> needing a controller, contact and a solicitor’s review.',
    '<b>Not yet reviewed by a qualified Appointed Person.</b>',
])
H2('LiftWatch choices that need an AP’s review')
T([
    ['Choice', 'Default', 'Basis'],
    ['Near permitted speed band', '80 % of permitted', 'Pilot choice'],
    ['Capacity bands', '75 % and 90 %', 'Common contractor practice (not a standard)'],
    ['Weather flag thresholds', 'Section 6.8', 'Pilot choice'],
    ['Restart wait', '30 minutes', 'CPA 6.4.3 “common practice”; 10 and 20 selectable'],
    ['Checklist items', '14 items', 'Common review failings, CPA, STA'],
    ['Terrain mapping', 'II / III / IV', 'EN 1991-1-4 Table 4.1; not applied (highest factor used) until reviewed'],
    ['Forecast gust vs 3-second gust', 'No correction', 'Open item: Open-Meteo gives a preceding-hour maximum'],
    ['Calculators', 'Switched off', 'Awaiting review'],
], [50, 40, 80])

# ---------------------------------------------------------------- 15
H1('Open research questions')
P('Questions this pilot has not settled. Each is worth researching with other sources or tools.')
H2('Method and standards')
N([
    'What exactly does BS 7121-1:2016 Annex D-1 say, and does LiftWatch’s wind-area reduction match it word for word?',
    'What roughness or terrain do the Liebherr gust factors (1.181 / 1.272 / 1.329) assume?',
    'How does the UK National Annex to EN 1991-1-4 treat town and city terrain, and how different would its factors be '
    'from LiftWatch’s town/city values?',
    'Open-Meteo describes its 10 m gust as “a maximum of the preceding hour” (confirmed from its documentation), with '
    'no averaging period stated. Is that comparable with the 3-second gust EN 13000 assumes and a crane anemometer '
    'reads, and should a correction be applied? Is LW-M1.3’s rule (the higher of the values stamped at the start and end '
    'of each hour) the right reading of a preceding-hour maximum?',
    'Which weather model drives Open-Meteo’s “best match” for UK sites, and how accurate are its gust forecasts at '
    '1–3 days?',
    'What are the BS 7121 lift categories (basic / intermediate / complex) and their criteria?',
    'Is 80 % a sensible “Near permitted speed” band? What do contractors and crane hirers use?',
    'Are the 75 % / 90 % capacity bands typical of UK principal contractors’ lifting procedures?',
    'What do manufacturers (Liebherr, Tadano, Grove) say about wind on panels, and do any give load-specific charts?',
])
H2('Product and market')
N([
    'Which tools do UK APs and timber frame erectors use today for lift planning and wind (e.g. Crane Team, '
    'LiftPlanProUK, Liebherr Crane Planner, 3D Lift Plan), and what gaps do users report?',
    'What would principal contractors need before accepting LiftWatch records as part of lift plan approval?',
    'How should multi-person approval (AP → principal contractor → client) work, and what audit evidence is needed?',
    'Which crane makes expose anemometer data through telemetry APIs, and on what terms?',
    'What would a fair pricing model be for contractors and timber frame suppliers?',
])
H2('Legal, liability and data')
N([
    'How should decision-support software be worded and contracted so it is not taken as authorising a lift?',
    'What are the UK GDPR implications of storing names, roles and sign-on times of the lifting team?',
    'What record retention is expected for lift plans and wind decisions after an incident?',
])
H2('Validation')
N([
    'How should a pilot be designed to compare forecast gusts at height with crane anemometer readings, and how many '
    'lift days would give useful evidence?',
    'Which incidents or near misses involving wind and large-area loads are documented in the UK (HSE, CPA, CIRAS)?',
])

# ---------------------------------------------------------------- 16
H1('Prompts for other AI tools')
P('Attach this PDF, then paste one of these:')
for n, ptxt in enumerate([
    'You are an experienced UK Appointed Person (CPCS A61) and lift supervisor. Review the LiftWatch method in sections '
    '6–9 of the attached document. List anything that is wrong, unsafe, or not in line with BS 7121, LOLER or the CPA '
    'wind guide, with references.',
    'Check every formula and number in section 6 of the attached document against BS EN 13000, BS 7121-1 Annex D and '
    'the CPA/TCIG 2507 guide. Recompute the worked examples and report any differences.',
    'Research the open questions in section 15 of the attached document. For each, give an answer with sources, and '
    'say how confident you are.',
    'Act as a product manager for UK construction software. Using the attached document, list the next five features '
    'that would most help UK timber frame erectors and principal contractors, with reasons and evidence.',
    'Compare LiftWatch (attached) with existing UK lift-planning tools. What does each do that LiftWatch does not, and '
    'where is LiftWatch different?',
    'As a UK construction lawyer, review how LiftWatch (attached) describes itself and records decisions. What wording, '
    'terms of use and data protection steps does it need before commercial use?',
    'Design a 3-month pilot study for LiftWatch (attached) on timber frame sites: what to measure, how many sites and '
    'lift days, and how to judge whether the forecast assessment is reliable.',
], 1):
    story.append(KeepTogether([Paragraph(f'<b>Prompt {n}.</b> {ptxt}', note), Spacer(1, 4)]))

# ---------------------------------------------------------------- 17
H1('Glossary and references')
T([
    ['Term', 'Meaning'],
    ['AP', 'Appointed Person: the competent person who plans the lifting operation (BS 7121).'],
    ['Lift supervisor', 'Supervises the lift on site in line with the plan.'],
    ['Chart limit', 'The crane’s in-service wind limit for its configuration, from the manufacturer’s load chart '
                    '(a 3-second gust at the jib head).'],
    ['Permitted wind speed', 'The limit for a particular load after the wind-area reduction.'],
    ['Gust at height', 'Forecast 10 m gust × height factor: the estimated gust at the boom / jib head.'],
    ['cw', 'Drag (shape) coefficient: 1.2 for flat panels by default.'],
    ['Ap, Aw', 'Projected area of the face to the wind; effective wind area (Ap × cw).'],
    ['Governing load', 'The most wind-sensitive load in a plan (lowest permitted speed).'],
    ['WLL', 'Working load limit of a sling or accessory.'],
    ['Mode factor', 'Multiplier for a multi-leg sling’s WLL by number of legs and angle (uniform load method).'],
    ['CAPE', 'Convective available potential energy: an indicator of thunderstorm potential.'],
    ['LOLER', 'Lifting Operations and Lifting Equipment Regulations 1998.'],
    ['GS6', 'HSE guidance: Avoiding danger from overhead power lines.'],
], [36, 134])
H2('References')
B([
    'CPA/TCIG 2507, Planning and Control of Lifting Operations in Wind, V1, July 2025.',
    'BS EN 13000:2010+A1:2014, Cranes. Mobile cranes.',
    'BS 7121-1:2016, Code of practice for safe use of cranes. General (Annex D-1).',
    'BS EN 1991-1-4, Eurocode 1: Actions on structures. Wind actions (Table 4.1; clauses 4.3–4.5).',
    'Liebherr, Wind influences on cranes (2017).',
    'LOLER 1998, regulation 9; HSE, Thorough examination of lifting equipment.',
    'LEEA Code of Practice for the Safe Use of Lifting Equipment (rating for modes of use).',
    'BS EN 818-4, BS EN 13414-1, BS EN 1492-1 (sling ratings).',
    'CPA, Ground conditions for construction plant (2014).',
    'HSE GS6, Avoiding danger from overhead power lines.',
    'Structural Timber Association, Health and Safety Code of Practice.',
    'Open-Meteo forecast API (open-meteo.com); postcodes.io.',
])


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('Sans', 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 10 * mm, f'LiftWatch — platform explained · pilot, method {VERSION} · decision support, '
                                        'not an authorisation to lift')
    canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f'Page {doc.page}')
    canvas.restoreState()


doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm,
                        bottomMargin=18 * mm, title='LiftWatch — platform explained', author='LiftWatch',
                        subject='Full explanation of the LiftWatch pilot for further research', creator='LiftWatch')
doc.build(story, onFirstPage=footer, onLaterPages=footer)
STAMP.write_text(json.dumps({'methodVersion': VERSION, 'sourceHash': source_hash(), 'built': TODAY.isoformat()}, indent=2) + '\n')
print('ok', OUT)
