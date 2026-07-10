export const RIVER_STATIONS = Object.freeze({
  'kuji-ohashi': Object.freeze({
    id: 'kuji-ohashi',
    name: '久慈大橋',
    url: 'https://tanyeee.github.io/kuji-waterlevel/data/stations/kuji-ohashi/recent_10min.json'
  }),
  sakakibashi: Object.freeze({
    id: 'sakakibashi',
    name: '榊橋',
    url: 'https://tanyeee.github.io/kuji-waterlevel/data/stations/sakakibashi/recent_10min.json'
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

export function percentile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
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
