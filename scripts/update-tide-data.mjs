#!/usr/bin/env node

import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  JMA_TIDE_PAGE_URL,
  STATION,
  jmaTextUrl,
  parseJmaTideText
} from '../js/tide-parser.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const execFileAsync = promisify(execFile);

function parseRequestedYears(argv) {
  const marker = argv.indexOf('--years');
  if (marker === -1) {
    const current = new Date().getUTCFullYear();
    return { years: [current, current + 1], explicit: false };
  }

  const years = argv
    .slice(marker + 1)
    .filter(value => !value.startsWith('--'))
    .map(value => Number.parseInt(value, 10));
  if (!years.length || years.some(year => !Number.isInteger(year))) {
    throw new Error('Usage: node scripts/update-tide-data.mjs [--years YYYY ...]');
  }
  return { years: [...new Set(years)].sort((a, b) => a - b), explicit: true };
}

async function downloadText(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'tide-graph-data-updater/1.0' }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.text();
  } catch (fetchError) {
    try {
      const { stdout } = await execFileAsync(
        'curl',
        ['--fail', '--silent', '--show-error', '--location', url],
        { maxBuffer: 1024 * 1024, encoding: 'utf8' }
      );
      return stdout;
    } catch (curlError) {
      throw new Error(
        `Unable to download ${url}: fetch failed (${fetchError.message}); curl failed (${curlError.message})`
      );
    }
  }
}

async function downloadYear(year) {
  const url = jmaTextUrl(year);
  const text = await downloadText(url);

  const days = parseJmaTideText(text, year);
  return {
    schemaVersion: 1,
    year,
    station: STATION,
    source: {
      organization: '気象庁',
      title: '潮位表 日立',
      pageUrl: JMA_TIDE_PAGE_URL,
      dataUrl: url
    },
    days
  };
}

async function readExistingManifest() {
  try {
    const manifest = JSON.parse(await readFile(path.join(dataDir, 'manifest.json'), 'utf8'));
    return Array.isArray(manifest.years) ? manifest.years.filter(Number.isInteger) : [];
  } catch {
    return [];
  }
}

async function pruneSupersededData(keepYears) {
  const keep = new Set(keepYears);
  const files = await readdir(dataDir);
  for (const file of files) {
    const match = /^tides-(\d{4})\.json$/.exec(file);
    if (match && !keep.has(Number.parseInt(match[1], 10))) {
      await unlink(path.join(dataDir, file));
      console.log(`Removed superseded data/${file}`);
    }
  }
}

async function main() {
  const { years, explicit } = parseRequestedYears(process.argv.slice(2));
  await mkdir(dataDir, { recursive: true });

  const completed = [];
  for (const year of years) {
    try {
      const payload = await downloadYear(year);
      const output = path.join(dataDir, `tides-${year}.json`);
      await writeFile(output, `${JSON.stringify(payload)}\n`, 'utf8');
      completed.push(year);
      console.log(`Updated ${path.relative(root, output)} (${payload.days.length} days)`);
    } catch (error) {
      const isOptionalFuture = !explicit && year > new Date().getUTCFullYear();
      if (!isOptionalFuture) throw error;
      console.warn(`Future data for ${year} is not available yet: ${error.message}`);
    }
  }

  if (!completed.length) throw new Error('No tide data could be updated');

  let manifestYears = completed;
  if (!explicit) {
    const currentYear = new Date().getUTCFullYear();
    const retained = (await readExistingManifest())
      .filter(year => year >= currentYear - 1 && year <= currentYear + 1);
    manifestYears = [...new Set([...retained, ...completed])].sort((a, b) => a - b);
    await pruneSupersededData(manifestYears);
  }

  const manifest = {
    schemaVersion: 1,
    station: STATION.code,
    years: manifestYears
  };
  await writeFile(
    path.join(dataDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
}

await main();
