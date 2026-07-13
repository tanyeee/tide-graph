import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RIVER_STATIONS,
  axisTicks,
  calculateRiverAxis,
  extendFixedRiverRange,
  normalizeRiverPayload,
  pairRiverWithTide,
  percentile,
  riverLevelToDisplayHeight,
  riverSeriesForWindow,
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

test('converts a river reading to the apparent chart height, not its raw elevation', () => {
  const displayed = riverLevelToDisplayHeight(3, { min: 1, max: 5 }, { min: 0, max: 100 });
  assert.equal(displayed, 50);
  assert.equal(riverLevelToDisplayHeight(3, null, { min: 0, max: 100 }), null);
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

// Coverage for 実水位 (actual level) display mode: a fixed, per-station m
// axis, extended only on the side normal operating conditions exceed it.

test('every RIVER_STATIONS entry has a fixed 実水位 range with min < max', () => {
  for (const [id, station] of Object.entries(RIVER_STATIONS)) {
    assert.ok(station.fixedRange, `${id} is missing fixedRange`);
    assert.ok(station.fixedRange.min < station.fixedRange.max, `${id} fixedRange min/max out of order`);
  }
});

test('extendFixedRiverRange keeps the fixed range unchanged when readings stay within it', () => {
  const fixedRange = { min: 0.3, max: 2.0 };
  assert.deepEqual(extendFixedRiverRange(fixedRange, [0.5, 1.2, 1.9]), { min: 0.3, max: 2.0 });
  // No data at all: still just the fixed range, unchanged.
  assert.deepEqual(extendFixedRiverRange(fixedRange, []), { min: 0.3, max: 2.0 });
  assert.equal(extendFixedRiverRange(null, [0.5]), null);
});

test('extendFixedRiverRange extends only the side actually exceeded, rounded outward to the nearest 0.5m', () => {
  const fixedRange = { min: 0.3, max: 2.0 };

  // Exceeds only the top: min stays fixed, max rounds up to the next 0.5m.
  const highWater = extendFixedRiverRange(fixedRange, [0.8, 1.5, 2.15]);
  assert.deepEqual(highWater, { min: 0.3, max: 2.5 });

  // Exceeds only the bottom: max stays fixed, min rounds down to the next 0.5m.
  const lowWater = extendFixedRiverRange(fixedRange, [0.05, 1.0, 1.8]);
  assert.deepEqual(lowWater, { min: 0, max: 2.0 });

  // Exceeds both sides at once, each independently rounded outward.
  const bothSides = extendFixedRiverRange(fixedRange, [-0.4, 2.6]);
  assert.deepEqual(bothSides, { min: -0.5, max: 3.0 });

  // A custom step is honored (e.g. a coarser 1m extension granularity).
  const coarseStep = extendFixedRiverRange(fixedRange, [2.2], 1);
  assert.deepEqual(coarseStep, { min: 0.3, max: 3 });
});
