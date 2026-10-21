/** 1 mph = 0.44704 m/s exactly (international mile and hour). */
export const MS_PER_MPH = 0.44704;

export function msToMph(ms: number): number {
  return ms / MS_PER_MPH;
}

/** 16-point compass name for a direction the wind blows FROM (degrees). */
export function compassPoint(deg: number): string {
  const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const i = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return names[i];
}
