import assert from 'node:assert/strict'
import test from 'node:test'
import { indexedDB } from 'fake-indexeddb'
import {
  SOLO_RECOVERY_OBJECT_STORE,
  createSoloRecoveryStore,
} from '../src/recovery/soloRecoveryStore.js'
import {
  SOLO_RECOVERY_ROUND_PHASES,
} from '../src/recovery/soloRecoveryCheckpoint.js'
import { resolveSoloRecoveryIdentity } from '../src/recovery/soloRecoveryIdentity.js'
import {
  createValidSoloCheckpoint,
  SOLO_RECOVERY_TEST_USER_ID,
} from './helpers/soloRecoveryFixtures.js'

function createHarness() {
  const databaseName = `solo-recovery-test-${crypto.randomUUID()}`
  const store = createSoloRecoveryStore({ indexedDb: indexedDB, databaseName })
  return { databaseName, store }
}

function deleteDatabase(databaseName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Test database deletion blocked'))
  })
}

function openTestDatabase(databaseName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SOLO_RECOVERY_OBJECT_STORE)) {
        request.result.createObjectStore(SOLO_RECOVERY_OBJECT_STORE, {
          keyPath: 'identityKey',
        })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function disposeHarness(harness) {
  harness.store.close()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await deleteDatabase(harness.databaseName)
}

async function putRawRecord(databaseName, record) {
  const database = await openTestDatabase(databaseName)
  const transaction = database.transaction(
    SOLO_RECOVERY_OBJECT_STORE,
    'readwrite',
  )
  transaction.objectStore(SOLO_RECOVERY_OBJECT_STORE).put(record)
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve
    transaction.onabort = () => reject(transaction.error)
  })
  database.close()
}

test('IndexedDB store writes, reads, and atomically replaces one identity record', async () => {
  const harness = createHarness()
  const first = createValidSoloCheckpoint({ score: 10 })
  const replacement = createValidSoloCheckpoint({ score: 30 })

  try {
    assert.equal((await harness.store.replace(first.identityKey, first)).ok, true)
    assert.equal(
      (await harness.store.replace(replacement.identityKey, replacement)).ok,
      true,
    )
    const result = await harness.store.read(first.identityKey)

    assert.equal(result.ok, true)
    assert.equal(result.checkpoint.score, 30)
    assert.equal(result.checkpoint.xp, 30)
  } finally {
    await disposeHarness(harness)
  }
})

test('IndexedDB store deletes a checkpoint', async () => {
  const harness = createHarness()
  const checkpoint = createValidSoloCheckpoint()

  try {
    await harness.store.replace(checkpoint.identityKey, checkpoint)
    assert.equal((await harness.store.delete(checkpoint.identityKey)).ok, true)
    assert.equal((await harness.store.read(checkpoint.identityKey)).checkpoint, null)
  } finally {
    await disposeHarness(harness)
  }
})

test('startup sweep removes expired STARTING and RUNNING checkpoints', async () => {
  const startingHarness = createHarness()
  const runningHarness = createHarness()
  const starting = createValidSoloCheckpoint({
    phase: SOLO_RECOVERY_ROUND_PHASES.STARTING,
    updatedAtEpochMs: 1_800_000_000_000,
  })
  const running = createValidSoloCheckpoint({
    startedAtEpochMs: 1_800_000_000_000,
    updatedAtEpochMs: 1_800_000_001_000,
  })

  try {
    await startingHarness.store.replace(starting.identityKey, starting)
    const startingSweep = await startingHarness.store.sweep(
      starting.identityKey,
      starting.expiresAtEpochMs,
    )
    assert.deepEqual(startingSweep.deletedIdentityKeys, [starting.identityKey])

    await runningHarness.store.replace(running.identityKey, running)
    const duringGrace = await runningHarness.store.sweep(
      running.identityKey,
      running.round.endsAtEpochMs + 1,
    )
    assert.deepEqual(duringGrace.deletedIdentityKeys, [])
    const afterGrace = await runningHarness.store.sweep(
      running.identityKey,
      running.expiresAtEpochMs,
    )
    assert.deepEqual(afterGrace.deletedIdentityKeys, [running.identityKey])
  } finally {
    await disposeHarness(startingHarness)
    await disposeHarness(runningHarness)
  }
})

test('post-end reconciliation metadata can be replaced during storage grace', async () => {
  const harness = createHarness()
  const checkpoint = createValidSoloCheckpoint({
    phase: SOLO_RECOVERY_ROUND_PHASES.RECONCILING,
    score: 10,
  })

  try {
    const replacement = await harness.store.replace(
      checkpoint.identityKey,
      checkpoint,
    )
    const stored = await harness.store.read(checkpoint.identityKey)

    assert.equal(replacement.ok, true)
    assert.equal(stored.ok, true)
    assert.equal(stored.checkpoint.round.phase, 'RECONCILING')
    assert.equal(stored.checkpoint.score, 10)
    assert.ok(
      stored.checkpoint.updatedAtEpochMs >=
        stored.checkpoint.round.endsAtEpochMs,
    )
    assert.ok(
      stored.checkpoint.updatedAtEpochMs < stored.checkpoint.expiresAtEpochMs,
    )
  } finally {
    await disposeHarness(harness)
  }
})

