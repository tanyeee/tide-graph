import assert from 'node:assert/strict';
import test from 'node:test';
import {
  axisTicks,
  calculateRiverAxis,
  normalizeRiverPayload,
  pairRecordsWithTideLookup,
  pairRiverWithTide,
  percentile,
  riverSeriesForWindow,
  tideAxisRangeForValues,
  timestampToWindowMinute
} from '../js/river-water-level.js';

test('keeps JST calendar timestamps independent from the viewer timezone', () => {
  assert.equal(timestampToWindowMinute('2026-07-10T00:00', '2026-07-10'), 0);
  assert.equal(timestampToWindowMinute('2026-07-11T00:10', '2026-07-10'), 1450);
});

test('filters invalid observations and keeps valid provisional values', () => {
  const payload = normalizeRiverPayload({ records: [
    { timestamp: '2026-07-10T00:00', value: 1.2, flag: '' },
    { timestamp: '2026-07-10T00:10', value: 1.3, flag: '*' },
    { timestamp: '2026-07-10T00:20', value: 1.4, flag: '$' },
    { timestamp: 'bad', value: 1.5, flag: '' }
  ] });
  assert.deepEqual(payload.records.map(record => record.value), [1.2, 1.3]);
});

test('selects records inside a one or two day half-open window', () => {
  const records = [
    { timestamp: '2026-07-09T23:50', value: 1 },
    { timestamp: '2026-07-10T00:00', value: 2 },
    { timestamp: '2026-07-11T23:50', value: 3 },
    { timestamp: '2026-07-12T00:00', value: 4 }
  ];
  assert.deepEqual(riverSeriesForWindow(records, '2026-07-10', 2).map(item => item.level), [2, 3]);
});

test('calculates interpolated percentiles', () => {
  assert.equal(percentile([0, 10, 20], 0.25), 5);
});

test('fits river percentiles onto the tide axis without shifting time', () => {
  const axis = calculateRiverAxis([0, 25, 50, 75, 100], [1, 2, 3, 4, 5], { min: 0, max: 100 });
  assert.ok(axis);
  const mapY = value => (axis.max - value) / (axis.max - axis.min);
  assert.ok(Math.abs(mapY(3) - 0.5) < 1e-9);
});

test('supports negative river levels and stable constant series', () => {
  const negative = calculateRiverAxis([0, 50, 100], [-0.4, -0.1, 0.3], { min: 0, max: 120 });
  assert.ok(negative.min < negative.max);
  assert.ok(negative.min < 0);
  const constant = calculateRiverAxis([0, 50, 100], [1, 1, 1], { min: 0, max: 120 });
  assert.ok(constant.max - constant.min >= 0.2);
  assert.ok(axisTicks(constant.min, constant.max).length > 0);
});

test('keeps robust percentile fitting when one extreme outlier is present', () => {
  const tideValues = Array.from({ length: 101 }, (_, index) => index);
  const riverValues = [...Array.from({ length: 100 }, (_, index) => index / 10), 1000];
  const axis = calculateRiverAxis(tideValues, riverValues, { min: 0, max: 100 });
  assert.ok(axis.max < 1000);

  const tideLow = percentile(tideValues, 0.05);
  const riverLow = percentile(riverValues, 0.05);
  const tidePosition = (100 - tideLow) / 100;
  const riverPosition = (axis.max - riverLow) / (axis.max - axis.min);
  assert.ok(Math.abs(tidePosition - riverPosition) < 1e-9);
});

// Regression coverage for a reported "river line drifts in time" symptom
// (correct in a yesterday~today 2-day view, wrong in a today-only 1-day
// view, self-correcting later in the day). The suspected mechanism was
// riverSeriesForWindow mapping records by array index/position instead of
// their own timestamp, which would shift the whole series whenever the feed
// doesn't start at the display window's own minute 0 (data arriving mid-day)
// or is truncated before "now" (delivery delay). These tests exercise
// exactly those two shapes directly against real feed characteristics.
test('maps a record starting well after the display day\'s midnight to its own timestamp, not array index 0', () => {
  // If mapping were index-based (record[0] assumed to be minute 0, each
  // subsequent record +10min), this data — which only starts at 09:00 —
  // would be placed at minutes [0, 10, 20] instead of [540, 550, 560].
  const records = [
    { timestamp: '2026-07-10T09:00', value: 1.0 },
    { timestamp: '2026-07-10T09:10', value: 1.1 },
    { timestamp: '2026-07-10T09:20', value: 1.2 }
  ];
  const series = riverSeriesForWindow(records, '2026-07-10', 1);
  assert.deepEqual(series.map(item => item.minute), [540, 550, 560]);
});

