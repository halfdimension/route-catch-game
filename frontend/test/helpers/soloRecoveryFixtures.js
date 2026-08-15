import {
  calculateSoloCheckpointExpiresAt,
  SOLO_RECOVERY_ROUND_PHASES,
} from '../../src/recovery/soloRecoveryCheckpoint.js'
import { createAuthenticatedSoloIdentityKey } from '../../src/recovery/soloRecoveryIdentity.js'

export const SOLO_RECOVERY_TEST_USER_ID =
  '11111111-1111-4111-8111-111111111111'
export const SOLO_RECOVERY_TEST_STARTED_AT = 1_800_000_000_000

export function createValidSoloCheckpoint({
  identityKey = createAuthenticatedSoloIdentityKey(
    SOLO_RECOVERY_TEST_USER_ID,
  ),
  phase = SOLO_RECOVERY_ROUND_PHASES.RUNNING,
  startedAtEpochMs = SOLO_RECOVERY_TEST_STARTED_AT,
  durationSeconds = 60,
  createdAtEpochMs = SOLO_RECOVERY_TEST_STARTED_AT,
  updatedAtEpochMs,
  score = 0,
} = {}) {
  const endsAtEpochMs =
    phase === SOLO_RECOVERY_ROUND_PHASES.STARTING
      ? null
      : startedAtEpochMs + durationSeconds * 1000
  const resolvedUpdatedAtEpochMs = updatedAtEpochMs ?? (
    phase === SOLO_RECOVERY_ROUND_PHASES.RECONCILING
      ? endsAtEpochMs + 1_000
      : createdAtEpochMs + 5_000
  )

  return {
    schemaVersion: 1,
    identityKey,
    round: {
      clientRoundId: '33333333-3333-4333-8333-333333333333',
      backendSessionId: '44444444-4444-4444-8444-444444444444',
      phase,
      durationSeconds,
      startedAtEpochMs:
        phase === SOLO_RECOVERY_ROUND_PHASES.STARTING
          ? null
          : startedAtEpochMs,
      endsAtEpochMs,
    },
    player: {
      settledPosition: { lat: 28.5505, lon: 77.2688 },
      simulationSpeedMetersPerSecond: 80,
    },
    movement: null,
    targets: [],
    caughtTargets: [],
    score,
    xp: score,
    spawning: {
      paused: phase !== SOLO_RECOVERY_ROUND_PHASES.RUNNING,
      nextSpawnAtEpochMs:
        phase === SOLO_RECOVERY_ROUND_PHASES.RUNNING
          ? resolvedUpdatedAtEpochMs + 5_000
          : null,
    },
    backendSync: { pendingCatches: [] },
    createdAtEpochMs,
    updatedAtEpochMs: resolvedUpdatedAtEpochMs,
    expiresAtEpochMs: calculateSoloCheckpointExpiresAt({
      phase,
      createdAtEpochMs,
      endsAtEpochMs,
    }),
  }
}
