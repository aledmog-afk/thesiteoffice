import { NEAR_LIMIT_RATIO, OVER_LIMIT_RATIO, type Status } from '../wind';

const NEAR_PCT = NEAR_LIMIT_RATIO * 100;
const OVER_PCT = OVER_LIMIT_RATIO * 100;

/**
 * "% of limit" text that never contradicts the status next to it. Whole numbers
 * normally. Near a threshold, one decimal place. If even that would round onto
 * the threshold (79.96 → "80.0" while Within limits), "< 80 %" or "> 100 %".
 */
export function percentLabel(percent: number | null | undefined, status: Status): string {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return '–';
  const whole = Math.round(percent);
  if (status === 'within' && whole >= NEAR_PCT) {
    return Number(percent.toFixed(1)) < NEAR_PCT ? `${percent.toFixed(1)} %` : `< ${NEAR_PCT} %`;
  }
  if (status === 'over' && whole <= OVER_PCT) {
    return Number(percent.toFixed(1)) > OVER_PCT ? `${percent.toFixed(1)} %` : `> ${OVER_PCT} %`;
  }
  return `${whole} %`;
}
