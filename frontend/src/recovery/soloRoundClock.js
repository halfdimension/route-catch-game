function assertEpochMs(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative epoch timestamp`)
  }
}

export function createSoloRoundTimeline({
  durationSeconds,
  startedAtEpochMs,
  endsAtEpochMs,
}) {
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds <= 0) {
    throw new TypeError('durationSeconds must be a positive integer')
  }

  assertEpochMs(startedAtEpochMs, 'startedAtEpochMs')
  const expectedEndsAtEpochMs =
    startedAtEpochMs + durationSeconds * 1000
  const resolvedEndsAtEpochMs = endsAtEpochMs ?? expectedEndsAtEpochMs
  assertEpochMs(resolvedEndsAtEpochMs, 'endsAtEpochMs')

  if (resolvedEndsAtEpochMs !== expectedEndsAtEpochMs) {
    throw new RangeError('Round end must equal start plus duration')
  }

  return Object.freeze({
    durationSeconds,
    startedAtEpochMs,
    endsAtEpochMs: resolvedEndsAtEpochMs,
  })
}

export function getSoloRoundRemainingMilliseconds(timeline, nowEpochMs) {
  assertEpochMs(nowEpochMs, 'nowEpochMs')

  if (!timeline) {
    return 0
  }

  return Math.max(0, timeline.endsAtEpochMs - nowEpochMs)
}

export function getSoloRoundRemainingSeconds(timeline, nowEpochMs) {
  return Math.ceil(
    getSoloRoundRemainingMilliseconds(timeline, nowEpochMs) / 1000,
  )
}

export function isSoloRoundExpired(timeline, nowEpochMs) {
  return getSoloRoundRemainingMilliseconds(timeline, nowEpochMs) === 0
}

export function getRecoverableSoloRoundState(timeline, nowEpochMs) {
  return isSoloRoundExpired(timeline, nowEpochMs) ? 'ended' : 'running'
}
