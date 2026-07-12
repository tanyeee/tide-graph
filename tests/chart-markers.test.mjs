import assert from 'node:assert/strict';
import test from 'node:test';
import {
  interpolateHeightAtMinute,
  shouldScheduleMarkerRefresh
} from '../js/chart-markers.js';

test('interpolates the current astronomical tide between 10-minute points', () => {
  const series = [{ height: 100 }, { height: 120 }, { height: 80 }];
  assert.equal(interpolateHeightAtMinute(series, 5), 110);
  assert.equal(interpolateHeightAtMinute(series, 15), 100);
  assert.equal(interpolateHeightAtMinute(series, 20), 80);
});

test('keeps interpolation inside the available series', () => {
  const series = [{ height: 100 }, { height: 120 }];
  assert.equal(interpolateHeightAtMinute(series, -5), 100);
  assert.equal(interpolateHeightAtMinute(series, 60), 120);
  assert.equal(interpolateHeightAtMinute([], 0), null);
});

test('keeps minute refresh independent from pulse animation preferences', () => {
  assert.equal(shouldScheduleMarkerRefresh(true, false), true);
  assert.equal(shouldScheduleMarkerRefresh(true, true), false);
  assert.equal(shouldScheduleMarkerRefresh(false, false), false);
});
