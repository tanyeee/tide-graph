export function interpolateHeightAtMinute(series, minute, stepMinutes = 10) {
  if (!Array.isArray(series) || !series.length || !Number.isFinite(minute)) return null;
  const position = minute / stepMinutes;
  const lowerIndex = Math.max(0, Math.min(series.length - 1, Math.floor(position)));
  const upperIndex = Math.max(0, Math.min(series.length - 1, Math.ceil(position)));
  const lower = series[lowerIndex];
  const upper = series[upperIndex];
  if (!Number.isFinite(lower?.height) || !Number.isFinite(upper?.height)) return null;
  if (lowerIndex === upperIndex) return lower.height;
  const fraction = position - lowerIndex;
  return lower.height + (upper.height - lower.height) * fraction;
}

export function shouldScheduleMarkerRefresh(hasCurrentMarker, documentHidden) {
  return Boolean(hasCurrentMarker) && !documentHidden;
}
