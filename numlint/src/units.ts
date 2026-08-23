import type { Dimension, UnitDef, UnitRef, BaseDim } from './types.js';

const L = (n = 1): Dimension => ({ length: n });
const M = (n = 1): Dimension => ({ mass: n });
const T = (n = 1): Dimension => ({ time: n });

const AREA: Dimension = { length: 2 };
const VOLUME: Dimension = { length: 3 };
const SPEED: Dimension = { length: 1, time: -1 };
const ACCEL: Dimension = { length: 1, time: -2 };
const FORCE: Dimension = { mass: 1, length: 1, time: -2 };
const ENERGY: Dimension = { mass: 1, length: 2, time: -2 };
const POWER: Dimension = { mass: 1, length: 2, time: -3 };
const PRESSURE: Dimension = { mass: 1, length: -1, time: -2 };
const FREQ: Dimension = { time: -1 };
const FUEL_DIST_PER_VOL: Dimension = { length: -2 };   // mpg  (L/L^3)
const FUEL_VOL_PER_DIST: Dimension = { length: 2 };    // L/100km

function u(
  id: string,
  dim: Dimension,
  factor: number,
  forms: string[],
  opts: Partial<UnitDef> = {},
): UnitDef {
  return { id, dim, factor, forms, ...opts };
}

