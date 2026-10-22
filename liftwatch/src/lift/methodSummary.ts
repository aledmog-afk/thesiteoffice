import { METHOD_VERSION, REFERENCE_AREA_RATIO } from '../wind';

/** Plain-text method summary for the PDF. Keep in step with METHOD.md. */
export const METHOD_SUMMARY: readonly string[] = [
  `Method ${METHOD_VERSION}.`,
  '1. Gust at boom / jib head height = forecast 10 m gust × height factor. Factors (Liebherr Table 2, quoted by CPA/TCIG 2507 page 21): 10 m 1.000, 50 m 1.181, 100 m 1.272, 150 m 1.329, interpolated linearly in log(height). 1.0 below 10 m; not used above 150 m. The factors do not adjust for local ground roughness (CPA Annex H).',
  `2. Permitted wind speed for the load (EN 13000; CPA section 4.3 and Annex A; BS 7121-1 Annex D-1): Ap = length × height; Aw = Ap × cw; r = Aw ÷ (load + rigging, hook block and rope, in t). If r ≤ ${REFERENCE_AREA_RATIO} m²/t the chart limit applies; otherwise permitted = chart limit × √(${REFERENCE_AREA_RATIO} ÷ r). Never above the chart limit. Reproduces the CPA guide's Annex E worked examples.`,
  '3. Each hour: ratio = gust at height ÷ permitted. Below 0.80 Within limits; 0.80 to 1.00 Near limit; above 1.00 Over limit. The 0.80 band is a LiftWatch pilot choice, not from CPA.',
  '4. Flags (LiftWatch pilot choices; never a pass): CAPE > 500 J/kg thunderstorm risk; CAPE 100–500 possible thunder; visibility < 5 km; precipitation probability ≥ 70 %; temperature ≤ 1 °C frost / ice risk; outside daylight; missing data.',
  '5. Daylight periods and the 7-day outlook are planning guidance only.',
];

export const METHOD_SOURCES: readonly string[] = [
  'CPA/TCIG 2507, Planning and Control of Lifting Operations in Wind, V1, July 2025 (height factors page 21; formula section 4.3 and Annex A; worked examples Annex E).',
  'BS EN 13000:2010+A1:2014, Cranes. Mobile cranes (load wind area 1.0 m²/t with cw 1.2 = 1.2 m²/t effective).',
  'BS 7121-1:2016, Code of practice for safe use of cranes, Annex D-1 (flow chart for loads with a large wind area).',
  'Liebherr, Wind influences on cranes, 2017 (height factors Table 2, drag coefficients Table 1).',
  'Open-Meteo forecast API, open-meteo.com (modelled forecast, best-match model blend).',
  'postcodes.io (postcode to latitude/longitude).',
];
