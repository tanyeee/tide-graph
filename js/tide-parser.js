export const STATION = Object.freeze({
  code: 'D1',
  name: '日立',
  latitude: '36°30′N',
  longitude: '140°38′E'
});

export const JMA_TIDE_PAGE_URL =
  'https://www.data.jma.go.jp/kaiyou/db/tide/suisan/suisan.php?stn=D1';

export function jmaTextUrl(year) {
  assertYear(year);
  return `https://www.data.jma.go.jp/kaiyou/data/db/tide/suisan/txt/${year}/${STATION.code}.txt`;
}

function assertYear(year) {
  if (!Number.isInteger(year) || year < 2000 || year > 2099) {
    throw new RangeError(`Unsupported year: ${year}`);
  }
}

function parseNumber(field, label, lineNumber) {
  const value = Number.parseInt(field, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${label} on line ${lineNumber}: ${JSON.stringify(field)}`);
  }
  return value;
}

function parseExtrema(field, lineNumber) {
  const result = [];
  for (let offset = 0; offset < 28; offset += 7) {
    const hour = parseNumber(field.slice(offset, offset + 2), 'extrema hour', lineNumber);
    const minute = parseNumber(field.slice(offset + 2, offset + 4), 'extrema minute', lineNumber);
    const height = parseNumber(field.slice(offset + 4, offset + 7), 'extrema height', lineNumber);

    if (hour === 99 && minute === 99 && height === 999) continue;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      throw new Error(`Invalid extrema time on line ${lineNumber}: ${hour}:${minute}`);
    }

    result.push({
      time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      height
    });
  }
  return result;
}

function parseLine(line, lineNumber, expectedYear) {
  if (line.length !== 136) {
    throw new Error(`Expected 136 characters on line ${lineNumber}, received ${line.length}`);
  }

  const hours = [];
  for (let offset = 0; offset < 72; offset += 3) {
    const height = parseNumber(line.slice(offset, offset + 3), 'hourly height', lineNumber);
    if (height < -500 || height > 500) {
      throw new Error(`Invalid hourly height on line ${lineNumber}: ${height}`);
    }
    hours.push(height);
  }

  const shortYear = parseNumber(line.slice(72, 74), 'year', lineNumber);
  const month = parseNumber(line.slice(74, 76), 'month', lineNumber);
  const day = parseNumber(line.slice(76, 78), 'day', lineNumber);
  const station = line.slice(78, 80);
  const year = 2000 + shortYear;

  if (year !== expectedYear) {
    throw new Error(`Expected year ${expectedYear} on line ${lineNumber}, received ${year}`);
  }
  if (station !== STATION.code) {
    throw new Error(`Expected station ${STATION.code} on line ${lineNumber}, received ${station}`);
  }

  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() + 1 !== month ||
    parsedDate.getUTCDate() !== day
  ) {
    throw new Error(`Invalid date on line ${lineNumber}: ${date}`);
  }

  return {
    date,
    hours,
    highs: parseExtrema(line.slice(80, 108), lineNumber),
    lows: parseExtrema(line.slice(108, 136), lineNumber)
  };
}

function expectedDayCount(year) {
  return new Date(Date.UTC(year + 1, 0, 1)).getTime() -
    new Date(Date.UTC(year, 0, 1)).getTime() === 366 * 86400000
    ? 366
    : 365;
}

export function validateTideRecords(records, year) {
  assertYear(year);
  if (!Array.isArray(records)) throw new TypeError('Tide records must be an array');

  const expectedCount = expectedDayCount(year);
  if (records.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} days for ${year}, received ${records.length}`);
  }

  const start = new Date(Date.UTC(year, 0, 1));
  records.forEach((record, index) => {
    const expected = new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10);
    if (record.date !== expected) {
      throw new Error(`Expected ${expected} at index ${index}, received ${record.date}`);
    }
    if (!Array.isArray(record.hours) || record.hours.length !== 24) {
      throw new Error(`Expected 24 hourly values for ${record.date}`);
    }
    if (!record.hours.every(value => Number.isFinite(value) && value >= -500 && value <= 500)) {
      throw new Error(`Invalid hourly value for ${record.date}`);
    }
    if (!Array.isArray(record.highs) || !Array.isArray(record.lows)) {
      throw new Error(`Invalid extrema lists for ${record.date}`);
    }
    for (const [kind, extrema] of [['highs', record.highs], ['lows', record.lows]]) {
      if (!extrema.every(item =>
        item &&
        /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.time) &&
        Number.isFinite(item.height)
      )) {
        throw new Error(`Invalid ${kind} entry for ${record.date}`);
      }
    }
  });

  return records;
}

export function parseJmaTideText(text, expectedYear) {
  assertYear(expectedYear);
  if (typeof text !== 'string') throw new TypeError('JMA tide data must be text');

  const normalized = text.replace(/\r\n?/g, '\n').trimEnd();
  const lines = normalized ? normalized.split('\n') : [];
  const records = lines.map((line, index) => parseLine(line, index + 1, expectedYear));
  return validateTideRecords(records, expectedYear);
}
