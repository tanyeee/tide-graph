export const RIVER_STATIONS = Object.freeze({
  'kuji-ohashi': Object.freeze({
    id: 'kuji-ohashi',
    name: '久慈大橋',
    riverId: 'kuji',
    riverName: '久慈川水系',
    url: 'https://tanyeee.github.io/kuji-waterlevel/data/stations/kuji-ohashi/recent_10min.json'
  }),
  sakakibashi: Object.freeze({
    id: 'sakakibashi',
    name: '榊橋',
    riverId: 'kuji',
    riverName: '久慈川水系',
    url: 'https://tanyeee.github.io/kuji-waterlevel/data/stations/sakakibashi/recent_10min.json'
  }),
  // The following four stations belong to the 涸沼・那珂川水系 group as
  // classified by kuji-waterlevel's config/stations.json (river id
  // "hinuma-nakagawa"), which groups them together rather than splitting
  // 涸沼川 and 那珂川 into separate groups.
  'hinuma-bashi': Object.freeze({
    id: 'hinuma-bashi',
    name: '涸沼橋',
    riverId: 'hinuma-nakagawa',
    riverName: '涸沼・那珂川水系',
    url: 'https://tanyeee.github.io/kuji-waterlevel/data/stations/hinuma-bashi/recent_10min.json'
  }),
  'minato-ohashi': Object.freeze({
    id: 'minato-ohashi',
    name: '湊大橋',
    riverId: 'hinuma-nakagawa',
    riverName: '涸沼・那珂川水系',
    url: 'https://tanyeee.github.io/kuji-waterlevel/data/stations/minato-ohashi/recent_10min.json'
  }),
  'suifu-bashi': Object.freeze({
    id: 'suifu-bashi',
    name: '水府橋',
    riverId: 'hinuma-nakagawa',
    riverName: '涸沼・那珂川水系',
    url: 'https://tanyeee.github.io/kuji-waterlevel/data/stations/suifu-bashi/recent_10min.json'
  }),
  'kunita-ohashi': Object.freeze({
    id: 'kunita-ohashi',
    name: '国田大橋',
    riverId: 'hinuma-nakagawa',
    riverName: '涸沼・那珂川水系',
    url: 'https://tanyeee.github.io/kuji-waterlevel/data/stations/kunita-ohashi/recent_10min.json'
  })
});

const INVALID_FLAGS = new Set(['-', '$', '#']);
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function normalizeRiverPayload(payload) {
  if (!payload || !Array.isArray(payload.records)) {
    throw new TypeError('河川水位データの形式が正しくありません。');
  }

  const records = payload.records
    .filter(record =>
      record &&
      TIMESTAMP_PATTERN.test(record.timestamp) &&
      Number.isFinite(record.value) &&
      !INVALID_FLAGS.has(record.flag)
    )
    .map(record => ({
      timestamp: record.timestamp,
      value: record.value,
      flag: record.flag || '',
      resolution: record.resolution || '10min'
    }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return { meta: payload.meta || {}, records };
}

function timestampParts(value) {
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) throw new RangeError(`Invalid JST timestamp: ${value}`);
  return match.slice(1).map(Number);
}

function dateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`Invalid date: ${value}`);
  return match.slice(1).map(Number);
}

export function timestampToWindowMinute(timestamp, startDate) {
  const [year, month, day, hour, minute] = timestampParts(timestamp);
  const [startYear, startMonth, startDay] = dateParts(startDate);
  // Both values are JST calendar components. Date.UTC is used only for stable
  // calendar arithmetic so the viewer's local timezone cannot shift the graph.
  const observed = Date.UTC(year, month - 1, day, hour, minute);
  const start = Date.UTC(startYear, startMonth - 1, startDay);
  return (observed - start) / 60000;
}

export function riverSeriesForWindow(records, startDate, days) {
  const windowMinutes = days * 24 * 60;
  return records
    .map(record => ({
      minute: timestampToWindowMinute(record.timestamp, startDate),
      label: record.timestamp.replace('T', ' '),
      level: record.value
    }))
    .filter(record => record.minute >= 0 && record.minute < windowMinutes);
}

// Linearly interpolates a value at `minute` from a series that is a
// complete, gapless grid spaced `stepMinutes` apart starting at minute 0
// (e.g. the tide series produced for a display window, which always has a
// point at every 10-minute mark with no missing entries). This index-based
// interpolation is only safe for a series with that guarantee — it is NOT a
// substitute for timestamp-based mapping of possibly-irregular/sparse data
// (that's what riverSeriesForWindow/timestampToWindowMinute are for).
function interpolateAtMinute(series, minute, stepMinutes) {
  if (!Array.isArray(series) || !series.length || !Number.isFinite(minute)) return null;
  const position = minute / stepMinutes;
  const lowerIndex = Math.max(0, Math.min(series.length - 1, Math.floor(position)));
  const upperIndex = Math.max(0, Math.min(series.length - 1, Math.ceil(position)));
  const lower = series[lowerIndex];
  const upper = series[upperIndex];
  if (!Number.isFinite(lower?.height) || !Number.isFinite(upper?.height)) return null;
  if (lowerIndex === upperIndex) return lower.height;
  const fraction = position - lowerIndex;
  return lower.height + (upper.height - lower.height) * fraction;
}