test('bootstrap-safe read reports corruption without deleting it implicitly', async () => {
  const harness = createHarness()
  const checkpoint = createValidSoloCheckpoint()

  try {
    await harness.store.replace(checkpoint.identityKey, checkpoint)
    harness.store.close()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await putRawRecord(harness.databaseName, {
      ...checkpoint,
      schemaVersion: 99,
    })

    const reader = createSoloRecoveryStore({
      indexedDb: indexedDB,
      databaseName: harness.databaseName,
    })
    const safeResult = await reader.read(checkpoint.identityKey, {
      deleteInvalid: false,
    })
    assert.equal(safeResult.ok, true)
    assert.equal(safeResult.checkpoint, null)
    assert.equal(safeResult.discardedReason, 'invalid')
    assert.equal(safeResult.cleanupRequired, true)
    const safeRepeat = await reader.read(checkpoint.identityKey, {
      deleteInvalid: false,
    })
    assert.equal(safeRepeat.cleanupRequired, true)

    const result = await reader.read(checkpoint.identityKey)
    assert.equal(result.ok, true)
    assert.equal(result.checkpoint, null)
    assert.equal(result.discardedReason, 'invalid')
    assert.equal((await reader.read(checkpoint.identityKey)).checkpoint, null)
    reader.close()
  } finally {
    await disposeHarness(harness)
  }
})

test('store rejects identity mismatch without overwriting another identity', async () => {
  const harness = createHarness()
  const checkpoint = createValidSoloCheckpoint()
  const otherIdentity = 'user:77777777-7777-4777-8777-777777777777'

  try {
    await harness.store.replace(checkpoint.identityKey, checkpoint)
    const result = await harness.store.replace(otherIdentity, checkpoint)
    assert.equal(result.ok, false)
    assert.equal((await harness.store.read(otherIdentity)).checkpoint, null)
    assert.deepEqual(
      (await harness.store.read(checkpoint.identityKey)).checkpoint,
      checkpoint,
    )
  } finally {
    await disposeHarness(harness)
  }
})

test('IndexedDB unavailable and open failures return recoverable failures', async () => {
  const checkpoint = createValidSoloCheckpoint()
  const unavailable = createSoloRecoveryStore({ indexedDb: null })
  const failing = createSoloRecoveryStore({
    indexedDb: {
      open() {
        throw new Error('open failed')
      },
    },
  })

  for (const result of [
    await unavailable.read(checkpoint.identityKey),
    await unavailable.replace(checkpoint.identityKey, checkpoint),
    await unavailable.delete(checkpoint.identityKey),
    await unavailable.sweep(checkpoint.identityKey, Date.now()),
    await failing.read(checkpoint.identityKey),
  ]) {
    assert.equal(result.ok, false)
    assert.ok(result.error instanceof Error)
  }
})

test('unresolved identity cannot open the recovery database for any operation', async () => {
  let openCount = 0
  const store = createSoloRecoveryStore({
    databaseFactory: async () => {
      openCount += 1
      throw new Error('unresolved identity must not reach IndexedDB')
    },
  })
  const checkpoint = createValidSoloCheckpoint()
  const unresolved = resolveSoloRecoveryIdentity({
    loadingAuth: true,
    isAuthenticated: false,
    currentUser: null,
  })

  assert.equal((await store.read(unresolved.identityKey)).ok, false)
  assert.equal(
    (await store.replace(unresolved.identityKey, checkpoint)).ok,
    false,
  )
  assert.equal((await store.delete(unresolved.identityKey)).ok, false)
  assert.equal((await store.sweep(unresolved.identityKey, Date.now())).ok, false)
  assert.equal(openCount, 0)
})

