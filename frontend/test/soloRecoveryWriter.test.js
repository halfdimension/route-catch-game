import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSerializedSoloRecoveryWriter,
  createSoloRecoveryWriterOrderingRegistry,
} from '../src/recovery/soloRecoveryWriter.js'

const IDENTITY = 'user:11111111-1111-4111-8111-111111111111'

function deferred() {
  let resolve
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

test('serialized writer cannot let A finish after coalesced C', async () => {
  const firstWrite = deferred()
  const calls = []
  let replaceCount = 0
  const store = {
    async replace(identityKey, checkpoint) {
      calls.push(['replace', identityKey, checkpoint.revision])
      replaceCount += 1
      if (replaceCount === 1) {
        await firstWrite.promise
      }
      return { ok: true, operation: 'replace' }
    },
    async delete() {
      return { ok: true, operation: 'delete' }
    },
  }
  const writer = createSerializedSoloRecoveryWriter({
    store,
    identityKey: IDENTITY,
  })

  const writeA = writer.replace({ revision: 'A' })
  const writeB = writer.replace({ revision: 'B' })
  const writeC = writer.replace({ revision: 'C' })
  firstWrite.resolve()

  await Promise.all([writeA, writeB, writeC])
  await writer.drain()

  assert.deepEqual(calls, [
    ['replace', IDENTITY, 'A'],
    ['replace', IDENTITY, 'C'],
  ])
})

test('durability-critical replacement commits before a later coalescible write', async () => {
  const firstWrite = deferred()
  const calls = []
  const store = {
    async replace(_identityKey, checkpoint) {
      calls.push(checkpoint.revision)
      if (checkpoint.revision === 'A') {
        await firstWrite.promise
      }
      return { ok: true, operation: 'replace' }
    },
    async delete() {
      return { ok: true, operation: 'delete' }
    },
  }
  const writer = createSerializedSoloRecoveryWriter({
    store,
    identityKey: IDENTITY,
  })

  const writeA = writer.replace({ revision: 'A' })
  const catchWrite = writer.replaceDurably({ revision: 'catch' })
  const laterWrite = writer.replace({ revision: 'later' })
  firstWrite.resolve()

  await Promise.all([writeA, catchWrite, laterWrite])
  assert.deepEqual(calls, ['A', 'catch', 'later'])
})

test('delete supersedes queued replacement and follows an in-flight write', async () => {
  const firstWrite = deferred()
  const calls = []
  const store = {
    async replace(_identityKey, checkpoint) {
      calls.push(`replace:${checkpoint.revision}`)
      await firstWrite.promise
      return { ok: true, operation: 'replace' }
    },
    async delete(identityKey) {
      calls.push(`delete:${identityKey}`)
      return { ok: true, operation: 'delete' }
    },
  }
  const writer = createSerializedSoloRecoveryWriter({
    store,
    identityKey: IDENTITY,
  })

  const writeA = writer.replace({ revision: 'A' })
  const writeB = writer.replace({ revision: 'B' })
  const deletion = writer.delete()
  assert.deepEqual(await writeB, {
    ok: true,
    operation: 'replace',
    superseded: true,
  })
  firstWrite.resolve()
  await Promise.all([writeA, deletion])

  assert.deepEqual(calls, [
    'replace:A',
    `delete:${IDENTITY}`,
  ])
})

test('terminal delete rejects a stale replacement submitted after deletion', async () => {
  const firstWrite = deferred()
  const calls = []
  const records = new Map()
  const store = {
    async replace(identityKey, checkpoint) {
      calls.push(`replace:${checkpoint.revision}`)
      await firstWrite.promise
      records.set(identityKey, checkpoint)
      return { ok: true, operation: 'replace' }
    },
    async delete(identityKey) {
      calls.push('delete')
      records.delete(identityKey)
      return { ok: true, operation: 'delete' }
    },
  }
  const writer = createSerializedSoloRecoveryWriter({
    store,
    identityKey: IDENTITY,
  })

  const writeA = writer.replace({ revision: 'A' })
  const deletion = writer.delete()
  const staleWrite = await writer.replace({ revision: 'B' })
  assert.equal(staleWrite.closed, true)
  assert.equal(staleWrite.reason, 'terminal-delete')

  firstWrite.resolve()
  await Promise.all([writeA, deletion])
  assert.deepEqual(calls, ['replace:A', 'delete'])
  assert.equal(records.has(IDENTITY), false)
})

test('a new writer generation persists only after the old terminal delete', async () => {
  const firstWrite = deferred()
  const calls = []
  const records = new Map()
  const store = {
    async replace(identityKey, checkpoint) {
      calls.push(`replace:${checkpoint.revision}`)
      if (checkpoint.revision === 'A') {
        await firstWrite.promise
      }
      records.set(identityKey, checkpoint)
      return { ok: true, operation: 'replace' }
    },
    async delete(identityKey) {
      calls.push('delete')
      records.delete(identityKey)
      return { ok: true, operation: 'delete' }
    },
  }
  const roundA = createSerializedSoloRecoveryWriter({
    store,
    identityKey: IDENTITY,
  })
  const writeA = roundA.replace({ revision: 'A' })
  const deletion = roundA.delete()
  const roundB = createSerializedSoloRecoveryWriter({
    store,
    identityKey: IDENTITY,
    startBarrier: deletion,
  })
  const writeB = roundB.replace({ revision: 'B' })

  assert.equal((await roundA.replace({ revision: 'stale-A' })).closed, true)
  firstWrite.resolve()
  await Promise.all([writeA, deletion, writeB])

  assert.deepEqual(calls, ['replace:A', 'delete', 'replace:B'])
  assert.equal(records.get(IDENTITY).revision, 'B')
})

test('ordering registry carries an in-flight replace across writer generations', async () => {
  const firstWrite = deferred()
  const records = new Map()
  const calls = []
  const orderingRegistry = createSoloRecoveryWriterOrderingRegistry()
  const store = {
    async replace(identityKey, checkpoint) {
      calls.push(`replace:${checkpoint.revision}`)
      if (checkpoint.revision === 'A1') {
        await firstWrite.promise
      }
      records.set(identityKey, checkpoint)
      return { ok: true, operation: 'replace' }
    },
    async delete() {
      return { ok: true, operation: 'delete' }
    },
  }
  const writerA1 = createSerializedSoloRecoveryWriter({
    store,
    identityKey: IDENTITY,
    writerGeneration: 1,
    orderingRegistry,
  })
  const writeA1 = writerA1.replace({ revision: 'A1' })
  writerA1.close()
  const writerA2 = createSerializedSoloRecoveryWriter({
    store,
    identityKey: IDENTITY,
    writerGeneration: 2,
    orderingRegistry,
  })
  const writeA2 = writerA2.replace({ revision: 'A2' })

  assert.deepEqual(calls, ['replace:A1'])
  firstWrite.resolve()
  await Promise.all([writeA1, writeA2])

  assert.deepEqual(calls, ['replace:A1', 'replace:A2'])
  assert.equal(records.get(IDENTITY).revision, 'A2')
})

test('ordering registry retains an older native write when a queued tail is discarded', async () => {
  const firstWrite = deferred()
  const records = new Map()
  const calls = []
  const orderingRegistry = createSoloRecoveryWriterOrderingRegistry()
  const store = {
    async replace(identityKey, checkpoint) {
      calls.push(`replace:${checkpoint.revision}`)
      if (checkpoint.revision === 'A1-running') {
        await firstWrite.promise
      }
      records.set(identityKey, checkpoint)
      return { ok: true, operation: 'replace' }
    },
    async delete() {
      return { ok: true, operation: 'delete' }
    },
  }
  const writerA1 = createSerializedSoloRecoveryWriter({
    store,
    identityKey: IDENTITY,
    writerGeneration: 1,
    orderingRegistry,
  })
  const runningA1 = writerA1.replace({ revision: 'A1-running' })
  const queuedA1 = writerA1.replace({ revision: 'A1-queued' })
  writerA1.close({ discardQueuedReplacements: true })
  const writerA2 = createSerializedSoloRecoveryWriter({
    store,
    identityKey: IDENTITY,
    writerGeneration: 2,
    orderingRegistry,
  })
  const writeA2 = writerA2.replace({ revision: 'A2' })

  assert.equal((await queuedA1).superseded, true)
  assert.deepEqual(calls, ['replace:A1-running'])
  firstWrite.resolve()
  await Promise.all([runningA1, writeA2])

  assert.deepEqual(calls, ['replace:A1-running', 'replace:A2'])
  assert.equal(records.get(IDENTITY).revision, 'A2')
})

test('delete failure keeps the old generation tombstoned while a new generation may proceed', async () => {
  const calls = []
  const store = {
    async replace(_identityKey, checkpoint) {
      calls.push(`replace:${checkpoint.revision}`)
      return { ok: true, operation: 'replace' }
    },
    async delete() {
      calls.push('delete-failed')
      return { ok: false, operation: 'delete', error: new Error('blocked') }
    },
  }
  const roundA = createSerializedSoloRecoveryWriter({
    store,
    identityKey: IDENTITY,
  })
  const deletion = roundA.delete()
  const roundB = createSerializedSoloRecoveryWriter({
    store,
    identityKey: IDENTITY,
    startBarrier: deletion,
  })

  assert.equal((await roundA.replace({ revision: 'stale-A' })).closed, true)
  assert.equal((await deletion).ok, false)
  assert.equal((await roundB.replace({ revision: 'B' })).ok, true)
  assert.deepEqual(calls, ['delete-failed', 'replace:B'])
})

test('identity-bound writers cannot cross-write another identity', async () => {
  const calls = []
  const store = {
    async replace(identityKey, checkpoint) {
      calls.push([identityKey, checkpoint.revision])
      return { ok: true, operation: 'replace' }
    },
    async delete(identityKey) {
      calls.push([identityKey, 'delete'])
      return { ok: true, operation: 'delete' }
    },
  }
  const userA = createSerializedSoloRecoveryWriter({
    store,
    identityKey: IDENTITY,
  })
  const userBIdentity = 'user:22222222-2222-4222-8222-222222222222'
  const userB = createSerializedSoloRecoveryWriter({
    store,
    identityKey: userBIdentity,
  })

  await userA.replace({ revision: 'A-latest' })
  await userA.shutdown()
  assert.equal((await userA.replace({ revision: 'stale-A' })).closed, true)
  await userB.replace({ revision: 'B' })

  assert.deepEqual(calls, [
    [IDENTITY, 'A-latest'],
    [userBIdentity, 'B'],
  ])
})

test('one write failure is reported once and never rejects gameplay callers', async () => {
  const failures = []
  const store = {
    async replace() {
      throw new Error('disk unavailable')
    },
    async delete() {
      return { ok: false, operation: 'delete', error: new Error('still down') }
    },
  }
  const writer = createSerializedSoloRecoveryWriter({
    store,
    identityKey: IDENTITY,
    onFailure: (error) => failures.push(error.message),
  })

  const write = await writer.replace({ revision: 'A' })
  const deletion = await writer.delete()

  assert.equal(write.ok, false)
  assert.equal(deletion.ok, false)
  assert.deepEqual(failures, ['disk unavailable'])
})

test('timed-out retired writers detach failure callbacks and drain waiters', async () => {
  const operations = []
  const failures = []
  const writers = []
  const store = {
    replace() {
      const operation = deferred()
      operations.push(operation)
      return operation.promise
    },
    async delete() {
      return { ok: true, operation: 'delete' }
    },
  }

  for (let writerGeneration = 1; writerGeneration <= 5; writerGeneration += 1) {
    const writer = createSerializedSoloRecoveryWriter({
      store,
      identityKey: `user:${String(writerGeneration).padStart(8, '0')}-1111-4111-8111-111111111111`,
      writerGeneration,
      onFailure: () => failures.push(writerGeneration),
      shutdownTimeoutMs: 0,
    })
    writers.push(writer)
    void writer.replace({ writerGeneration })
    const shutdown = await writer.shutdown()

    assert.equal(shutdown.timedOut, true)
    assert.equal(writer.isAccepting(), false)
    assert.deepEqual(writer.getDiagnostics(), {
      accepting: false,
      applicationWaiterCount: 0,
      detached: true,
      drainWaiterCount: 0,
      queuedOperationCount: 0,
      running: true,
      terminal: false,
      writerGeneration,
    })
  }

  operations.forEach((operation) => operation.resolve({
    ok: false,
    operation: 'replace',
    error: new Error('late failure'),
  }))
  await Promise.resolve()
  await Promise.resolve()

  assert.deepEqual(failures, [])
  assert.equal(writers.every(
    (writer) => (
      writer.getDiagnostics().drainWaiterCount === 0 &&
      writer.getDiagnostics().applicationWaiterCount === 0
    ),
  ), true)
})

test('detached delete result keeps the internal same-identity ordering barrier', async () => {
  const firstWrite = deferred()
  const calls = []
  const store = {
    async replace(_identityKey, checkpoint) {
      calls.push(`replace:${checkpoint.revision}`)
      if (checkpoint.revision === 'A') {
        await firstWrite.promise
      }
      return { ok: true, operation: 'replace' }
    },
    async delete() {
      calls.push('delete')
      return { ok: true, operation: 'delete' }
    },
  }
  const roundA = createSerializedSoloRecoveryWriter({
    store,
    identityKey: IDENTITY,
    shutdownTimeoutMs: 0,
  })
  void roundA.replace({ revision: 'A' })
  const deletion = roundA.delete()
  const roundB = createSerializedSoloRecoveryWriter({
    store,
    identityKey: IDENTITY,
    startBarrier: deletion.barrier,
  })
  const writeB = roundB.replace({ revision: 'B' })

  assert.equal((await roundA.shutdown()).timedOut, true)
  assert.equal((await deletion).timedOut, true)
  assert.deepEqual(calls, ['replace:A'])

  firstWrite.resolve()
  await writeB
  assert.deepEqual(calls, ['replace:A', 'delete', 'replace:B'])
})
