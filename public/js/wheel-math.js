export const TAU = Math.PI * 2;
export const normalizeAngle = angle => ((angle % TAU) + TAU) % TAU;

// Segment zero starts at the fixed pointer (12 o'clock); land on its center.
export function planSpin(currentRotation, winnerIndex, count, turns = 6) {
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(winnerIndex) || winnerIndex < 0 || winnerIndex >= count) {
    throw new Error('Invalid server wheel mapping.');
  }
  const target = normalizeAngle(-(winnerIndex + 0.5) * TAU / count);
  return currentRotation + turns * TAU + normalizeAngle(target - normalizeAngle(currentRotation));
}

export function indexAtPointer(rotation, count) {
  if (!Number.isInteger(count) || count < 1) return -1;
  return Math.floor(normalizeAngle(-rotation) / (TAU / count)) % count;
}

export const easeOutQuint = progress => 1 - (1 - progress) ** 5;
export const liveProgress = (now, startsAt, durationMs) => Math.max(0, Math.min(1, (now - startsAt) / durationMs));
export function liveRotation(now, startsAt, durationMs, winnerIndex, count) {
  return planSpin(0, winnerIndex, count) * easeOutQuint(liveProgress(now, startsAt, durationMs));
}