// Pairs each river reading with the tide height at that exact minute so the
// two distributions being percentile-fitted (see calculateRiverAxis) share
// the same time basis. Pairing used to be an exact Map lookup keyed by
// minute, which silently dropped any river point whose own timestamp didn't
// land precisely on the tide series' step marks (e.g. a feed reporting on
// :05/:15/:25 instead of :00/:10/:20, or any other grid offset) — in the
// worst case that could zero out the entire paired sample and disable the
// river axis outright. Interpolating into the tide series (a complete,
// gapless grid — see interpolateAtMinute) always succeeds for any minute
// inside the displayed window, regardless of how the river feed's own
// timestamps happen to be aligned, or how much of the window it currently
// covers.
export function pairRiverWithTide(riverSeries, tideSeries, stepMinutes = 10) {
  const pairedTides = [];
  const pairedLevels = [];
  for (const point of riverSeries) {
    const tideHeight = interpolateAtMinute(tideSeries, point.minute, stepMinutes);
    if (Number.isFinite(tideHeight)) {
      pairedTides.push(tideHeight);
      pairedLevels.push(point.level);
    }
  }
  return { pairedTides, pairedLevels };
}

// Pairs raw river records (not windowed to a display range — typically the
// full fetched recent_10min.json record set) with a tide height looked up
// by each record's own real timestamp, via a caller-supplied getTideHeight
// function. This is what makes river axis calibration independent of which
// day(s)/day-count the viewer currently has selected: the percentile sample
// fed to calculateRiverAxis is always drawn from the same underlying
// dataset, not just whatever slice happens to be on screen. getTideHeight is
// injected (rather than this module reading a global tide data map itself)
// so this stays a pure, easily-testable function; the caller is responsible
// for returning null/undefined for timestamps it has no tide data for
// (e.g. a date outside the currently loaded tide-data year range), which
// this function simply skips rather than treating as an error.
export function pairRecordsWithTideLookup(records, getTideHeight) {
  const pairedTides = [];
  const pairedLevels = [];
  for (const record of records) {
    const height = getTideHeight(record.timestamp);
    if (Number.isFinite(height)) {
      pairedTides.push(height);
      pairedLevels.push(record.value);
    }
  }
  return { pairedTides, pairedLevels };
}

export function percentile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

// Mirrors index.html's getTideYAxisRange() bucketing formula exactly (same
// rounding), but applied to an arbitrary tide value array instead of the
// currently displayed window's currentSeries. Used to compute the
// calibrateRiverAxis() extrapolation target from the FULL calibration
// sample (see pairRecordsWithTideLookup) so the river axis calibration is
// independent of which day(s)/day-count is on screen — using the window's
// own getTideYAxisRange() output here as well as the sample would still let
// the final calibrated {min,max} vary by view (e.g. a 2-day window spanning
// a day with an unusually low tide changes the extrapolation target even
// with an otherwise-identical percentile sample). This does not affect the
// tide curve's own rendered axis, which still uses getTideYAxisRange() as
// before — only calculateRiverAxis()'s 3rd argument uses this instead.
export function tideAxisRangeForValues(values) {
  if (!values.length) return null;
  const minHeight = Math.min(...values);
  const maxHeight = Math.max(...values);
  const min = minHeight < 0 ? Math.floor(minHeight / 20) * 20 : 0;
  const max = Math.max(120, Math.ceil(maxHeight / 40) * 40);
  return { min, max };
}

export function calculateRiverAxis(tideValues, riverValues, tideAxis) {
  if (!tideValues.length || !riverValues.length) return null;
  const tideLow = percentile(tideValues, 0.05);
  const tideHigh = percentile(tideValues, 0.95);
  let riverLow = percentile(riverValues, 0.05);
  let riverHigh = percentile(riverValues, 0.95);

  if (riverHigh - riverLow < 0.02) {
    const center = (riverHigh + riverLow) / 2;
    riverLow = center - 0.1;
    riverHigh = center + 0.1;
  }
  if (tideHigh - tideLow < 1) return null;

  const riverPerTideUnit = (riverHigh - riverLow) / (tideHigh - tideLow);
  let min = riverLow - (tideLow - tideAxis.min) * riverPerTideUnit;
  let max = riverHigh + (tideAxis.max - tideHigh) * riverPerTideUnit;

  const minimumSpan = 0.2;
  if (max - min < minimumSpan) {
    const center = (max + min) / 2;
    min = center - minimumSpan / 2;
    max = center + minimumSpan / 2;
  }

  return { min, max };
}

export function axisTicks(min, max, targetCount = 5) {
  const span = max - min;
  if (!(span > 0)) return [];
  const roughStep = span / Math.max(1, targetCount - 1);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = nice * magnitude;
  const first = Math.ceil(min / step) * step;
  const ticks = [];
  for (let value = first; value <= max + step * 1e-6; value += step) {
    ticks.push(Math.round(value * 1000) / 1000);
  }
  return ticks;
}
