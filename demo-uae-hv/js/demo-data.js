// Seed data and sessionStorage persistence for the UAE HV QA demo.
// Entirely synthetic — no Supabase, no network, no production data of
// any kind. State lives only in this browser tab's sessionStorage, so
// it never crosses tabs, never survives the tab closing, and never
// reaches a server.

export const DEMO_ACCESS_CODE_FALLBACK = "RAK2026";
const STORAGE_KEY = "uaehv_demo_state_v1";
const UNLOCK_KEY = "uaehv_demo_unlocked_v1";

const PROJECT = {
  name: "Al Marjan Island 33/11kV Primary Substation & HV Distribution Package",
  location: "Ras Al Khaimah, UAE",
  client: "EtihadWE",
  pmc: "PMC Consultant (Al Marjan Island Infrastructure)",
  primarySubstationAssetTag: "SS-33KV-MARJAN-04",
};

// Each checklist item: { id, label, checked }. Items are deep-cloned per
// WIR so ticking one WIR's checklist never mutates another's.
function checklist(labels) {
  return labels.map((label, i) => ({ id: `item-${i + 1}`, label, checked: false }));
}

const WIR_CHECKLISTS = {
  "WIR-HV-001": [
    "Trench excavation dimensions verified against drawing CBL-TR-004 Rev C",
    "Trench base free of sharp stones, standing water and debris",
    "Sand bedding depth and compaction verified (min. 150mm)",
    "Cable route marker tape and warning tiles laid per EtihadWE spec",
    "Thermal backfill material verified (CBR / thermal resistivity cert checked)",
    "Backfill compaction in 150mm layers witnessed",
  ],
  "WIR-HV-002": [
    "Cable drum certificates and test reports checked against delivery",
    "Pulling tension and bend radius within manufacturer limits (logged)",
    "Cable identification and phasing labelled at both ends",
    "Jointing bay environment (humidity/temperature) within tolerance",
    "Straight-through joint kit batch number recorded and photographed",
    "Joint insulation resistance test completed and passed",
  ],
  "WIR-HV-003": [
    "Transformer TX-02B final position and orientation verified against GA drawing",
    "Plinth level and anchor bolt torque checked",
    "Bund wall integrity and oil containment capacity verified (110% rule)",
    "Earthing grid continuity test completed — all connections <0.5 ohm",
    "Earth pit resistance test results within design limit",
    "Transformer nameplate data matches approved datasheet",
  ],
  "WIR-HV-004": [
    "Switchgear panel SWG-PNL-09 mechanical interlocks function-tested",
    "Busbar torque values checked against manufacturer table",
    "VLF (Very Low Frequency) withstand test completed on all HV cores",
    "Hi-Pot test results recorded — no breakdown or excessive leakage",
    "Protection relay secondary injection test — pickup and timing verified",
    "CT/VT ratio and polarity checks completed",
  ],
};

function emptySignOff() {
  return {
    checklist: [],
    photos: [], // { id, assetTag, takenAtIso, hash, dataUrl }
    signature: null, // { dataUrl, signedBy, signedAtIso }
    lockedAtIso: null,
    recordHash: null,
  };
}

function seedWirs() {
  const now = Date.now();
  const daysAgo = (n) => new Date(now - n * 86400000).toISOString();

  return [
    {
      id: "WIR-HV-001",
      title: "33kV Underground Cable Trench Bedding & Thermal Backfill Inspection",
      assetTag: "CBL-TRENCH-SEC-B",
      status: "approved",
      signOff: {
        checklist: checklist(WIR_CHECKLISTS["WIR-HV-001"]).map((c) => ({ ...c, checked: true })),
        photos: [],
        signature: { dataUrl: null, signedBy: "A. Hassan — PMC Resident Engineer", signedAtIso: daysAgo(12) },
        lockedAtIso: daysAgo(12),
        recordHash: "9f2c6b1a7e4d0853c1f9a6e2b7d4580fca3e91b2d7c4f6018b5a9e3c2d1f7a4",
      },
    },
    {
      id: "WIR-HV-002",
      title: "33kV XLPE Cable Pulling & Straight-Through Jointing Bay #4",
      assetTag: "CBL-JNT-BAY-04",
      status: "approved",
      signOff: {
        checklist: checklist(WIR_CHECKLISTS["WIR-HV-002"]).map((c) => ({ ...c, checked: true })),
        photos: [],
        signature: { dataUrl: null, signedBy: "A. Hassan — PMC Resident Engineer", signedAtIso: daysAgo(6) },
        lockedAtIso: daysAgo(6),
        recordHash: "3a7e1d9c5b2f0846ad1e7c3b9f5062de8c4a1b7e3f9d5026ca8b4e1d7f3a9c6",
      },
    },
    {
      id: "WIR-HV-003",
      title: "33/11kV Transformer TX-02B Placement, Bund Check & Earthing Grid Continuity",
      assetTag: "TX-02B",
      status: "pending_signoff",
      signOff: { ...emptySignOff(), checklist: checklist(WIR_CHECKLISTS["WIR-HV-003"]) },
    },
    {
      id: "WIR-HV-004",
      title: "11kV Switchgear Panel SWG-PNL-09 VLF / Hi-Pot Testing & Protection Relay Secondary Injection",
      assetTag: "SWG-PNL-09",
      status: "in_progress",
      signOff: {
        ...emptySignOff(),
        checklist: checklist(WIR_CHECKLISTS["WIR-HV-004"]).map((c, i) => ({ ...c, checked: i < 3 })),
      },
    },
  ];
}

