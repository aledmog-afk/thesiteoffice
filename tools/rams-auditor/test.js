const assert = require('assert');
const RamsAuditor = require('./engine.js');
const rules = require('./rules.json');

function report(label, text) {
  const r = RamsAuditor.analyze(text, rules);
  console.log(`\n=== ${label} ===`);
  console.log('Score:', r.percent + '%', '(' + r.grade + ')');
  console.log('Structural:', r.summary.structuralPassed + '/' + r.summary.structuralTotal);
  console.log('Hazards detected:', r.summary.hazardsDetected, 'missing controls:', r.summary.hazardsMissingControls);
  if (r.vagueFlags.length) console.log('Vague flags:', r.vagueFlags.map(f => f.id + ' x' + f.count).join(', '));
  return r;
}

// --- Test 1: near-blank / minimal doc should score very low ---
const weak = `Task: Fit some sockets. Be careful. All necessary precautions will be taken. Take care on site.`;
const weakReport = report('Weak / vague document', weak);
assert(weakReport.percent < 25, `expected weak doc < 25%, got ${weakReport.percent}`);
assert(weakReport.vagueFlags.length > 0, 'expected vague flags on weak doc');

// --- Test 2: strong, thorough RAMS covering a working-at-height + electrical job ---
const strong = `
RISK ASSESSMENT AND METHOD STATEMENT
Document number: TSO-RAMS-014, Revision 2, Prepared by: J. Carter, Site Manager

Scope of works: Replacement of roof edge trims and isolation of an existing lighting circuit
at the plant room roof.

Site address: Unit 4, Riverside Business Park, Leeds, LS10 1AB.
Site manager: J. Carter. Person responsible for supervision: J. Carter.
Issue date: 03/03/2026. Review date: 03/09/2026.

Sequence of work:
Step 1: Erect edge protection with guardrails and toe boards around the working area before
any operative accesses the roof.
Step 2: Operatives don a full body harness and fall arrest lanyard, connected to an
approved anchor point, before crossing the leading edge.
Step 3: Electrician to carry out safe isolation of the lighting circuit, including lock out
tag out and dead testing, before any cable work begins. Only a qualified electrician may
carry out this task.
Step 4: Remove and refit trims.

Hazards identified: fall from height, electric shock from live cables, manual handling of
trims, noise from cutting tools.

Risk rating: likelihood 3, severity 4 before controls; residual risk after controls reduced
to likelihood 1, severity 2.

Control measures: edge protection and fall arrest as above; permit to work required for the
electrical isolation; mechanical aid (trolley) used for moving trim bundles rather than
manual carrying.

PPE required: hard hat, hi-vis vest, safety boots, gloves, eye protection, ear defenders
during cutting operations.

Training/competence: all operatives must hold a valid CSCS card; roof workers must have
in-date working at height training; electrician must hold relevant electrical qualification.

Emergency procedures: in the event of a fall, raise the alarm immediately, do not move the
casualty, call the appointed first aider and dial 999. Fire action: evacuate to the assembly
point at the main gate. Nearest hospital: Leeds General Infirmary.

Welfare arrangements: toilet facilities and drinking water available in the site cabin.
Environmental controls: dust suppression not required; waste segregated into site skips.
Monitoring: site manager to carry out daily spot checks and a documented weekly site
inspection.

Briefing record: all operatives must sign below to confirm they have read and understood
this RAMS before starting work. Operative signature: ______________
`;
const strongReport = report('Strong, thorough document', strong);
console.log(strongReport.hazardResults.filter(h => h.triggered).map(h => `${h.id}: ${h.status}`).join('\n'));
assert(strongReport.percent >= 85, `expected strong doc >= 85%, got ${strongReport.percent}`);
assert(strongReport.summary.hazardsMissingControls === 0, 'expected no missing hazard controls in strong doc');

// --- Test 3: hazard trigger without control should be caught ---
const excavationNoControl = `Scope of works: dig a trench for a new drainage pipe run across the yard.
Site address: Plot 7, Meadow Lane, Bristol. Site manager: A. Smith.
Issue date: 01/01/2026. Review date: 01/07/2026.
Hazards identified: risk of collapse. Sequence: excavate trench, lay pipe, backfill.
Control measures: operatives to wear PPE. PPE required: hard hat, boots, gloves.
Training: CSCS card required. Emergency procedures: first aid kit on site, call 999 for
emergencies, assembly point at gate. Briefing record: sign below to confirm read and
understood. Monitoring: daily spot checks by supervisor.`;
const excReport = report('Excavation with no collapse/services control', excavationNoControl);
const excCheck = excReport.hazardResults.find(h => h.id === 'excavation');
assert(excCheck.triggered === true, 'excavation should be triggered');
assert(excCheck.status === 'fail', 'excavation should fail without shoring/CAT-scan control');

// --- Test 4: hazard trigger WITH control should pass ---
const excavationWithControl = excavationNoControl.replace(
  'Control measures: operatives to wear PPE.',
  'Control measures: trench sides supported by trench boxes (shoring); CAT scan and services drawing checked before digging to identify buried services. Operatives to wear PPE.'
);
const excReport2 = report('Excavation WITH collapse/services control', excavationWithControl);
const excCheck2 = excReport2.hazardResults.find(h => h.id === 'excavation');
assert(excCheck2.status === 'pass', 'excavation should pass with shoring + CAT scan mentioned');
assert(excReport2.percent > excReport.percent, 'adding the control should raise the score');

console.log('\nAll engine tests passed.');
