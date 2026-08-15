export async function startSoloGameplayRound({
  recovery,
  backend,
  durationSeconds,
  playerName,
  onStarted,
}) {
  const operation = recovery.beginRoundOperation()
  if (!operation) {
    return { started: false, reason: 'busy-or-not-ready' }
  }

  try {
    const runningBackendSession = await backend.beginSession(
      durationSeconds,
      playerName,
      {
        shouldApply: () => recovery.isOperationCurrent(
          operation,
          { requireLaunch: true },
        ),
      },
    )
    if (
      !runningBackendSession ||
      !recovery.isOperationCurrent(operation, { requireLaunch: true })
    ) {
      return { started: false, stale: true }
    }

    const established = await recovery.establishRound(
      runningBackendSession,
      operation,
    )
    if (
      !established.timeline ||
      established.stale ||
      !recovery.isOperationCurrent(operation, { requireLaunch: true })
    ) {
      return { started: false, stale: true }
    }

    onStarted?.(established.timeline)
    return {
      started: true,
      scope: established.scope,
      timeline: established.timeline,
    }
  } finally {
    recovery.completeRoundOperation(operation)
  }
}

export async function restartSoloGameplayRound({
  recovery,
  backend,
  durationSeconds,
  playerName,
  resetRuntime,
  onStarted,
}) {
  const restart = recovery.beginRestartOperation()
  if (!restart) {
    return { started: false, reason: 'busy-or-not-ready' }
  }
  const { scope: operation, cleanup } = restart

  backend.invalidateSessionOperations()
  resetRuntime?.()

  try {
    const cleanupResult = await cleanup
    if (!recovery.isOperationCurrent(operation, { requireLaunch: true })) {
      return { started: false, stale: true, cleanup: cleanupResult }
    }

    const runningBackendSession = await backend.replaceSession(
      durationSeconds,
      playerName,
      {
        shouldApply: () => recovery.isOperationCurrent(
          operation,
          { requireLaunch: true },
        ),
      },
    )
    if (
      !runningBackendSession ||
      !recovery.isOperationCurrent(operation, { requireLaunch: true })
    ) {
      return { started: false, stale: true, cleanup: cleanupResult }
    }

    const established = await recovery.establishRound(
      runningBackendSession,
      operation,
    )
    if (
      !established.timeline ||
      established.stale ||
      !recovery.isOperationCurrent(operation, { requireLaunch: true })
    ) {
      return { started: false, stale: true, cleanup: cleanupResult }
    }

    onStarted?.(established.timeline)
    return {
      started: true,
      cleanup: cleanupResult,
      scope: established.scope,
      timeline: established.timeline,
    }
  } finally {
    recovery.completeRoundOperation(operation)
  }
}

export async function resetSoloGameplayRound({
  recovery,
  backend,
  resetRuntime,
}) {
  const resettingScope = recovery.captureActiveRoundScope()
  const persistenceCleanup = recovery.resetRound()

  backend.invalidateSessionOperations({ clearSession: true })
  resetRuntime?.()

  // Start the request immediately with A's captured ID. This detached helper
  // never reads or mutates whichever backend session becomes current later.
  const backendCleanup = backend.finishSessionById(
    resettingScope?.backendSessionId,
  )
  const [persistence, backendEnded] = await Promise.all([
    persistenceCleanup,
    backendCleanup,
  ])

  return {
    backendEnded,
    persistence,
    scope: resettingScope,
  }
}

export async function finishSoloGameplayRound({
  recovery,
  backend,
  scope,
  failureMessage,
}) {
  if (!scope) {
    return { stale: true }
  }

  const backendEnded = await backend.finishSession(failureMessage, {
    expectedSessionId: scope.backendSessionId,
    shouldApply: () => recovery.isActiveRoundScopeCurrent(scope),
  })
  const shouldRefreshHistory = Boolean(
    backendEnded && recovery.isActiveRoundScopeCurrent(scope),
  )
  const persistence = await recovery.finishRound({
    backendEnded,
    expectedScope: scope,
  })

  return {
    backendEnded,
    persistence,
    scope,
    shouldRefreshHistory,
    stale: persistence.stale === true,
  }
}
