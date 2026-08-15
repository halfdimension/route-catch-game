const DEFAULT_SHUTDOWN_TIMEOUT_MS = 250

export function createSoloRecoveryWriterOrderingRegistry() {
  const barriersByIdentity = new Map()

  return {
    getBarrier(identityKey) {
      return barriersByIdentity.get(identityKey)?.barrier ?? null
    },
    registerBarrier(identityKey, barrier) {
      const previousBarrier = barriersByIdentity.get(identityKey)?.barrier
      const orderedBarrier = previousBarrier
        ? Promise.all([previousBarrier, barrier])
        : barrier
      const entry = { barrier: orderedBarrier }
      barriersByIdentity.set(identityKey, entry)
      void orderedBarrier.then(() => {
        if (barriersByIdentity.get(identityKey) === entry) {
          barriersByIdentity.delete(identityKey)
        }
      })
    },
  }
}

function closedResult(operation, reason = 'closed') {
  return {
    ok: false,
    operation,
    closed: true,
    reason,
  }
}

export function createSerializedSoloRecoveryWriter({
  store,
  identityKey,
  writerGeneration = 0,
  onFailure,
  startBarrier = null,
  orderingRegistry = null,
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
}) {
  let accepting = true
  let terminalDeleteRequested = false
  let running = false
  let currentOperation = null
  let queue = []
  const drainWaiters = new Set()
  let failureReported = false
  const inheritedStartBarrier = startBarrier ??
    orderingRegistry?.getBarrier(identityKey) ?? null
  let barrierPassed = inheritedStartBarrier == null
  let failureReporter = onFailure
  let detached = false

  function reportFailure(result) {
    if (result?.ok !== false || result?.closed || failureReported) {
      return
    }

    failureReported = true
    try {
      failureReporter?.(result.error)
    } catch {
      // Recovery reporting must never interfere with gameplay.
    }
  }

  function resolveOperation(operation, result) {
    operation.resolve(result)
    operation.applicationAttached = false
    operation.resolveBarrier?.(result)
  }

  function supersedeQueuedReplacements() {
    const retainedOperations = []
    queue.forEach((operation) => {
      if (operation.type === 'replace') {
        resolveOperation(operation, {
          ok: true,
          operation: 'replace',
          superseded: true,
        })
      } else {
        retainedOperations.push(operation)
      }
    })
    queue = retainedOperations
  }

  function notifyDrainWaiters() {
    if (running || queue.length > 0) {
      return
    }

    drainWaiters.forEach((resolve) => resolve())
    drainWaiters.clear()
  }

  function pump() {
    if (running) {
      return
    }

    running = true
    void (async () => {
      if (!barrierPassed) {
        try {
          await inheritedStartBarrier
        } catch {
          // Writer operation results never reject, but a caller-provided
          // barrier must not create an unhandled rejection.
        }
        barrierPassed = true
      }

      while (queue.length > 0) {
        const operation = queue.shift()
        currentOperation = operation
        let result

        try {
          result = operation.type === 'replace'
            ? await store.replace(identityKey, operation.checkpoint)
            : await store.delete(identityKey)
        } catch (error) {
          result = { ok: false, operation: operation.type, error }
        }

        reportFailure(result)
        resolveOperation(operation, result)
        currentOperation = null
      }
    })().finally(() => {
      running = false
      if (queue.length > 0) {
        pump()
      } else {
        notifyDrainWaiters()
      }
    })
  }

  function createOperation(type, overrides = {}) {
    let resolveApplication
    let resolveBarrier
    const promise = new Promise((resolve) => {
      resolveApplication = resolve
    })
    const barrier = new Promise((resolve) => {
      resolveBarrier = resolve
    })
    Object.defineProperty(promise, 'barrier', {
      value: barrier,
    })
    orderingRegistry?.registerBarrier(identityKey, barrier)
    return {
      applicationAttached: true,
      type,
      resolve: resolveApplication,
      resolveBarrier,
      promise,
      ...overrides,
    }
  }

  function enqueueReplace(checkpoint, { requireCommit = false } = {}) {
    if (!accepting || terminalDeleteRequested) {
      return Promise.resolve(closedResult(
        'replace',
        terminalDeleteRequested ? 'terminal-delete' : 'closed',
      ))
    }

    const nextOperation = createOperation('replace', {
      checkpoint,
      requireCommit,
    })
    const lastOperation = queue.at(-1)

    if (
      lastOperation?.type === 'replace' &&
      lastOperation.requireCommit !== true
    ) {
      resolveOperation(lastOperation, {
        ok: true,
        operation: 'replace',
        superseded: true,
      })
      Object.assign(lastOperation, nextOperation)
    } else {
      queue.push(nextOperation)
    }

    pump()
    return nextOperation.promise
  }

  function enqueueDelete({ internal = false } = {}) {
    if (terminalDeleteRequested) {
      const existingDelete = queue.find(
        (operation) => operation.type === 'delete',
      )
      return existingDelete?.promise ?? Promise.resolve(
        closedResult('delete', 'terminal-delete'),
      )
    }
    if (!accepting && !internal) {
      return Promise.resolve(closedResult('delete'))
    }

    // Tombstone the generation synchronously. A callback that runs after this
    // line can no longer enqueue a replacement, even if deletion later fails.
    terminalDeleteRequested = true
    accepting = false
    supersedeQueuedReplacements()

    const operation = createOperation('delete')
    queue.push(operation)
    pump()
    return operation.promise
  }

  function close({ discardQueuedReplacements = false } = {}) {
    accepting = false
    if (discardQueuedReplacements) {
      supersedeQueuedReplacements()
    }
  }

  async function waitForDrain(timeoutMs) {
    if (!running && queue.length === 0) {
      return { drained: true, timedOut: false }
    }

    return new Promise((resolve) => {
      let timeoutId = null
      let settled = false
      const finish = (result) => {
        if (settled) {
          return
        }
        settled = true
        drainWaiters.delete(onDrained)
        if (timeoutId !== null) {
          globalThis.clearTimeout(timeoutId)
        }
        resolve(result)
      }
      const onDrained = () => finish({ drained: true, timedOut: false })
      drainWaiters.add(onDrained)

      if (Number.isFinite(timeoutMs) && timeoutMs >= 0) {
        timeoutId = globalThis.setTimeout(
          () => finish({ drained: false, timedOut: true }),
          timeoutMs,
        )
      }

      notifyDrainWaiters()
    })
  }

  function detachApplicationContinuations() {
    detached = true
    failureReporter = null

    const timeoutResult = (operation) => ({
      ok: false,
      operation: operation.type,
      timedOut: true,
    })
    if (currentOperation) {
      currentOperation.resolve(timeoutResult(currentOperation))
      currentOperation.resolve = () => {}
      currentOperation.applicationAttached = false
    }
    queue.forEach((operation) => {
      operation.resolve(timeoutResult(operation))
      operation.resolve = () => {}
      operation.applicationAttached = false
    })
  }

  return {
    identityKey,
    writerGeneration,
    replace: enqueueReplace,
    replaceDurably: (checkpoint) => enqueueReplace(
      checkpoint,
      { requireCommit: true },
    ),
    delete: enqueueDelete,
    ready: () => inheritedStartBarrier ?? Promise.resolve({ ok: true }),
    close,
    isAccepting: () => accepting && !terminalDeleteRequested,
    isTerminal: () => terminalDeleteRequested,
    getDiagnostics: () => ({
      accepting: accepting && !terminalDeleteRequested,
      applicationWaiterCount:
        (currentOperation?.applicationAttached ? 1 : 0) +
        queue.filter((operation) => operation.applicationAttached).length,
      detached,
      drainWaiterCount: drainWaiters.size,
      queuedOperationCount: queue.length,
      running,
      terminal: terminalDeleteRequested,
      writerGeneration,
    }),
    drain: () => waitForDrain(Number.POSITIVE_INFINITY),
    async shutdown({
      deleteCheckpoint = false,
      timeoutMs = shutdownTimeoutMs,
    } = {}) {
      let deletion = null
      if (deleteCheckpoint && !terminalDeleteRequested) {
        deletion = enqueueDelete({ internal: true })
      } else {
        close()
      }

      const drain = await waitForDrain(timeoutMs)
      if (drain.timedOut) {
        detachApplicationContinuations()
      }
      return {
        ...drain,
        deletion: deletion && !drain.timedOut ? await deletion : null,
      }
    },
  }
}
