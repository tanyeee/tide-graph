import assert from 'node:assert/strict';
import test from 'node:test';
import {
  axisTicks,
  calculateRiverAxis,
  normalizeRiverPayload,
  percentile,
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