test('keeps correct minute mapping when the feed is truncated before "now" (delivery delay)', () => {
  // A gap before the last record (simulating a delayed/incomplete feed that
  // stops short of the current moment) must not compress or shift later
  // records to sit right after the earlier ones; each keeps its own
  // timestamp-derived minute.
  const records = [
    { timestamp: '2026-07-10T00:00', value: 2.0 },
    { timestamp: '2026-07-10T00:10', value: 2.1 },
    { timestamp: '2026-07-10T05:00', value: 2.2 }
  ];
  const series = riverSeriesForWindow(records, '2026-07-10', 1);
  assert.deepEqual(series.map(item => item.minute), [0, 10, 300]);
});

test('maps the same real timestamp to the same clock-of-day position in both a 1-day and a 2-day (yesterday~today) view', () => {
  const records = [
    { timestamp: '2026-07-12T08:00', value: 1.0 },
    { timestamp: '2026-07-13T08:00', value: 1.5 }
  ];
  const oneDayToday = riverSeriesForWindow(records, '2026-07-13', 1);
  const twoDayYesterdayToday = riverSeriesForWindow(records, '2026-07-12', 2);

  const inOneDay = oneDayToday.find(item => item.label === '2026-07-13 08:00');
  const inTwoDay = twoDayYesterdayToday.find(item => item.label === '2026-07-13 08:00');
  assert.equal(inOneDay.minute, 480);
  assert.equal(inTwoDay.minute, 1920);
  assert.equal(inOneDay.minute % 1440, inTwoDay.minute % 1440);
});

test('pairRiverWithTide interpolates the tide height even when a river reading does not land on the tide grid\'s exact minute', () => {
  // A regularly-spaced (10-min step), gapless tide series, as buildSeries()
  // in index.html always produces for the displayed window.
  const tideSeries = Array.from({ length: 7 }, (_, i) => ({ minute: i * 10, height: 100 + i * 10 }));

  // River readings exactly on the grid still pair to the exact tide value.
  const onGrid = pairRiverWithTide([{ minute: 20, level: 1.0 }], tideSeries);
  assert.deepEqual(onGrid, { pairedTides: [120], pairedLevels: [1.0] });

  // A river reading off the grid (e.g. a feed reporting on :05 instead of
  // :00/:10/...) used to be silently dropped by an exact Map lookup; it now
  // gets a linearly interpolated tide height instead of being discarded.
  const offGrid = pairRiverWithTide([{ minute: 25, level: 2.0 }], tideSeries);
  assert.equal(offGrid.pairedLevels.length, 1);
  assert.equal(offGrid.pairedTides[0], 125); // halfway between minute 20 (120) and 30 (130)

  // A minute outside the tide series' own range clamps to the series'
  // nearest boundary value rather than extrapolating or being dropped. In
  // practice this never triggers: currentRiverSeries is already filtered by
  // riverSeriesForWindow to the same [0, windowMinutes) window that the tide
  // series spans, so a river point's minute is always in range.
  const outOfRange = pairRiverWithTide([{ minute: 999, level: 3.0 }], tideSeries);
  assert.deepEqual(outOfRange, { pairedTides: [160], pairedLevels: [3.0] });
});

// Regression coverage for "河川水位と潮位の位相関係が表示モードで違って見える":
// calibrating calculateRiverAxis against only the currently displayed
// window's records (a smaller/differently-shaped sample for e.g. a 1-day
// "today" view vs a fully-populated "yesterday" day in a 2-day view) could
// produce a visibly different river axis for the exact same underlying
// river/tide relationship. pairRecordsWithTideLookup + tideAxisRangeForValues
// let the caller calibrate from the full fetched record set instead, so the
// result no longer depends on which window is on screen.

test('pairRecordsWithTideLookup pairs each record with its own real-timestamp tide height, skipping records the lookup has no data for', () => {
  const records = [
    { timestamp: '2026-07-12T08:00', value: 1.0 },
    { timestamp: '2026-07-13T08:00', value: 1.5 },
    { timestamp: '2099-01-01T00:00', value: 9.9 } // no tide data available for this date
  ];
  const tideByTimestamp = { '2026-07-12T08:00': 50, '2026-07-13T08:00': 55 };
  const getTideHeight = (timestamp) => tideByTimestamp[timestamp] ?? null;

  const { pairedTides, pairedLevels } = pairRecordsWithTideLookup(records, getTideHeight);
  assert.deepEqual(pairedTides, [50, 55]);
  assert.deepEqual(pairedLevels, [1.0, 1.5]);
});

