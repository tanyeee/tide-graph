import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  jmaTextUrl,
  parseJmaTideText,
  validateTideRecords
} from '../js/tide-parser.js';

const january1 =
  ' 75 94107113114111106103103108115123129130123109 87 60 34 12 -1 -2  8 2726 1 1D1 338115123813099999999999999 7281032037 -399999999999999';

test('builds the official annual text URL', () => {
  assert.equal(
    jmaTextUrl(2027),
    'https://www.data.jma.go.jp/kaiyou/data/db/tide/suisan/txt/2027/D1.txt'
  );
});

test('parses fixed-width hourly and extrema fields', () => {
  const lines = [january1];
  for (let day = 2; day <= 365; day += 1) {
    const date = new Date(Date.UTC(2026, 0, day));
    const yy = String(date.getUTCFullYear() % 100).padStart(2, ' ');
    const mm = String(date.getUTCMonth() + 1).padStart(2, ' ');
    const dd = String(date.getUTCDate()).padStart(2, ' ');
    lines.push(`${'  0'.repeat(24)}${yy}${mm}${dd}D1${'9999999'.repeat(8)}`);
  }

  const records = parseJmaTideText(lines.join('\n'), 2026);
  assert.deepEqual(records[0], {
    date: '2026-01-01',
    hours: [75, 94, 107, 113, 114, 111, 106, 103, 103, 108, 115, 123, 129, 130, 123, 109, 87, 60, 34, 12, -1, -2, 8, 27],
    highs: [
      { time: '03:38', height: 115 },
      { time: '12:38', height: 130 }
    ],
    lows: [
      { time: '07:28', height: 103 },
      { time: '20:37', height: -3 }
    ]
  });
});

test('rejects malformed fixed-width records', () => {
  assert.throws(() => parseJmaTideText('too short', 2026), /136 characters/);
});

test('validates generated cached datasets without network access', async () => {
  const manifest = JSON.parse(await readFile(new URL('../data/manifest.json', import.meta.url), 'utf8'));
  for (const year of manifest.years) {
    const file = new URL(`../data/tides-${year}.json`, import.meta.url);
    const payload = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(payload.year, year);
    assert.equal(payload.station.code, 'D1');
    const expectedDays = new Date(Date.UTC(year + 1, 0, 1)) - new Date(Date.UTC(year, 0, 1));
    assert.equal(validateTideRecords(payload.days, year).length, expectedDays / 86400000);
  }
});

test('rejects malformed extrema in cached data', async () => {
  const payload = JSON.parse(await readFile(new URL('../data/tides-2026.json', import.meta.url), 'utf8'));
  payload.days[0].highs[0].time = '25:00';
  assert.throws(() => validateTideRecords(payload.days, 2026), /Invalid highs entry/);
});

test('rejects missing-value sentinels in hourly data', () => {
  const line = `999${january1.slice(3)}`;
  assert.throws(() => parseJmaTideText(line, 2026), /Invalid hourly height/);
});

test('rejects year and station mismatches', () => {
  const wrongYear = `${january1.slice(0, 72)}25${january1.slice(74)}`;
  const wrongStation = `${january1.slice(0, 78)}TK${january1.slice(80)}`;
  assert.throws(() => parseJmaTideText(wrongYear, 2026), /Expected year 2026/);
  assert.throws(() => parseJmaTideText(wrongStation, 2026), /Expected station D1/);
});

test('requires a complete leap year and contiguous dates', async () => {
  const payload = JSON.parse(await readFile(new URL('../data/tides-2026.json', import.meta.url), 'utf8'));
  const leapRecords = [];
  const start = new Date(Date.UTC(2028, 0, 1));
  for (let index = 0; index < 366; index += 1) {
    leapRecords.push({
      ...structuredClone(payload.days[0]),
      date: new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10)
    });
  }
  assert.equal(validateTideRecords(leapRecords, 2028).length, 366);
  leapRecords[100].date = '2028-12-31';
  assert.throws(() => validateTideRecords(leapRecords, 2028), /Expected 2028-04-10/);
  assert.throws(() => validateTideRecords(leapRecords.slice(0, 365), 2028), /Expected 366 days/);
});
