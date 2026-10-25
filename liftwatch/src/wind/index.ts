/**
 * LiftWatch wind maths. Pure functions only: no DOM, no network, no storage.
 * Every formula is documented in METHOD.md with its source.
 */
export * from './constants';
export * from './errors';
export * from './types';
export { hourStartMs, hourStarts, sunriseMs, sunsetMs } from './instants';
export { interpolateLogHeight } from './interpolate';
export { gustAtHeight, gustHeightFactor } from './heightFactor';
export { gustAtHeightFromMean, meanToGustFactor } from './meanToGust';
export {
  appliedHeightFactor,
  factorTerrain,
  profileGustRatio,
  TERRAIN,
  TERRAIN_NOT_APPLIED,
  terrainHeightFactor,
  TERRAINS,
  type Terrain,
  type TerrainInfo,
} from './terrain';
export { permittedWindSpeed, type LoadWindInput, type LoadWindResult, type WorkingStep } from './loadArea';
export { hourGusts, type HourGust } from './gustTiming';
export { assessHour, assessHours, classifyRatio, isDaylight, weatherFlags, type AssessOptions } from './assess';
export { compareSeverity, dailyOutlook, findWorkablePeriods, worstHour, type DayOutlook, type Period } from './periods';
export { compassPoint, msToMph, MS_PER_MPH } from './units';
