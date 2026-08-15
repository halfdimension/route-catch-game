import assert from 'node:assert/strict'
import test from 'node:test'
import { submitLiveSoloCatchOnce } from '../src/recovery/soloCatchSubmission.js'
import {
  SOLO_RECOVERED_CATCH_OUTBOX_SUBMISSION_ENABLED,
} from '../src/recovery/soloRecoveryCheckpoint.js'
import { reconcileSoloTargetRecoveryTimeline } from '../src/recovery/soloTargetRecoveryTimeline.js'
import {
  createValidSoloCheckpoint,
  SOLO_RECOVERY_TEST_STARTED_AT as STARTED_AT,
} from './helpers/soloRecoveryFixtures.js'

const CAUGHT_TARGET = {
  id: '66666666-6666-4666-8666-666666666666',
  creatureId: 'sparkbit',
  lat: 28.55,
  lon: 77.26,
  rarity: 'common',
  score: 10,
  spawnedAt: STARTED_AT,
  expiresAt: STARTED_AT + 30_000,
  lifetimeMs: 30_000,
  caughtAt: STARTED_AT + 2_000,
}
const PENDING_CATCH = {
  catchId: '77777777-7777-4777-8777-777777777777',
  targetId: CAUGHT_TARGET.id,
  creatureId: CAUGHT_TARGET.creatureId,
  caughtAtEpochMs: CAUGHT_TARGET.caughtAt,
}
const SCOPE = {
  identityKey: 'user:11111111-1111-4111-8111-111111111111',
  lifecycleGeneration: 1,
  clientRoundId: '33333333-3333-4333-8333-333333333333',
  backendSessionId: '44444444-4444-4444-8444-444444444444',
  catchId: PENDING_CATCH.catchId,
  targetId: PENDING_CATCH.targetId,
}

function liveSubmission(durability = Promise.resolve({
  ok: true,
  durable: true,
  degraded: false,
})) {
  return {
    caughtTarget: CAUGHT_TARGET,
    pendingCatch: PENDING_CATCH,
    scope: SCOPE,
    durability,
  }
}

test('recovered pending-catch replay gate is enabled after scoped worker wiring', () => {
  const checkpoint = createValidSoloCheckpoint({ score: 10 })
  checkpoint.caughtTargets = [CAUGHT_TARGET]
  checkpoint.backendSync.pendingCatches = [PENDING_CATCH]
  let backendCalls = 0

  const recovered = reconcileSoloTargetRecoveryTimeline(checkpoint, {
    nowEpochMs: STARTED_AT + 10_000,
  })
  if (SOLO_RECOVERED_CATCH_OUTBOX_SUBMISSION_ENABLED) {
    backendCalls += recovered.checkpoint.backendSync.pendingCatches.length
  }

  assert.equal(SOLO_RECOVERED_CATCH_OUTBOX_SUBMISSION_ENABLED, true)
  assert.equal(backendCalls, 1)
  assert.deepEqual(recovered.checkpoint.backendSync.pendingCatches, [PENDING_CATCH])
  assert.equal(recovered.checkpoint.score, 10)
})

test('normal live catch submits once with the stable pending catch identity', async () => {
  const submittedCatches = []
  const acknowledgements = []
  const result = await submitLiveSoloCatchOnce({
    submission: liveSubmission(),
    submitBackendCatch: async (catchId, creatureId) => {
      submittedCatches.push({ catchId, creatureId })
      return { catchId: PENDING_CATCH.catchId, score: 10 }
    },
    isSubmissionScopeCurrent: () => true,
    acknowledgePendingCatch: (scope) => {
      acknowledgements.push(scope)
      return { acknowledged: true, stale: false }
    },
  })

  assert.deepEqual(submittedCatches, [{
    catchId: PENDING_CATCH.catchId,
    creatureId: 'sparkbit',
  }])
  assert.deepEqual(acknowledgements, [SCOPE])
  assert.deepEqual(result.response, {
    catchId: PENDING_CATCH.catchId,
    score: 10,
  })
  assert.equal(result.submitted, true)
  assert.equal(result.acknowledged, true)
})

