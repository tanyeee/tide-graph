import { getSunMoonElongation } from './suncalc.js';

// MIRC (Japan Hydrographic Association) scientific tide-name convention.
// Boundaries are the Moon–Sun ecliptic longitude difference at 00:00 JST.
// https://www.mirc.jp/online/w/w-tide/knowledge/SN-det.html
export function tideNameForElongation(elongation) {
  const angle = ((elongation % 360) + 360) % 360;
  if (angle < 31 || angle >= 343) return '大潮';
  if (angle < 67) return '中潮';
  if (angle < 103) return '小潮';
  if (angle < 115) return '長潮';
  if (angle < 127) return '若潮';
  if (angle < 163) return '中潮';
  if (angle < 211) return '大潮';
  if (angle < 247) return '中潮';
  if (angle < 283) return '小潮';
  if (angle < 295) return '長潮';
  if (angle < 307) return '若潮';
  return '中潮';
}

export function getScientificTideName(dateStr) {
  const jstMidnight = new Date(`${dateStr}T00:00:00+09:00`);
  return tideNameForElongation(getSunMoonElongation(jstMidnight));
}