/** Registry. `forms` are matched longest-first; `cs` forms must match case exactly. */
export const UNITS: UnitDef[] = [
  // ---------- length ----------
  u('metre', L(), 1, ['metres', 'meters', 'metre', 'meter', 'm'], { system: 'si' }),
  u('kilometre', L(), 1000, ['kilometres', 'kilometers', 'kilometre', 'kilometer', 'km', 'kms'], { system: 'si' }),
  u('centimetre', L(), 0.01, ['centimetres', 'centimeters', 'centimetre', 'centimeter', 'cm'], { system: 'si' }),
  u('millimetre', L(), 0.001, ['millimetres', 'millimeters', 'millimetre', 'millimeter', 'mm'], { system: 'si' }),
  u('micrometre', L(), 1e-6, ['micrometres', 'micrometers', 'microns', 'micron', 'µm', 'um'], { system: 'si' }),
  u('nanometre', L(), 1e-9, ['nanometres', 'nanometers', 'nm'], { system: 'si' }),
  u('mile', L(), 1609.344, ['miles', 'mile', 'mi'], { system: 'imperial' }),
  u('yard', L(), 0.9144, ['yards', 'yard', 'yds', 'yd'], { system: 'imperial' }),
  u('foot', L(), 0.3048, ['feet', 'foot', 'ft'], { system: 'imperial' }),
  u('inch', L(), 0.0254, ['inches', 'inch'], { system: 'imperial' }),
  u('inch-abbr', L(), 0.0254, ['in.', 'in'], { system: 'imperial' }),
  u('nautical-mile', L(), 1852, ['nautical miles', 'nautical mile', 'nmi'], { system: 'other' }),
  u('light-year', L(), 9.4607304725808e15, ['light-years', 'light years', 'light-year', 'light year', 'ly'], { system: 'other' }),
  u('astronomical-unit', L(), 1.495978707e11, ['astronomical units', 'astronomical unit', 'AU'], { system: 'other', cs: true }),
  u('parsec', L(), 3.0856775814913673e16, ['parsecs', 'parsec', 'pc'], { system: 'other' }),
  u('angstrom', L(), 1e-10, ['angstroms', 'angstrom', 'Å'], { system: 'other' }),
  u('furlong', L(), 201.168, ['furlongs', 'furlong'], { system: 'imperial' }),

  // ---------- mass ----------
  u('kilogram', M(), 1, ['kilograms', 'kilogrammes', 'kilogram', 'kilogramme', 'kilos', 'kilo', 'kg'], { system: 'si' }),
  u('gram', M(), 0.001, ['grams', 'grammes', 'gram', 'gramme', 'g'], { system: 'si' }),
  u('milligram', M(), 1e-6, ['milligrams', 'milligram', 'mg'], { system: 'si' }),
  u('microgram', M(), 1e-9, ['micrograms', 'microgram', 'µg', 'mcg'], { system: 'si' }),
  u('tonne', M(), 1000, ['tonnes', 'tonne', 'metric tons', 'metric ton', 'metric tonnes'], { system: 'si' }),
  u('pound', M(), 0.45359237, ['pounds', 'pound', 'lbs', 'lb'], { system: 'imperial' }),
  u('ounce', M(), 0.028349523125, ['ounces', 'ounce', 'oz'], { system: 'imperial' }),
  u('stone', M(), 6.35029318, ['stone', 'stones', 'st'], { system: 'imperial' }),
  u('short-ton', M(), 907.18474, ['short tons', 'short ton', 'US tons', 'US ton'], { system: 'us' }),
  u('long-ton', M(), 1016.0469088, ['long tons', 'long ton', 'imperial tons', 'imperial ton'], { system: 'imperial' }),
  u('carat', M(), 0.0002, ['carats', 'carat', 'ct'], { system: 'other' }),

  // ---------- time ----------
  u('second', T(), 1, ['seconds', 'second', 'secs', 'sec', 's'], { system: 'si' }),
  u('millisecond', T(), 0.001, ['milliseconds', 'millisecond', 'ms'], { system: 'si' }),
  u('microsecond', T(), 1e-6, ['microseconds', 'microsecond', 'µs'], { system: 'si' }),
  u('nanosecond', T(), 1e-9, ['nanoseconds', 'nanosecond', 'ns'], { system: 'si' }),
  u('minute', T(), 60, ['minutes', 'minute', 'mins', 'min'], { system: 'other' }),
  u('hour', T(), 3600, ['hours', 'hour', 'hrs', 'hr', 'h'], { system: 'other' }),
  u('day', T(), 86400, ['days', 'day'], { system: 'other' }),
  u('week', T(), 604800, ['weeks', 'week'], { system: 'other' }),
  u('fortnight', T(), 1209600, ['fortnights', 'fortnight'], { system: 'other' }),
  u('month', T(), 2629800, ['months', 'month'], { system: 'other' }),
  u('year', T(), 31557600, ['years', 'year', 'yrs', 'yr'], { system: 'other' }),
  u('decade', T(), 315576000, ['decades', 'decade'], { system: 'other' }),
  u('century', T(), 3155760000, ['centuries', 'century'], { system: 'other' }),

  // ---------- temperature (offset units) ----------
  u('kelvin', { temperature: 1 }, 1, ['kelvin', 'K'], { system: 'si', cs: true, offset: 0 }),
  u('celsius', { temperature: 1 }, 1, ['°C', 'degrees Celsius', 'degrees celsius', 'degrees C', 'C'], { system: 'si', offset: 273.15 }),
  u('fahrenheit', { temperature: 1 }, 5 / 9, ['°F', 'degrees Fahrenheit', 'degrees fahrenheit', 'degrees F', 'F'], { system: 'us', offset: 255.3722222222222 }),

  // ---------- area ----------
  u('square-metre', AREA, 1, ['square metres', 'square meters', 'square metre', 'square meter', 'sq m', 'm²', 'm2'], { system: 'si' }),
  u('square-kilometre', AREA, 1e6, ['square kilometres', 'square kilometers', 'square kilometre', 'square kilometer', 'sq km', 'km²', 'km2'], { system: 'si' }),
  u('hectare', AREA, 1e4, ['hectares', 'hectare', 'ha'], { system: 'si' }),
  u('acre', AREA, 4046.8564224, ['acres', 'acre'], { system: 'imperial' }),
  u('square-mile', AREA, 2589988.110336, ['square miles', 'square mile', 'sq mi', 'mi²'], { system: 'imperial' }),
  u('square-foot', AREA, 0.09290304, ['square feet', 'square foot', 'sq ft', 'ft²', 'sqft'], { system: 'imperial' }),
  u('square-yard', AREA, 0.83612736, ['square yards', 'square yard', 'sq yd'], { system: 'imperial' }),
  u('square-inch', AREA, 0.00064516, ['square inches', 'square inch', 'sq in'], { system: 'imperial' }),

  // ---------- volume ----------
  u('cubic-metre', VOLUME, 1, ['cubic metres', 'cubic meters', 'cubic metre', 'cubic meter', 'm³', 'm3'], { system: 'si' }),
  u('litre', VOLUME, 0.001, ['litres', 'liters', 'litre', 'liter', 'L', 'l'], { system: 'si' }),
  u('millilitre', VOLUME, 1e-6, ['millilitres', 'milliliters', 'millilitre', 'milliliter', 'ml', 'mL'], { system: 'si' }),
  u('centilitre', VOLUME, 1e-5, ['centilitres', 'centiliters', 'cl'], { system: 'si' }),
  u('us-gallon', VOLUME, 0.003785411784, ['US gallons', 'US gallon', 'gallons', 'gallon', 'gal'], { system: 'us' }),
  u('imperial-gallon', VOLUME, 0.00454609, ['imperial gallons', 'imperial gallon'], { system: 'imperial' }),
  u('us-pint', VOLUME, 0.000473176473, ['US pints', 'US pint'], { system: 'us' }),
  u('imperial-pint', VOLUME, 0.00056826125, ['pints', 'pint'], { system: 'imperial' }),
  u('us-quart', VOLUME, 0.000946352946, ['quarts', 'quart'], { system: 'us' }),
  u('us-fluid-ounce', VOLUME, 2.95735295625e-5, ['fluid ounces', 'fluid ounce', 'fl oz'], { system: 'us' }),
  u('cup', VOLUME, 2.365882365e-4, ['cups', 'cup'], { system: 'us' }),
  u('tablespoon', VOLUME, 1.478676478125e-5, ['tablespoons', 'tablespoon', 'tbsp'], { system: 'us' }),
  u('teaspoon', VOLUME, 4.92892159375e-6, ['teaspoons', 'teaspoon', 'tsp'], { system: 'us' }),
  u('oil-barrel', VOLUME, 0.158987294928, ['barrels', 'barrel', 'bbl'], { system: 'other' }),
  u('cubic-foot', VOLUME, 0.028316846592, ['cubic feet', 'cubic foot', 'cu ft', 'ft³'], { system: 'imperial' }),
  u('cubic-inch', VOLUME, 1.6387064e-5, ['cubic inches', 'cubic inch', 'cu in'], { system: 'imperial' }),

  // ---------- speed ----------
  u('metre-per-second', SPEED, 1, ['metres per second', 'meters per second', 'm/s', 'mps'], { system: 'si' }),
  u('kilometre-per-hour', SPEED, 1 / 3.6, ['kilometres per hour', 'kilometers per hour', 'km/h', 'kph', 'kmh'], { system: 'si' }),
  u('mile-per-hour', SPEED, 0.44704, ['miles per hour', 'mph', 'mi/h'], { system: 'imperial' }),
  u('knot', SPEED, 0.5144444444444445, ['knots', 'knot', 'kt'], { system: 'other' }),
  u('foot-per-second', SPEED, 0.3048, ['feet per second', 'ft/s', 'fps'], { system: 'imperial' }),

  // ---------- energy ----------
  u('joule', ENERGY, 1, ['joules', 'joule', 'J'], { system: 'si', cs: true }),
  u('kilojoule', ENERGY, 1000, ['kilojoules', 'kilojoule', 'kJ'], { system: 'si' }),
  u('megajoule', ENERGY, 1e6, ['megajoules', 'megajoule', 'MJ'], { system: 'si', cs: true }),
  u('gigajoule', ENERGY, 1e9, ['gigajoules', 'gigajoule', 'GJ'], { system: 'si', cs: true }),
  u('kilowatt-hour', ENERGY, 3.6e6, ['kilowatt-hours', 'kilowatt hours', 'kilowatt-hour', 'kWh'], { system: 'si' }),
  u('megawatt-hour', ENERGY, 3.6e9, ['megawatt-hours', 'megawatt hours', 'MWh'], { system: 'si' }),
  u('gigawatt-hour', ENERGY, 3.6e12, ['gigawatt-hours', 'gigawatt hours', 'GWh'], { system: 'si' }),
  u('terawatt-hour', ENERGY, 3.6e15, ['terawatt-hours', 'terawatt hours', 'TWh'], { system: 'si' }),
  u('calorie', ENERGY, 4.184, ['calories', 'calorie', 'cal'], { system: 'other' }),
  u('kilocalorie', ENERGY, 4184, ['kilocalories', 'kilocalorie', 'kcal'], { system: 'other' }),
  u('btu', ENERGY, 1055.05585262, ['BTU', 'BTUs', 'British thermal units', 'British thermal unit'], { system: 'us', cs: true }),
  u('electronvolt', ENERGY, 1.602176634e-19, ['electronvolts', 'electronvolt', 'eV'], { system: 'other', cs: true }),

  // ---------- power ----------
  u('watt', POWER, 1, ['watts', 'watt', 'W'], { system: 'si', cs: true }),
  u('kilowatt', POWER, 1000, ['kilowatts', 'kilowatt', 'kW'], { system: 'si' }),
  u('megawatt', POWER, 1e6, ['megawatts', 'megawatt', 'MW'], { system: 'si', cs: true }),
  u('gigawatt', POWER, 1e9, ['gigawatts', 'gigawatt', 'GW'], { system: 'si', cs: true }),
  u('terawatt', POWER, 1e12, ['terawatts', 'terawatt', 'TW'], { system: 'si', cs: true }),
  u('horsepower', POWER, 745.6998715822702, ['horsepower', 'hp', 'bhp'], { system: 'imperial' }),

  // ---------- pressure ----------
  u('pascal', PRESSURE, 1, ['pascals', 'pascal', 'Pa'], { system: 'si', cs: true }),
  u('kilopascal', PRESSURE, 1000, ['kilopascals', 'kilopascal', 'kPa'], { system: 'si' }),
  u('hectopascal', PRESSURE, 100, ['hectopascals', 'hectopascal', 'hPa'], { system: 'si' }),
  u('megapascal', PRESSURE, 1e6, ['megapascals', 'megapascal', 'MPa'], { system: 'si', cs: true }),
  u('bar', PRESSURE, 1e5, ['bar', 'bars'], { system: 'other' }),
  u('millibar', PRESSURE, 100, ['millibars', 'millibar', 'mbar', 'mb'], { system: 'other' }),
  u('psi', PRESSURE, 6894.757293168361, ['psi', 'pounds per square inch'], { system: 'us' }),
  u('atmosphere', PRESSURE, 101325, ['atmospheres', 'atmosphere', 'atm'], { system: 'other' }),
  u('mmhg', PRESSURE, 133.322387415, ['mmHg', 'torr'], { system: 'other' }),

  // ---------- force ----------
  u('newton', FORCE, 1, ['newtons', 'newton', 'N'], { system: 'si', cs: true }),
  u('kilonewton', FORCE, 1000, ['kilonewtons', 'kilonewton', 'kN'], { system: 'si' }),
  u('pound-force', FORCE, 4.4482216152605, ['pounds of force', 'pound-force', 'lbf'], { system: 'us' }),

  // ---------- data ----------
  u('byte', { data: 1 }, 1, ['bytes', 'byte', 'B'], { system: 'si', cs: true }),
  u('kilobyte', { data: 1 }, 1000, ['kilobytes', 'kilobyte', 'kB', 'KB'], { system: 'si', cs: true }),
  u('megabyte', { data: 1 }, 1e6, ['megabytes', 'megabyte', 'MB'], { system: 'si', cs: true }),
  u('gigabyte', { data: 1 }, 1e9, ['gigabytes', 'gigabyte', 'GB'], { system: 'si', cs: true }),
  u('terabyte', { data: 1 }, 1e12, ['terabytes', 'terabyte', 'TB'], { system: 'si', cs: true }),
  u('petabyte', { data: 1 }, 1e15, ['petabytes', 'petabyte', 'PB'], { system: 'si', cs: true }),
  u('kibibyte', { data: 1 }, 1024, ['kibibytes', 'kibibyte', 'KiB'], { system: 'other', cs: true }),
  u('mebibyte', { data: 1 }, 1048576, ['mebibytes', 'mebibyte', 'MiB'], { system: 'other', cs: true }),
  u('gibibyte', { data: 1 }, 1073741824, ['gibibytes', 'gibibyte', 'GiB'], { system: 'other', cs: true }),
  u('tebibyte', { data: 1 }, 1099511627776, ['tebibytes', 'tebibyte', 'TiB'], { system: 'other', cs: true }),
  u('bit', { data: 1 }, 0.125, ['bits', 'bit', 'b'], { system: 'si', cs: true }),
  u('megabit', { data: 1 }, 125000, ['megabits', 'megabit', 'Mb'], { system: 'si', cs: true }),
  u('gigabit', { data: 1 }, 1.25e8, ['gigabits', 'gigabit', 'Gb'], { system: 'si', cs: true }),

  // ---------- frequency ----------
  u('hertz', FREQ, 1, ['hertz', 'Hz'], { system: 'si', cs: true }),
  u('kilohertz', FREQ, 1000, ['kilohertz', 'kHz'], { system: 'si' }),
  u('megahertz', FREQ, 1e6, ['megahertz', 'MHz'], { system: 'si', cs: true }),
  u('gigahertz', FREQ, 1e9, ['gigahertz', 'GHz'], { system: 'si', cs: true }),

  // ---------- angle ----------
  u('degree-angle', { angle: 1 }, Math.PI / 180, ['degrees of arc', '°'], { system: 'other' }),
  u('radian', { angle: 1 }, 1, ['radians', 'radian', 'rad'], { system: 'si' }),

  // ---------- acceleration ----------
  u('metre-per-second-squared', ACCEL, 1, ['metres per second squared', 'm/s²', 'm/s2'], { system: 'si' }),
  u('gravity', ACCEL, 9.80665, ['g-force', 'gs of force'], { system: 'other' }),

  // ---------- fuel economy ----------
  u('mpg-us', FUEL_DIST_PER_VOL, 425143.70745778215, ['mpg', 'miles per gallon'], { system: 'us' }),
  u('km-per-litre', FUEL_DIST_PER_VOL, 1e6, ['km/L', 'kilometres per litre', 'kilometers per liter'], { system: 'si' }),
  u('litres-per-100km', FUEL_VOL_PER_DIST, 1e-8, ['L/100km', 'l/100km', 'litres per 100 km', 'liters per 100 km'], { system: 'si', inverse: true }),
];

