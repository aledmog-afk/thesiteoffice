/**
 * App configuration. Brand name, endpoints and method constants all live here so
 * they can be changed in one place. Values from VITE_* environment variables are
 * set at build time (see README, "Configuration").
 */
export {
  DEFAULT_DRAG_COEFFICIENT,
  MEAN_TO_GUST_10M_FACTOR,
  METHOD_VERSION,
  REFERENCE_AREA_RATIO,
} from './wind/constants';

/** Working name. Change it here and in index.html <title>. */
export const APP_NAME = 'LiftWatch';

const env = import.meta.env ?? {};

export const FORECAST_CONFIG = Object.freeze({
  sourceName: 'Open-Meteo',
  sourceUrl: 'https://open-meteo.com/',
  /**
   * The LiftWatch Worker URL (e.g. https://liftwatch-forecast.example.workers.dev/forecast).
   * Leave empty to call Open-Meteo directly from the browser (local development).
   */
  proxyUrl: (env.VITE_FORECAST_PROXY_URL as string | undefined) ?? '',
  /**
   * Open-Meteo endpoint for direct calls. The free endpoint is for non-commercial
   * use only. The commercial endpoint is https://customer-api.open-meteo.com/v1/forecast
   * with an API key. Put that key in the Worker (a secret), not in the browser build.
   */
  directBaseUrl: (env.VITE_OPEN_METEO_BASE_URL as string | undefined) ?? 'https://api.open-meteo.com/v1/forecast',
  /** Only for direct calls. Anything here ends up in the browser bundle. */
  directApiKey: (env.VITE_OPEN_METEO_API_KEY as string | undefined) ?? '',
});

/**
 * Feature flags. The capacity, sling and ground-bearing calculators are off until a
 * qualified Appointed Person has reviewed them. The code and tests are kept. To turn
 * them on for a review build, set VITE_ENABLE_CALCULATORS=true at build time.
 */
export const FEATURES = Object.freeze({
  calculators: (env.VITE_ENABLE_CALCULATORS as string | undefined) === 'true',
});

/** Shown in place of a calculator while `FEATURES.calculators` is off. */
export const CALCULATORS_UNAVAILABLE = 'Not available: awaiting review by a qualified Appointed Person';

export const POSTCODE_API_URL = 'https://api.postcodes.io/postcodes/';

/** Footer required on every PDF and shown under the assessment. */
export const DISCLAIMER =
  "Forecasts are modelled estimates, not measurements. This assessment supports, and does not replace, the lift plan, the Appointed Person's judgement, manufacturer data, BS 7121 and on-site wind checks.";

/** The method page (method.html, built from METHOD.md). */
export const METHOD_PAGE_PATH = '/method';

/** Draft privacy notice and terms (public/privacy.html, public/terms.html). */
export const PRIVACY_PAGE_PATH = '/privacy.html';
export const TERMS_PAGE_PATH = '/terms.html';

/** Full address of the method page, for the PDF. Falls back to the path outside a browser. */
export function methodPageUrl(): string {
  const origin = globalThis.location?.origin;
  return origin && origin !== 'null' ? `${origin}${METHOD_PAGE_PATH}` : METHOD_PAGE_PATH;
}

export const BANNER_SUFFIX = 'forecast assessment against the limits you entered';
