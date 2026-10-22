import { gustHeightFactor } from './heightFactor';
import { requirePositive } from './errors';

export type Terrain = 'open' | 'town' | 'city';

export interface TerrainInfo {
  label: string;
  description: string;
  /** EN 1991-1-4 Table 4.1 terrain category this setting stands for. */
  category: string;
  /** Roughness length z0 (m), EN 1991-1-4 Table 4.1. */
  z0: number;
  /** Minimum height zmin (m), EN 1991-1-4 Table 4.1. */
  zMin: number;
}

/**
 * Upwind terrain around the site. Roughness lengths and minimum heights are from
 * EN 1991-1-4 Table 4.1 (categories II, III and IV). CPA/TCIG 2507 Annex H gives
 * similar classes (open agricultural land z0 0.03, villages / small towns 0.4,
 * larger cities 0.8).
 */
export const TERRAIN: Readonly<Record<Terrain, TerrainInfo>> = Object.freeze({
  open: {
    label: 'Open country',
    description: 'Fields, coast, airfields, scattered buildings',
    category: 'II',
    z0: 0.05,
    zMin: 2,
  },
  town: {
    label: 'Town',
    description: 'Suburbs, villages, industrial estates, woodland',
    category: 'III',
    z0: 0.3,
    zMin: 5,
  },
  city: {
    label: 'City',
    description: 'City centre, at least 15 % covered by buildings over 15 m',
    category: 'IV',
    z0: 1.0,
    zMin: 10,
  },
});

/**
 * Ratio of the peak (gust) wind speed at height h to the peak at 10 m, for a
 * terrain of roughness z0, from the EN 1991-1-4 profile:
 *
 *   vm(z) ∝ ln(z / z0)                 mean wind (cl. 4.3.2, flat terrain, co = 1)
 *   Iv(z) = 1 / ln(z / z0)             turbulence intensity (cl. 4.4, kI = 1)
 *   vp(z) = vm(z) × √(1 + 7 Iv(z))     peak velocity, from qp = [1 + 7 Iv] ½ ρ vm² (cl. 4.5)
 *
 *   ratio = vp(max(h, zmin)) / vp(max(10, zmin))
 *
 * The basic wind speed and the roughness factor kr cancel in the ratio.
 */
export function profileGustRatio(heightM: number, z0: number, zMin: number): number {
  requirePositive(heightM, 'Height');
  const vp = (z: number) => {
    const l = Math.log(z / z0);
    return l * Math.sqrt(1 + 7 / l);
  };
  return vp(Math.max(heightM, zMin)) / vp(Math.max(10, zMin));
}

/**
 * Gust height factor for the site's terrain (METHOD.md, step 1).
 *
 * - Open country: the published Liebherr factors (CPA page 21), unchanged. The
 *   EN 1991-1-4 profile for open country (category II) is within 3 % of them.
 * - Town and city: the EN 1991-1-4 profile ratio for that terrain, which rises
 *   faster with height because the ground slows the wind more at 10 m. Never less
 *   than the open-country factor, and never below 1.0.
 * - Above 150 m: refused, as for open country.
 */
export function terrainHeightFactor(heightM: number, terrain: Terrain = 'open'): number {
  const published = gustHeightFactor(heightM);
  if (terrain === 'open') return published;
  const t = TERRAIN[terrain];
  return Math.max(1, published, profileGustRatio(heightM, t.z0, t.zMin));
}
