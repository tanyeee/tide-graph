import assert from 'node:assert/strict';
import test from 'node:test';
import { getScientificTideName, tideNameForElongation } from '../js/tide-names.js';

test('maps MIRC scientific tide-name elongation ranges', () => {
  assert.equal(tideNameForElongation(0), '大潮');
  assert.equal(tideNameForElongation(31), '中潮');
  assert.equal(tideNameForElongation(67), '小潮');
  assert.equal(tideNameForElongation(103), '長潮');
  assert.equal(tideNameForElongation(115), '若潮');
  assert.equal(tideNameForElongation(163), '大潮');
  assert.equal(tideNameForElongation(343), '大潮');
});

test('uses JST midnight for the scientific tide name', () => {
  assert.equal(getScientificTideName('2026-07-13'), '中潮');
  assert.equal(getScientificTideName('2026-07-14'), '大潮');
});