function seedNcrs() {
  const now = Date.now();
  const daysAgo = (n) => new Date(now - n * 86400000).toISOString();
  return [
    {
      id: "NCR-001",
      title: "Defective gland earthing tag on Panel 04",
      assetTag: "SWG-PNL-04",
      raisedAtIso: daysAgo(9),
      raisedBy: "M. Okafor — Site QA Engineer",
      description:
        "Cable gland earthing continuity tag on Panel 04 found loose and not crimped to spec during routine walk-down. Gland bonded but tag connection does not meet torque requirement.",
      status: "closed",
      beforePhoto: null,
      afterPhoto: null,
    },
    {
      id: "NCR-002",
      title: "Missing bi-lingual Arabic/English HV Danger signage on Trench Section B",
      assetTag: "CBL-TRENCH-SEC-B",
      raisedAtIso: daysAgo(4),
      raisedBy: "M. Okafor — Site QA Engineer",
      description:
        "HV Danger warning signage along open trench Section B is English-only. EtihadWE HSE spec requires bi-lingual Arabic/English signage at all excavations exposing HV cable routes.",
      status: "open",
      beforePhoto: null,
      afterPhoto: null,
    },
  ];
}

function seedVariations() {
  const now = Date.now();
  const daysAgo = (n) => new Date(now - n * 86400000).toISOString();
  return [
    {
      id: "SI-013",
      title: "Duct bank handover delay — Sector 4",
      assetTag: "DUCT-BANK-SEC-04",
      loggedAtIso: daysAgo(7),
      transcript:
        "\"Client civil contractor delayed duct bank handover in Sector 4 by six hours. We had two UK HV jointers mobilised and standing by on site from 07:00, couldn't access the jointing bay until around 13:00. Requesting standing time be recorded against the civil interface delay, not against our programme.\"",
      claim: "Standing time claimed — 2x UK HV Jointers, 6.0 hours",
      status: "submitted",
    },
    {
      id: "SI-014",
      title: "Additional earthing rods — TX-02B bund area",
      assetTag: "TX-02B",
      loggedAtIso: daysAgo(3),
      transcript:
        "\"Soil resistivity test results at the TX-02B bund area came back higher than the design assumption, so the earth grid as drawn won't hit the target resistance. Client's consultant has instructed additional earthing rods be installed around the bund perimeter — treating this as a site instruction, not a design change on our side.\"",
      claim: "Material + labour variation — additional earthing rods per SI-014",
      status: "pending_pricing",
    },
  ];
}

function freshState() {
  return {
    project: PROJECT,
    wirs: seedWirs(),
    ncrs: seedNcrs(),
    variations: seedVariations(),
  };
}

export function loadState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore — e.g. private browsing or corrupted JSON, fall through to reseed
  }
  const state = freshState();
  saveState(state);
  return state;
}

export function saveState(state) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // sessionStorage can throw (quota, private mode) — the demo still
    // works in-memory for the rest of this page load, it just won't
    // persist across a reload
  }
}

export function resetState() {
  const state = freshState();
  saveState(state);
  return state;
}

export function isUnlocked() {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

export function grantAccess() {
  try {
    sessionStorage.setItem(UNLOCK_KEY, "1");
  } catch {
    /* if sessionStorage is unavailable the gate can't persist across a
       navigation — the caller still proceeds for this page view */
  }
}
