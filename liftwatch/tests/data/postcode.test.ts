import { describe, expect, it } from 'vitest';
import { lookupPostcode, manualLocation, normalisePostcode, PostcodeError } from '../../src/data/postcode';

const fakeFetch = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('normalisePostcode', () => {
  it('formats valid postcodes', () => {
    expect(normalisePostcode('sw1a1aa')).toBe('SW1A 1AA');
    expect(normalisePostcode(' M1  1AE ')).toBe('M1 1AE');
    expect(normalisePostcode('b338th')).toBe('B33 8TH');
  });
  it('rejects things that are not postcodes', () => {
    expect(() => normalisePostcode('hello')).toThrow(PostcodeError);
    expect(() => normalisePostcode('')).toThrow(PostcodeError);
  });
});

describe('lookupPostcode', () => {
  it('returns the location from postcodes.io', async () => {
    const site = await lookupPostcode(
      'sw1a1aa',
      fakeFetch(200, { status: 200, result: { postcode: 'SW1A 1AA', latitude: 51.501, longitude: -0.1416, admin_district: 'Westminster' } }),
    );
    expect(site).toEqual({ postcode: 'SW1A 1AA', label: 'SW1A 1AA, Westminster', latitude: 51.501, longitude: -0.1416 });
  });
  it('explains a postcode that is not found', async () => {
    await expect(lookupPostcode('ZZ1 1ZZ', fakeFetch(404, { status: 404 }))).rejects.toThrow(/not found/);
  });
  it('explains a postcode with no location', async () => {
    await expect(
      lookupPostcode('GY1 1AA', fakeFetch(200, { result: { postcode: 'GY1 1AA', latitude: null, longitude: null } })),
    ).rejects.toThrow(/latitude and longitude/);
  });
});

describe('manualLocation', () => {
  it('accepts valid coordinates and rejects others', () => {
    expect(manualLocation(52.2, -1.5).latitude).toBe(52.2);
    expect(() => manualLocation(95, 0)).toThrow(PostcodeError);
    expect(() => manualLocation(51, Number.NaN)).toThrow(PostcodeError);
  });
});