for (const [name, response] of [
  ['missing response catchId', { score: 99, caughtCount: 9 }],
  ['mismatched response catchId', {
    catchId: '88888888-8888-4888-8888-888888888888',
    score: 99,
    caughtCount: 9,
  }],
]) {
  test(`${name} cannot acknowledge the submitted live catch`, async () => {
    let acknowledgements = 0
    const failures = []
    const result = await submitLiveSoloCatchOnce({
      submission: liveSubmission(),
      submitBackendCatch: async () => response,
      isSubmissionScopeCurrent: () => true,
      acknowledgePendingCatch: () => {
        acknowledgements += 1
        return { acknowledged: true, stale: false, durable: true }
      },
      onSynchronizationFailure: (failure) => failures.push(failure),
    })

    assert.equal(result.confirmed, false)
    assert.equal(result.acknowledged, false)
    assert.equal(result.failureKind, 'RESPONSE_IDENTITY')
    assert.equal(acknowledgements, 0)
    assert.equal(failures.length, 1)
    assert.equal(failures[0].catchId, PENDING_CATCH.catchId)
  })
}

test('uncertain live catch response is not acknowledged or automatically retried', async () => {
  let backendCalls = 0
  let acknowledgements = 0
  const result = await submitLiveSoloCatchOnce({
    submission: liveSubmission(),
    submitBackendCatch: async () => {
      backendCalls += 1
      return null
    },
    isSubmissionScopeCurrent: () => true,
    acknowledgePendingCatch: () => {
      acknowledgements += 1
    },
  })

  assert.equal(result.response, null)
  assert.equal(result.submitted, true)
  assert.equal(backendCalls, 1)
  assert.equal(acknowledgements, 0)
})

test('normal backend submission remains blocked until this catch is durable', async () => {
  let releaseDurability
  const durability = new Promise((resolve) => {
    releaseDurability = resolve
  })
  let backendCalls = 0
  const submission = submitLiveSoloCatchOnce({
    submission: liveSubmission(durability),
    submitBackendCatch: async () => {
      backendCalls += 1
      return { catchId: PENDING_CATCH.catchId, score: 10 }
    },
    isSubmissionScopeCurrent: () => true,
    acknowledgePendingCatch: async () => ({
      acknowledged: true,
      stale: false,
    }),
  })

  await Promise.resolve()
  assert.equal(backendCalls, 0)
  releaseDurability({ ok: true, durable: true, degraded: false })
  const result = await submission

  assert.equal(backendCalls, 1)
  assert.equal(result.submitted, true)
})

test('explicit degraded storage mode submits once without retry', async () => {
  for (const durabilityResult of [
    { ok: false, durable: false, degraded: true, error: new Error('blocked') },
    { ok: false, durable: false, degraded: true, timedOut: true },
  ]) {
    let backendCalls = 0
    const result = await submitLiveSoloCatchOnce({
      submission: liveSubmission(Promise.resolve(durabilityResult)),
      submitBackendCatch: async () => {
        backendCalls += 1
        return null
      },
      isSubmissionScopeCurrent: () => true,
      acknowledgePendingCatch: () => assert.fail('unexpected ack'),
    })

    assert.equal(result.submitted, true)
    assert.equal(result.durability.degraded, true)
    assert.equal(backendCalls, 1)
  }
})

test('stale scoped catch never reaches the backend after durability settles', async () => {
  let backendCalls = 0
  const result = await submitLiveSoloCatchOnce({
    submission: liveSubmission(),
    submitBackendCatch: async () => {
      backendCalls += 1
      return { catchId: PENDING_CATCH.catchId, score: 10 }
    },
    isSubmissionScopeCurrent: () => false,
    acknowledgePendingCatch: () => assert.fail('unexpected ack'),
  })

  assert.equal(result.stale, true)
  assert.equal(result.submitted, false)
  assert.equal(backendCalls, 0)
})
