/** A small response in the shape Open-Meteo returns for the LiftWatch request. */
export function openMeteoResponse(days = 2, gust = (i: number) => 4 + (i % 24) * 0.25) {
  const time: string[] = [];
  const dates: string[] = [];
  for (let d = 0; d < days; d++) {
    const date = `2026-10-${String(22 + d).padStart(2, '0')}`;
    dates.push(date);
    for (let h = 0; h < 24; h++) time.push(`${date}T${String(h).padStart(2, '0')}:00`);
  }
  const n = time.length;
  const fill = (f: (i: number) => number | null) => Array.from({ length: n }, (_, i) => f(i));
  return {
    latitude: 51.5,
    longitude: -0.12,
    elevation: 20,
    timezone: 'Europe/London',
    hourly_units: {
      time: 'iso8601',
      wind_speed_10m: 'm/s',
      wind_gusts_10m: 'm/s',
      wind_direction_10m: '°',
      wind_speed_80m: 'm/s',
      wind_speed_120m: 'm/s',
      cape: 'J/kg',
      precipitation_probability: '%',
      visibility: 'm',
      temperature_2m: '°C',
    },
    hourly: {
      time,
      wind_speed_10m: fill((i) => gust(i) * 0.6),
      wind_gusts_10m: fill(gust),
      wind_direction_10m: fill(() => 225),
      wind_speed_80m: fill((i) => gust(i) * 0.8),
      wind_speed_120m: fill((i) => gust(i) * 0.9),
      cape: fill(() => 0),
      precipitation_probability: fill(() => 10),
      visibility: fill(() => 24000),
      temperature_2m: fill(() => 11),
    },
    daily: {
      time: dates,
      sunrise: dates.map((d) => `${d}T07:40`),
      sunset: dates.map((d) => `${d}T17:50`),
    },
  };
}

/**
 * A response as Open-Meteo sends it with timeformat=unixtime: hourly times are
 * UNIX seconds, a continuous run of hours from `startUtc`.
 */
export function openMeteoUnixResponse(
  startUtc: string,
  hours: number,
  days: { sunriseUtc: string; sunsetUtc: string }[],
  gust: (i: number) => number = () => 3,
) {
  const start = Date.parse(startUtc) / 1000;
  const time = Array.from({ length: hours }, (_, i) => start + i * 3600);
  const fill = (f: (i: number) => number | null) => Array.from({ length: hours }, (_, i) => f(i));
  return {
    latitude: 51.5,
    longitude: -0.12,
    elevation: 20,
    timezone: 'Europe/London',
    hourly_units: { time: 'unixtime', wind_speed_10m: 'm/s', wind_gusts_10m: 'm/s', wind_speed_80m: 'm/s', wind_speed_120m: 'm/s' },
    hourly: {
      time,
      wind_speed_10m: fill((i) => gust(i) * 0.6),
      wind_gusts_10m: fill(gust),
      wind_direction_10m: fill(() => 225),
      wind_speed_80m: fill((i) => gust(i) * 0.8),
      wind_speed_120m: fill((i) => gust(i) * 0.9),
      cape: fill(() => 0),
      precipitation_probability: fill(() => 10),
      visibility: fill(() => 24000),
      temperature_2m: fill(() => 11),
    },
    daily: {
      time: days.map((d) => Date.parse(d.sunriseUtc) / 1000),
      sunrise: days.map((d) => Date.parse(d.sunriseUtc) / 1000),
      sunset: days.map((d) => Date.parse(d.sunsetUtc) / 1000),
    },
  };
}