/** Units whose short form is dangerously ambiguous with scale words or plain words. */
export const AMBIGUOUS_SHORT = new Set(['m', 's', 'g', 'b', 'B', 'C', 'F', 'K', 'W', 'N', 'J', 'l', 'L', 'st', 'h', 'pc', 'ct', 'mb']);

const bySurface = new Map<string, UnitDef[]>();
for (const def of UNITS) {
  for (const f of def.forms) {
    const key = def.cs ? f : f.toLowerCase();
    const arr = bySurface.get(key) ?? [];
    arr.push(def);
    bySurface.set(key, arr);
  }
}

/** All surface forms, longest first — used to build the matcher regex. */
export const UNIT_FORMS: string[] = [...new Set(UNITS.flatMap((d) => d.forms))].sort(
  (a, b) => b.length - a.length,
);

export function lookupUnit(surface: string): UnitDef | undefined {
  const exact = bySurface.get(surface);
  if (exact && exact.length) {
    // prefer a case-sensitive definition that matches exactly
    const cs = exact.find((d) => d.cs && d.forms.includes(surface));
    if (cs) return cs;
    const ci = exact.find((d) => !d.cs);
    if (ci) return ci;
    return exact[0];
  }
  const lower = bySurface.get(surface.toLowerCase());
  if (lower && lower.length) {
    const ci = lower.find((d) => !d.cs);
    if (ci) return ci;
  }
  return undefined;
}