test('tideAxisRangeForValues mirrors the same min/max bucketing as the displayed tide axis', () => {
  assert.deepEqual(tideAxisRangeForValues([10, 50, 133]), { min: 0, max: 160 });
  assert.deepEqual(tideAxisRangeForValues([-5, 0, 143]), { min: -20, max: 160 });
  assert.equal(tideAxisRangeForValues([]), null);
});

test('calibrating against the full record set eliminates the view-window-dependent axis drift the previous window-based approach had', () => {
  // Mimics real JMA tide data for three consecutive days, where the third
  // day (2026-07-14) dips to a negative low tide that the other two days
  // don't reach — so a window that happens to include it has a different
  // getTideYAxisRange()-style min than a window that doesn't (this is the
  // exact situation found with real data: 2026-07-13 alone or paired with
  // 2026-07-12 both bucket to {min:0,max:160}, but pairing it with
  // 2026-07-14 buckets to {min:-20,max:160} instead).
  const tideByTimestamp = {
    '2026-07-12T08:00': 10, '2026-07-12T20:00': 120,
    '2026-07-13T09:00': 0, '2026-07-13T17:00': 138,
    '2026-07-14T10:00': -5, '2026-07-14T18:00': 143
  };
  const riverByTimestamp = {
    '2026-07-12T08:00': 0.5, '2026-07-12T20:00': 1.8,
    '2026-07-13T09:00': 0.4, '2026-07-13T17:00': 1.9,
    '2026-07-14T10:00': 0.3, '2026-07-14T18:00': 2.0
  };
  const allTimestamps = Object.keys(tideByTimestamp);
  const fullRiverRecords = allTimestamps.map(timestamp => ({ timestamp, value: riverByTimestamp[timestamp] }));
  const getTideHeight = (timestamp) => tideByTimestamp[timestamp] ?? null;

  // Three "view windows" (1-day today, 2-day today~tomorrow, 2-day
  // yesterday~today), each with only the records that would have been
  // inside that window plus that window's own getTideYAxisRange()-style
  // bucketed bounds — this is exactly what the old, window-based
  // calibration fed calculateRiverAxis.
  const windows = {
    today1Day: {
      timestamps: allTimestamps.filter(t => t.startsWith('2026-07-13')),
      tideAxis: { min: 0, max: 160 }
    },
    todayTomorrow2Day: {
      timestamps: allTimestamps.filter(t => t.startsWith('2026-07-13') || t.startsWith('2026-07-14')),
      tideAxis: { min: -20, max: 160 }
    },
    yesterdayToday2Day: {
      timestamps: allTimestamps.filter(t => t.startsWith('2026-07-12') || t.startsWith('2026-07-13')),
      tideAxis: { min: 0, max: 160 }
    }
  };

  const oldAxes = Object.fromEntries(Object.entries(windows).map(([name, w]) => {
    const tideValues = w.timestamps.map(t => tideByTimestamp[t]);
    const riverValues = w.timestamps.map(t => riverByTimestamp[t]);
    return [name, calculateRiverAxis(tideValues, riverValues, w.tideAxis)];
  }));
  // Confirms the bug this fix addresses: the old, window-based approach
  // really did produce a different calibration depending on which window
  // was displayed (todayTomorrow2Day's min in particular).
  assert.notDeepEqual(oldAxes.todayTomorrow2Day, oldAxes.today1Day);

  // New approach: calibrate from the full record set and its own
  // window-independent tide axis, regardless of which window is displayed.
  const { pairedTides, pairedLevels } = pairRecordsWithTideLookup(fullRiverRecords, getTideHeight);
  const calibrationTideAxis = tideAxisRangeForValues(pairedTides);
  const newAxes = Object.fromEntries(Object.keys(windows).map(name =>
    [name, calculateRiverAxis(pairedTides, pairedLevels, calibrationTideAxis)]
  ));

  assert.deepEqual(newAxes.today1Day, newAxes.todayTomorrow2Day);
  assert.deepEqual(newAxes.todayTomorrow2Day, newAxes.yesterdayToday2Day);
});