test('resolved authenticated and guest identities can sweep only their record', async () => {
  const databaseName = `solo-recovery-identity-sweep-${crypto.randomUUID()}`
  let openCount = 0
  const instrumentedIndexedDb = {
    open(...args) {
      openCount += 1
      return indexedDB.open(...args)
    },
  }
  const store = createSoloRecoveryStore({
    indexedDb: instrumentedIndexedDb,
    databaseName,
  })
  const authenticated = resolveSoloRecoveryIdentity({
    loadingAuth: false,
    isAuthenticated: true,
    currentUser: { userId: SOLO_RECOVERY_TEST_USER_ID },
  })
  const guest = resolveSoloRecoveryIdentity({
    loadingAuth: false,
    isAuthenticated: false,
    currentUser: null,
    storage: {
      getItem: () => null,
      setItem() {},
    },
    randomUuid: () => '66666666-6666-4666-8666-666666666666',
  })
  const authenticatedCheckpoint = createValidSoloCheckpoint({
    identityKey: authenticated.identityKey,
    phase: SOLO_RECOVERY_ROUND_PHASES.STARTING,
    updatedAtEpochMs: 1_800_000_000_000,
  })
  const guestCheckpoint = createValidSoloCheckpoint({
    identityKey: guest.identityKey,
    phase: SOLO_RECOVERY_ROUND_PHASES.STARTING,
    createdAtEpochMs: 1_800_001_000_000,
    updatedAtEpochMs: 1_800_001_000_000,
  })

  try {
    assert.equal(
      (await store.replace(
        authenticated.identityKey,
        authenticatedCheckpoint,
      )).ok,
      true,
    )
    assert.equal(
      (await store.replace(guest.identityKey, guestCheckpoint)).ok,
      true,
    )
    assert.equal(openCount, 1)

    const authenticatedSweep = await store.sweep(
      authenticated.identityKey,
      authenticatedCheckpoint.expiresAtEpochMs,
    )
    const guestSweep = await store.sweep(
      guest.identityKey,
      authenticatedCheckpoint.expiresAtEpochMs,
    )

    assert.deepEqual(authenticatedSweep.deletedIdentityKeys, [
      authenticated.identityKey,
    ])
    assert.deepEqual(guestSweep.deletedIdentityKeys, [])
    assert.deepEqual(
      (await store.read(guest.identityKey)).checkpoint,
      guestCheckpoint,
    )
  } finally {
    store.close()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await deleteDatabase(databaseName)
  }
})

test('IndexedDB transaction/write failures return recoverable failures', async () => {
  const checkpoint = createValidSoloCheckpoint()
  const store = createSoloRecoveryStore({
    databaseFactory: async () => ({
      transaction() {
        throw new Error('write failed')
      },
      close() {},
    }),
  })

  const result = await store.replace(checkpoint.identityKey, checkpoint)
  assert.equal(result.ok, false)
  assert.match(result.error.message, /write failed/)
  store.close()
})

test('explicit close allows the next operation to reopen the database', async () => {
  const harness = createHarness()
  const checkpoint = createValidSoloCheckpoint({ score: 20 })

  try {
    assert.equal(
      (await harness.store.replace(checkpoint.identityKey, checkpoint)).ok,
      true,
    )
    harness.store.close()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const reopened = await harness.store.read(checkpoint.identityKey)
    assert.equal(reopened.ok, true)
    assert.equal(reopened.checkpoint.score, 20)
  } finally {
    await disposeHarness(harness)
  }
})

test('versionchange invalidates the cached connection and reopens successfully', async () => {
  const databaseName = `solo-recovery-versionchange-${crypto.randomUUID()}`
  const connections = []
  const store = createSoloRecoveryStore({
    databaseName,
    databaseFactory: async () => {
      const database = await openTestDatabase(databaseName)
      connections.push(database)
      return database
    },
  })
  const checkpoint = createValidSoloCheckpoint({ score: 40 })

  try {
    assert.equal(
      (await store.replace(checkpoint.identityKey, checkpoint)).ok,
      true,
    )
    assert.equal(connections.length, 1)

    connections[0].onversionchange?.({})
    const reopened = await store.read(checkpoint.identityKey)

    assert.equal(reopened.ok, true)
    assert.equal(reopened.checkpoint.score, 40)
    assert.equal(connections.length, 2)
  } finally {
    store.close()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await deleteDatabase(databaseName)
  }
})

test('aborted replacement preserves the previous complete checkpoint', async () => {
  const databaseName = `solo-recovery-abort-${crypto.randomUUID()}`
  const database = await openTestDatabase(databaseName)
  let abortNextWrite = false
  let failNextRead = false
  const wrappedDatabase = {
    close: () => database.close(),
    transaction(storeName, mode) {
      if (failNextRead && mode === 'readonly') {
        failNextRead = false
        throw new Error('temporary read failure')
      }

      const transaction = database.transaction(storeName, mode)
      if (abortNextWrite && mode === 'readwrite') {
        abortNextWrite = false
        queueMicrotask(() => transaction.abort())
      }
      return transaction
    },
  }
  const store = createSoloRecoveryStore({
    databaseFactory: async () => wrappedDatabase,
  })
  const first = createValidSoloCheckpoint({ score: 10 })
  const replacement = createValidSoloCheckpoint({ score: 90 })

  try {
    assert.equal((await store.replace(first.identityKey, first)).ok, true)

    abortNextWrite = true
    const failedReplacement = await store.replace(
      replacement.identityKey,
      replacement,
    )
    assert.equal(failedReplacement.ok, false)

    failNextRead = true
    const temporaryFailure = await store.read(first.identityKey)
    assert.equal(temporaryFailure.ok, false)

    const retained = await store.read(first.identityKey)
    assert.equal(retained.ok, true)
    assert.equal(retained.checkpoint.score, 10)
    assert.equal(retained.checkpoint.xp, 10)
  } finally {
    store.close()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await deleteDatabase(databaseName)
  }
})
