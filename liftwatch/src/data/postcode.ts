import { POSTCODE_API_URL } from '../config';

export interface SiteLocation {
  /** Formatted postcode when looked up, otherwise undefined. */
  postcode?: string;
  /** Short description for screens and the PDF. */
  label: string;
  latitude: number;
  longitude: number;
}

export class PostcodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostcodeError';
  }
}

// Outward code (A9, A99, AA9, AA99, A9A, AA9A) + inward code (9AA), no space.
const POSTCODE_RE = /^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/;

/** "sw1a1aa" → "SW1A 1AA". Throws PostcodeError when it is not a UK postcode shape. */
export function normalisePostcode(input: string): string {
  const compact = input.toUpperCase().replace(/\s+/g, '');
  if (!POSTCODE_RE.test(compact)) throw new PostcodeError(`"${input.trim()}" does not look like a UK postcode.`);
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

/** Looks up a postcode with postcodes.io (open data, no key). */
export async function lookupPostcode(input: string, fetchImpl: typeof fetch = fetch): Promise<SiteLocation> {
  const postcode = normalisePostcode(input);
  let res: Response;
  try {
    res = await fetchImpl(`${POSTCODE_API_URL}${encodeURIComponent(postcode)}`);
  } catch {
    throw new PostcodeError('Could not reach the postcode service. Check the connection, or enter latitude and longitude.');
  }
  if (res.status === 404) throw new PostcodeError(`Postcode ${postcode} was not found.`);
  if (!res.ok) throw new PostcodeError(`The postcode service returned an error (${res.status}).`);

  const body = (await res.json()) as {
    result?: { postcode?: string; latitude?: number | null; longitude?: number | null; admin_district?: string | null };
  };
  const r = body.result;
  if (!r || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') {
    throw new PostcodeError(`Postcode ${postcode} has no location. Enter latitude and longitude instead.`);
  }
  const formatted = r.postcode ?? postcode;
  return {
    postcode: formatted,
    label: r.admin_district ? `${formatted}, ${r.admin_district}` : formatted,
    latitude: r.latitude,
    longitude: r.longitude,
  };
}

/** A site entered by latitude and longitude. */
export function manualLocation(latitude: number, longitude: number): SiteLocation {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new PostcodeError('Latitude must be between -90 and 90.');
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new PostcodeError('Longitude must be between -180 and 180.');
  }
  return { label: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`, latitude, longitude };
}