export function sameDimension(a: Dimension, b: Dimension): boolean {
  const keys = new Set<BaseDim>([...Object.keys(a), ...Object.keys(b)] as BaseDim[]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

/** Reciprocal dimensions, e.g. mpg vs L/100km. */
export function reciprocalDimension(a: Dimension, b: Dimension): boolean {
  const keys = new Set<BaseDim>([...Object.keys(a), ...Object.keys(b)] as BaseDim[]);
  for (const k of keys) if ((a[k] ?? 0) !== -(b[k] ?? 0)) return false;
  return true;
}

export function toBase(value: number, def: UnitDef): number {
  return value * def.factor + (def.offset ?? 0);
}

export function fromBase(base: number, def: UnitDef): number {
  return (base - (def.offset ?? 0)) / def.factor;
}

/** Convert between two units of the same dimension. Returns undefined if incommensurable. */
export function convert(value: number, from: UnitDef, to: UnitDef): number | undefined {
  if (sameDimension(from.dim, to.dim)) return fromBase(toBase(value, from), to);
  if (reciprocalDimension(from.dim, to.dim)) {
    const b = toBase(value, from);
    if (b === 0) return undefined;
    return fromBase(1 / b, to);
  }
  return undefined;
}

export function dimensionName(d: Dimension): string {
  const entries = Object.entries(d).filter(([, v]) => v !== 0);
  if (!entries.length) return 'dimensionless';
  const known: Array<[string, Dimension]> = [
    ['length', L()], ['mass', M()], ['time', T()], ['area', AREA], ['volume', VOLUME],
    ['speed', SPEED], ['energy', ENERGY], ['power', POWER], ['pressure', PRESSURE],
    ['force', FORCE], ['frequency', FREQ], ['temperature', { temperature: 1 }],
    ['data', { data: 1 }], ['angle', { angle: 1 }], ['acceleration', ACCEL],
    ['fuel economy', FUEL_DIST_PER_VOL], ['fuel consumption', FUEL_VOL_PER_DIST],
  ];
  for (const [name, dim] of known) if (sameDimension(d, dim)) return name;
  return entries.map(([k, v]) => (v === 1 ? k : `${k}^${v}`)).join('·');
}

export function unitLabel(ref: UnitRef | undefined): string {
  return ref ? ref.surface : '';
}
