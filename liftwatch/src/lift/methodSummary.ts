import { METHOD_VERSION, REFERENCE_AREA_RATIO } from '../wind';

/** Plain-text method summary for the PDF. Keep in step with METHOD.md. */
export const METHOD_SUMMARY: readonly string[] = [
  `Method ${METHOD_VERSION}.`,
  '1. Gust at height = forecast 10 m gust × height factor. Factors (Liebherr, quoted by CPA/TCIG 2025): 10 m 1.000, 50 m 1.181, 100 m 1.272, 150 m 1.329, interpolated linearly in log(height). 1.0 below 10 m; not used above 150 m.',
  `2. Permitted wind speed for the load (EN 13000 / BS 7121-1 Annex D): Ap = length × height; Aw = Ap × cw; r = Aw ÷ (load + rigging mass in t). If r ≤ ${REFERENCE_AREA_RATIO} m²/t the chart limit applies; otherwise permitted = chart limit × √(${REFERENCE_AREA_RATIO} ÷ r). Never above the chart limit.`,
  '3. Each hour: ratio = gust at height ÷ permitted. Below 0.80 Within limits; 0.80 to 1.00 Near limit; above 1.00 Over limit.',
  '4. Flags (never a pass): CAPE > 500 J/kg thunderstorm risk; CAPE 100–500 possible thunder; visibility < 5 km; precipitation probability ≥ 70 %; temperature ≤ 1 °C frost / ice risk; outside daylight; missing data.',
  '5. Daylight periods and the 7-day outlook are planning guidance only.',
];

export const METHOD_SOURCES: readonly string[] = [
  'CPA/TCIG, Planning and Control of Lifting Operations in Wind, July 2025 (gust and mean-to-gust factors, worked example).',
  'BS EN 13000, Cranes. Mobile cranes (wind area 1.2 m²/t, cw 1.2 assumed by load charts).',
  'BS 7121-1, Code of practice for safe use of cranes, Annex D (wind-area reduction).',
  'Open-Meteo forecast API, open-meteo.com (modelled forecast, best-match model blend).',
  'postcodes.io (postcode to latitude/longitude).',
];
