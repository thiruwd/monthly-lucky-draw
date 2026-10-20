export function getPeriod(now, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, month: 'numeric', year: 'numeric'
  }).formatToParts(now);
  return {
    month: Number(parts.find(part => part.type === 'month').value),
    year: Number(parts.find(part => part.type === 'year').value),
    timezone
  };
}

export function sqlUtc(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export function isoUtc(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : `${value.replace(' ', 'T')}Z`;
}
