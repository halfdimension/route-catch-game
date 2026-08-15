import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  endGameSession,
  getGameSession,
} from '../api/gameSessionClient.js'
import {
  SOLO_RECOVERY_MOVEMENT_PHASES,
  SOLO_RECOVERY_MOVEMENT_PURPOSES,
  SOLO_RECOVERED_CATCH_OUTBOX_SUBMISSION_ENABLED,
  SOLO_RECOVERY_ROUND_PHASES,
  createSoloClientRoundId,
} from '../recovery/soloRecoveryCheckpoint.js'
import {
  SOLO_RECOVERY_IDENTITY_STATUS,
  createAuthenticatedSoloIdentityKey,
  resolveSoloRecoveryIdentity,
} from '../recovery/soloRecoveryIdentity.js'
import {
  SOLO_RECOVERY_BOOTSTRAP_KINDS,
  SOLO_RECOVERY_BOOTSTRAP_STATES,
  SOLO_RECOVERY_UNAVAILABLE_WARNING,
  bootstrapSoloRecovery,
  buildSoloRunningCheckpoint,
  createBackendSoloRoundTimeline,
  createSoloReconcilingCheckpoint,
  isBackendSessionCompatibleWithIdentity,
} from '../recovery/soloRecoveryRuntime.js'
import { createSoloRecoveryStore } from '../recovery/soloRecoveryStore.js'
import {
  createSerializedSoloRecoveryWriter,
  createSoloRecoveryWriterOrderingRegistry,
} from '../recovery/soloRecoveryWriter.js'
import {
  SOLO_CATCH_SUBMISSION_FAILURE_KINDS,
  submitLiveSoloCatchOnce,
} from '../recovery/soloCatchSubmission.js'
import {
  acknowledgeSoloPendingCatch,
  applySoloTargetCatchTransition,
  applySoloTargetExpiryTransition,
} from '../recovery/soloTargetState.js'
import { resolveSoloLiveCatchInterval } from '../utils/soloRouteCatchEvents.js'

const RECOVERY_OPERATION_TIMEOUT_MS = 250
const SOLO_CATCH_SYNC_WARNING =
  'Some catches are saved locally but could not be synchronized.'

function roundMatchesScope(checkpoint, scope) {
  return Boolean(
    checkpoint &&
    scope &&
    checkpoint.identityKey === scope.identityKey &&
    checkpoint.round.clientRoundId === scope.clientRoundId &&
    checkpoint.round.backendSessionId === scope.backendSessionId,
  )
}

export function orderSoloPendingCatches(pendingCatches) {
  return [...(pendingCatches ?? [])].sort((left, right) => (
    left.caughtAtEpochMs - right.caughtAtEpochMs ||
    left.catchId.localeCompare(right.catchId)
  ))
}

function catchSubmissionScopeKey(scope) {
  return [
    scope.identityKey,
    scope.lifecycleGeneration,
    scope.replayGeneration,
    scope.clientRoundId,
    scope.backendSessionId,
    scope.writerGeneration,
    scope.catchId,
  ].join('|')
}

function persistenceSucceeded(result) {
  return result?.ok === true && result?.timedOut !== true
}

async function waitBounded(promise, timeoutMs = RECOVERY_OPERATION_TIMEOUT_MS) {
  let timeoutId
  const timeout = new Promise((resolve) => {
    timeoutId = globalThis.setTimeout(
      () => resolve({ ok: false, timedOut: true }),
      timeoutMs,
    )
  })
  const result = await Promise.race([promise, timeout])
  globalThis.clearTimeout(timeoutId)
  return result
}

export function useSoloRoundRecovery({
  loadingAuth,
  isAuthenticated,
  currentUser,
  hydrateRound,
  hydratePlayer,
  hydrateGameplay,
  resetRuntime,
  adoptBackendSession,
  getRuntimeSnapshot,
  submitBackendCatchForSession,
  recoveryStore,
  getBackendSession = getGameSession,
  endBackendSession = endGameSession,
  getEpochTimeMs = Date.now,
} = {}) {
  const [store] = useState(
    () => recoveryStore ?? createSoloRecoveryStore(),
  )
  const [writerOrderingRegistry] = useState(
    () => createSoloRecoveryWriterOrderingRegistry(),
  )
  const [bootstrapState, setBootstrapState] = useState(
    SOLO_RECOVERY_BOOTSTRAP_STATES.AUTH_UNRESOLVED,
  )
  const [warning, setWarning] = useState('')
  const [catchReplayWarning, setCatchReplayWarning] = useState('')
  const [identityKey, setIdentityKey] = useState(null)
  const [replayTriggerVersion, setReplayTriggerVersion] = useState(0)
  const bootstrapStateRef = useRef(bootstrapState)
  const identityKeyRef = useRef(null)
  const guestIdentityKeyRef = useRef(null)
  const previousIdentityKeyRef = useRef(null)
  const writerRef = useRef(null)
  const activeCheckpointRef = useRef(null)
  const writesEnabledRef = useRef(true)
  const bootstrapGenerationRef = useRef(0)
  const lifecycleGenerationRef = useRef(0)
  const replayGenerationRef = useRef(0)
  const replayRetryEpochRef = useRef(0)
  const nextOperationIdRef = useRef(0)
  const nextWriterGenerationRef = useRef(0)
  const activeRoundLaunchRef = useRef(null)
  const bootstrapFlightsRef = useRef(new Map())
  const catchSubmissionFlightsRef = useRef(new Map())
  const catchSubmissionAttemptsRef = useRef(new Map())
  const replayEligibilityRef = useRef(null)
  const shutdownTimerRef = useRef(null)
  const mountedRef = useRef(false)
  const hydrateRoundRef = useRef(hydrateRound)
  const hydratePlayerRef = useRef(hydratePlayer)
  const hydrateGameplayRef = useRef(hydrateGameplay)
  const resetRuntimeRef = useRef(resetRuntime)
  const adoptBackendSessionRef = useRef(adoptBackendSession)
  const getRuntimeSnapshotRef = useRef(getRuntimeSnapshot)
  const submitBackendCatchForSessionRef = useRef(
    submitBackendCatchForSession,
  )

  useLayoutEffect(() => {
    hydrateRoundRef.current = hydrateRound
    hydratePlayerRef.current = hydratePlayer
    hydrateGameplayRef.current = hydrateGameplay
    resetRuntimeRef.current = resetRuntime
    adoptBackendSessionRef.current = adoptBackendSession
    getRuntimeSnapshotRef.current = getRuntimeSnapshot
    submitBackendCatchForSessionRef.current = submitBackendCatchForSession
  }, [
    adoptBackendSession,
    getRuntimeSnapshot,
    hydratePlayer,
    hydrateGameplay,
    hydrateRound,
    resetRuntime,
    submitBackendCatchForSession,
  ])

  const updateBootstrapState = useCallback((nextState) => {
    bootstrapStateRef.current = nextState
    setBootstrapState(nextState)
  }, [])

  const reportStorageFailure = useCallback((scope) => {
    if (
      !scope ||
      (
        !mountedRef.current ||
        identityKeyRef.current !== scope.identityKey ||
        (scope.lifecycleGeneration !== undefined &&
          lifecycleGenerationRef.current !== scope.lifecycleGeneration) ||
        writerRef.current !== scope.writer ||
        writerRef.current?.writerGeneration !== scope.writerGeneration
      )
    ) {
      return false
    }

    writesEnabledRef.current = false
    setWarning(SOLO_RECOVERY_UNAVAILABLE_WARNING)
    return true
  }, [])

  const createWriter = useCallback((nextIdentityKey, startBarrier = null) => {
    const writerGeneration = nextWriterGenerationRef.current + 1
    nextWriterGenerationRef.current = writerGeneration
    let writer
    writer = createSerializedSoloRecoveryWriter({
      store,
      identityKey: nextIdentityKey,
      writerGeneration,
      startBarrier,
      orderingRegistry: writerOrderingRegistry,
      onFailure: () => reportStorageFailure({
        identityKey: nextIdentityKey,
        writer,
        writerGeneration,
      }),
    })
    return writer
  }, [reportStorageFailure, store, writerOrderingRegistry])

  const invalidateLifecycle = useCallback(() => {
    lifecycleGenerationRef.current += 1
    replayGenerationRef.current += 1
    replayEligibilityRef.current = null
    catchSubmissionAttemptsRef.current.clear()
    activeRoundLaunchRef.current = null
    return lifecycleGenerationRef.current
  }, [])

  const isOperationCurrent = useCallback((scope, {
    requireLaunch = false,
  } = {}) => Boolean(
    scope &&
    mountedRef.current &&
    identityKeyRef.current === scope.identityKey &&
    lifecycleGenerationRef.current === scope.lifecycleGeneration &&
    (scope.replayGeneration === undefined ||
      replayGenerationRef.current === scope.replayGeneration) &&
    (!scope.writer || writerRef.current === scope.writer) &&
    (scope.writerGeneration === undefined ||
      writerRef.current?.writerGeneration === scope.writerGeneration) &&
    (!requireLaunch || activeRoundLaunchRef.current?.operationId ===
      scope.operationId),
  ), [])

  const isBootstrapScopeCurrent = useCallback((scope) => Boolean(
    scope &&
    scope.effectState.active &&
    mountedRef.current &&
    bootstrapGenerationRef.current === scope.bootstrapGeneration &&
    lifecycleGenerationRef.current === scope.lifecycleGeneration &&
    identityKeyRef.current === scope.identityKey &&
    writerRef.current === scope.writer &&
    scope.writer.writerGeneration === scope.writerGeneration &&
    bootstrapFlightsRef.current.get(scope.identityKey) === scope.flight &&
    scope.flight.ownerScope === scope
  ), [])

  const isActiveRoundScopeCurrent = useCallback((scope) => (
    isOperationCurrent(scope) &&
    roundMatchesScope(activeCheckpointRef.current, scope)
  ), [isOperationCurrent])

  const terminalDeleteAndRotateWriter = useCallback(() => {
    const oldWriter = writerRef.current
    const currentIdentityKey = identityKeyRef.current
    if (!oldWriter || !currentIdentityKey) {
      return Promise.resolve({ ok: true, operation: 'delete', skipped: true })
    }

    const deletion = oldWriter.delete()
    writerRef.current = createWriter(
      currentIdentityKey,
      deletion.barrier ?? deletion,
    )
    void oldWriter.shutdown().catch(() => {})
    return deletion
  }, [createWriter])

  const captureCurrentWriterScope = useCallback(() => {
    const writer = writerRef.current
    return writer && identityKeyRef.current
      ? {
          identityKey: identityKeyRef.current,
          lifecycleGeneration: lifecycleGenerationRef.current,
          replayGeneration: replayGenerationRef.current,
          writer,
          writerGeneration: writer.writerGeneration,
        }
      : null
  }, [])

  const monitorPersistenceOperation = useCallback(async (
    operation,
    scope,
  ) => {
    const persistence = await waitBounded(operation)
    const persistenceAvailable = persistenceSucceeded(persistence)
    if (!persistenceAvailable) {
      reportStorageFailure(scope)
    }
    return {
      ...persistence,
      persistenceAvailable,
    }
  }, [reportStorageFailure])

  useLayoutEffect(() => {
    mountedRef.current = true
    if (shutdownTimerRef.current !== null) {
      window.clearTimeout(shutdownTimerRef.current)
      shutdownTimerRef.current = null
    }

    return () => {
      mountedRef.current = false
      bootstrapGenerationRef.current += 1
      invalidateLifecycle()
      shutdownTimerRef.current = window.setTimeout(() => {
        const writer = writerRef.current
        writer?.close()
        if (!writer) {
          store.close()
          return
        }

        void writer.shutdown({
          timeoutMs: RECOVERY_OPERATION_TIMEOUT_MS,
        }).finally(() => store.close())
      }, 0)
    }
  }, [invalidateLifecycle, store])

  useLayoutEffect(() => {
    const generation = bootstrapGenerationRef.current + 1
    bootstrapGenerationRef.current = generation
    const effectState = { active: true }
    let bootstrapScopeForRun = null

    if (loadingAuth !== false) {
      const previousWriter = writerRef.current
      const previousIdentityKey = identityKeyRef.current
      identityKeyRef.current = null
      invalidateLifecycle()
      activeCheckpointRef.current = null
      if (previousIdentityKey) {
        bootstrapFlightsRef.current.delete(previousIdentityKey)
      }
      previousWriter?.close({ discardQueuedReplacements: true })
      void previousWriter?.shutdown({
        timeoutMs: RECOVERY_OPERATION_TIMEOUT_MS,
      }).catch(() => {})
      resetRuntimeRef.current?.()
      adoptBackendSessionRef.current?.(null)
      return () => {
        effectState.active = false
      }
    }

    const identity =
      isAuthenticated === false && guestIdentityKeyRef.current
        ? {
            status: SOLO_RECOVERY_IDENTITY_STATUS.GUEST,
            identityKey: guestIdentityKeyRef.current,
          }
        : resolveSoloRecoveryIdentity({
            loadingAuth,
            isAuthenticated,
            currentUser,
          })
    if (identity.status === SOLO_RECOVERY_IDENTITY_STATUS.UNRESOLVED) {
      return () => {
        effectState.active = false
      }
    }

    if (identity.status === SOLO_RECOVERY_IDENTITY_STATUS.GUEST) {
      guestIdentityKeyRef.current = identity.identityKey
    }

    const nextIdentityKey = identity.identityKey
    const previousIdentityKey = previousIdentityKeyRef.current
    const identityChanged = previousIdentityKey !== nextIdentityKey
    identityKeyRef.current = nextIdentityKey

    if (
      !identityChanged &&
      bootstrapStateRef.current === SOLO_RECOVERY_BOOTSTRAP_STATES.READY
    ) {
      return () => {
        effectState.active = false
      }
    }

    const runBootstrap = async () => {
      updateBootstrapState(SOLO_RECOVERY_BOOTSTRAP_STATES.LOADING)
      setWarning('')
      setCatchReplayWarning('')
      setIdentityKey(nextIdentityKey)
      replayEligibilityRef.current = null

      if (identityChanged) {
        const previousWriter = writerRef.current
        const loggedOutToGuest =
          previousIdentityKey?.startsWith('user:') &&
          nextIdentityKey.startsWith('guest:')

        invalidateLifecycle()
        activeCheckpointRef.current = null
        resetRuntimeRef.current?.()
        adoptBackendSessionRef.current?.(null)

        if (previousWriter) {
          if (loggedOutToGuest) {
            void previousWriter.delete()
          } else {
            previousWriter.close({ discardQueuedReplacements: true })
          }
          void previousWriter.shutdown({
            timeoutMs: RECOVERY_OPERATION_TIMEOUT_MS,
          }).catch(() => {})
        }
        if (previousIdentityKey) {
          bootstrapFlightsRef.current.delete(previousIdentityKey)
        }

        previousIdentityKeyRef.current = nextIdentityKey
        writesEnabledRef.current = true
        writerRef.current = createWriter(nextIdentityKey)
      } else if (!writerRef.current?.isAccepting()) {
        writerRef.current = createWriter(nextIdentityKey)
      }

      const lifecycleGeneration = lifecycleGenerationRef.current
      const bootstrapWriter = writerRef.current
      let flight = bootstrapFlightsRef.current.get(nextIdentityKey)
      if (!flight) {
        flight = { ownerScope: null, promise: null }
        bootstrapFlightsRef.current.set(nextIdentityKey, flight)
      }
      const bootstrapScope = Object.freeze({
        identityKey: nextIdentityKey,
        lifecycleGeneration,
        bootstrapGeneration: generation,
        writer: bootstrapWriter,
        writerGeneration: bootstrapWriter.writerGeneration,
        effectState,
        flight,
      })
      bootstrapScopeForRun = bootstrapScope
      flight.ownerScope = bootstrapScope

      if (!flight.promise) {
        flight.promise = (async () => {
          const ordering = await waitBounded(bootstrapWriter.ready())
          if (!isBootstrapScopeCurrent(flight.ownerScope)) {
            return {
              kind: SOLO_RECOVERY_BOOTSTRAP_KINDS.STALE,
              persistenceAvailable: false,
            }
          }
          if (ordering.timedOut) {
            return {
              kind: SOLO_RECOVERY_BOOTSTRAP_KINDS.UNAVAILABLE,
              checkpoint: null,
              timeline: null,
              backendSession: null,
              warning: SOLO_RECOVERY_UNAVAILABLE_WARNING,
              persistenceAvailable: false,
            }
          }
          return bootstrapSoloRecovery({
            identityKey: nextIdentityKey,
            store,
            writer: bootstrapWriter,
            isCurrent: () => isBootstrapScopeCurrent(flight.ownerScope),
            getBackendSession,
            endBackendSession,
            nowEpochMs: getEpochTimeMs(),
          })
        })()
      }

      const bootstrap = await flight.promise
      if (
        bootstrap.kind === SOLO_RECOVERY_BOOTSTRAP_KINDS.STALE ||
        !isBootstrapScopeCurrent(bootstrapScope)
      ) {
        return
      }

      if (
        bootstrap.kind === SOLO_RECOVERY_BOOTSTRAP_KINDS.UNAVAILABLE ||
        bootstrap.persistenceAvailable === false
      ) {
        writesEnabledRef.current = false
      }
      setWarning(bootstrap.warning)
      let gameplayHydration = null
      if (
        bootstrap.kind === SOLO_RECOVERY_BOOTSTRAP_KINDS.RESUME &&
        bootstrap.checkpoint
      ) {
        gameplayHydration = await hydrateGameplayRef.current?.(
          bootstrap.checkpoint,
          { nowEpochMs: getEpochTimeMs() },
        )
        if (!isBootstrapScopeCurrent(bootstrapScope)) {
          return
        }
      }
      activeCheckpointRef.current = bootstrap.checkpoint
      if (bootstrap.checkpoint) {
        replayEligibilityRef.current = {
          identityKey: bootstrap.checkpoint.identityKey,
          lifecycleGeneration,
          replayGeneration: replayGenerationRef.current,
          clientRoundId: bootstrap.checkpoint.round.clientRoundId,
          backendSessionId: bootstrap.checkpoint.round.backendSessionId,
          writer: bootstrapWriter,
          writerGeneration: bootstrapWriter.writerGeneration,
          backendVerified: Boolean(
            bootstrap.backendSession &&
            isBackendSessionCompatibleWithIdentity(
              bootstrap.backendSession,
              bootstrap.checkpoint.identityKey,
            ),
          ),
          durable: bootstrap.persistenceAvailable !== false,
        }
      }

      if (bootstrap.backendSession) {
        adoptBackendSessionRef.current?.(bootstrap.backendSession)
      } else if (bootstrap.kind === SOLO_RECOVERY_BOOTSTRAP_KINDS.RESUME) {
        adoptBackendSessionRef.current?.({
          sessionId: bootstrap.checkpoint.round.backendSessionId,
          status: 'RUNNING',
          durationSeconds: bootstrap.timeline.durationSeconds,
          startedAt: new Date(
            bootstrap.timeline.startedAtEpochMs,
          ).toISOString(),
          endedAt: null,
          score: bootstrap.checkpoint.score,
          caughtCount: bootstrap.checkpoint.caughtTargets.length,
          userId: nextIdentityKey.startsWith('user:')
            ? nextIdentityKey.slice('user:'.length)
            : null,
        })
      }

      if (bootstrap.kind === SOLO_RECOVERY_BOOTSTRAP_KINDS.RESUME) {
        const expectedCheckpoint = bootstrap.checkpoint
        const shouldStartMovement = () => (
          isBootstrapScopeCurrent(bootstrapScope) &&
          roundMatchesScope(activeCheckpointRef.current, {
            identityKey: nextIdentityKey,
            clientRoundId: expectedCheckpoint.round.clientRoundId,
            backendSessionId: expectedCheckpoint.round.backendSessionId,
          }) &&
          gameplayHydration?.isMovementValid?.() !== false &&
          getEpochTimeMs() < expectedCheckpoint.round.endsAtEpochMs
        )
        const movementResult = await hydratePlayerRef.current?.(
          expectedCheckpoint,
          {
            nowEpochMs: getEpochTimeMs(),
            shouldStart: shouldStartMovement,
          },
        )

        if (!isBootstrapScopeCurrent(bootstrapScope)) {
          return
        }
        gameplayHydration?.completeMovementHydration?.(movementResult)

        const recoveredRoutingResolved =
          expectedCheckpoint.movement?.phase ===
            SOLO_RECOVERY_MOVEMENT_PHASES.ROUTING &&
          (
            movementResult?.kind === 'MOVING' ||
            movementResult?.kind === 'SETTLED'
          )
        if (
          movementResult?.kind === 'COMPLETED' ||
          recoveredRoutingResolved
        ) {
          const settledCheckpoint = buildSoloRunningCheckpoint({
            identityKey: nextIdentityKey,
            backendSessionId: expectedCheckpoint.round.backendSessionId,
            timeline: bootstrap.timeline,
            playerPosition: movementResult.position,
            simulationSpeedMetersPerSecond:
              expectedCheckpoint.player.simulationSpeedMetersPerSecond,
            movement:
              movementResult.kind === 'MOVING'
                ? movementResult.movement
                : null,
            gameplayState: getRuntimeSnapshotRef.current?.({
              advanceMovement: false,
            }),
            previousCheckpoint: expectedCheckpoint,
            nowEpochMs: getEpochTimeMs(),
          })
          activeCheckpointRef.current = settledCheckpoint
          if (writesEnabledRef.current) {
            if (!isBootstrapScopeCurrent(bootstrapScope)) {
              return
            }
            await bootstrapWriter.replace(settledCheckpoint)
            if (!isBootstrapScopeCurrent(bootstrapScope)) {
              return
            }
          }
        }

        if (
          isBootstrapScopeCurrent(bootstrapScope) &&
          getEpochTimeMs() < bootstrap.timeline.endsAtEpochMs
        ) {
          hydrateRoundRef.current?.(bootstrap.timeline)
        }
      }

      if (isBootstrapScopeCurrent(bootstrapScope)) {
        updateBootstrapState(SOLO_RECOVERY_BOOTSTRAP_STATES.READY)
      }
    }

    void runBootstrap().catch(() => {
      if (isBootstrapScopeCurrent(bootstrapScopeForRun)) {
        writesEnabledRef.current = false
        setWarning(SOLO_RECOVERY_UNAVAILABLE_WARNING)
        updateBootstrapState(SOLO_RECOVERY_BOOTSTRAP_STATES.READY)
      }
    }).finally(() => {
      const scope = bootstrapScopeForRun
      if (
        isBootstrapScopeCurrent(scope) &&
        scope.writer.isTerminal()
      ) {
        writerRef.current = createWriter(scope.identityKey)
      }
    })

    return () => {
      effectState.active = false
    }
  }, [
    createWriter,
    currentUser,
    endBackendSession,
    getBackendSession,
    getEpochTimeMs,
    invalidateLifecycle,
    isBootstrapScopeCurrent,
    isAuthenticated,
    loadingAuth,
    store,
    updateBootstrapState,
  ])

  const beginRoundOperation = useCallback(() => {
    if (
      bootstrapStateRef.current !== SOLO_RECOVERY_BOOTSTRAP_STATES.READY ||
      !identityKeyRef.current ||
      !writerRef.current?.isAccepting() ||
      activeRoundLaunchRef.current
    ) {
      return null
    }

    const scope = {
      identityKey: identityKeyRef.current,
      lifecycleGeneration: lifecycleGenerationRef.current,
      replayGeneration: replayGenerationRef.current,
      operationId: nextOperationIdRef.current + 1,
      clientRoundId: createSoloClientRoundId(),
      backendSessionId: null,
      writer: writerRef.current,
      writerGeneration: writerRef.current.writerGeneration,
    }
    nextOperationIdRef.current = scope.operationId
    activeRoundLaunchRef.current = scope
    setCatchReplayWarning('')
    return scope
  }, [])

  const beginRestartOperation = useCallback(() => {
    if (
      bootstrapStateRef.current !== SOLO_RECOVERY_BOOTSTRAP_STATES.READY ||
      !identityKeyRef.current ||
      activeRoundLaunchRef.current
    ) {
      return null
    }

    invalidateLifecycle()
    activeCheckpointRef.current = null
    setCatchReplayWarning('')
    const deletion = terminalDeleteAndRotateWriter()
    const cleanupScope = captureCurrentWriterScope()
    const scope = {
      identityKey: identityKeyRef.current,
      lifecycleGeneration: lifecycleGenerationRef.current,
      replayGeneration: replayGenerationRef.current,
      operationId: nextOperationIdRef.current + 1,
      clientRoundId: createSoloClientRoundId(),
      backendSessionId: null,
      writer: writerRef.current,
      writerGeneration: writerRef.current.writerGeneration,
    }
    nextOperationIdRef.current = scope.operationId
    activeRoundLaunchRef.current = scope
    return {
      scope,
      cleanup: monitorPersistenceOperation(deletion, cleanupScope),
    }
  }, [
    captureCurrentWriterScope,
    invalidateLifecycle,
    monitorPersistenceOperation,
    terminalDeleteAndRotateWriter,
  ])

  const completeRoundOperation = useCallback((scope) => {
    if (activeRoundLaunchRef.current?.operationId === scope?.operationId) {
      activeRoundLaunchRef.current = null
    }
  }, [])

  const establishRound = useCallback(async (backendSession, scope) => {
    const timeline = createBackendSoloRoundTimeline(backendSession)
    if (
      !timeline ||
      !isOperationCurrent(scope, { requireLaunch: true }) ||
      !isBackendSessionCompatibleWithIdentity(
        backendSession,
        scope.identityKey,
      )
    ) {
      return { ok: false, stale: true, timeline: null, checkpoint: null }
    }

    const runtime = getRuntimeSnapshotRef.current?.({
      advanceMovement: false,
    }) ?? {}
    const checkpoint = buildSoloRunningCheckpoint({
      identityKey: scope.identityKey,
      backendSessionId: backendSession.sessionId,
      timeline,
      playerPosition: runtime.playerPosition,
      simulationSpeedMetersPerSecond:
        runtime.simulationSpeedMetersPerSecond,
      movement: null,
      gameplayState: {
        targets: [],
        caughtTargets: [],
        score: 0,
        xp: 0,
        spawning: { paused: false, nextSpawnAtEpochMs: null },
        backendSync: { pendingCatches: [] },
      },
      clientRoundId: scope.clientRoundId,
      nowEpochMs: getEpochTimeMs(),
    })
    const establishedScope = {
      ...scope,
      backendSessionId: backendSession.sessionId,
    }

    let write = { ok: false, skipped: true }
    if (writesEnabledRef.current) {
      write = await waitBounded(scope.writer.replace(checkpoint))
    }

    if (!isOperationCurrent(scope, { requireLaunch: true })) {
      return { ok: false, stale: true, timeline: null, checkpoint: null }
    }
    if (!persistenceSucceeded(write) && writesEnabledRef.current) {
      reportStorageFailure({
        identityKey: scope.identityKey,
        lifecycleGeneration: scope.lifecycleGeneration,
        replayGeneration: scope.replayGeneration,
        writer: scope.writer,
        writerGeneration: scope.writer.writerGeneration,
      })
    }

    activeCheckpointRef.current = checkpoint
    replayEligibilityRef.current = {
      ...establishedScope,
      replayGeneration: scope.replayGeneration,
      durable: persistenceSucceeded(write),
      backendVerified: true,
    }
    return {
      ok: write.ok,
      stale: false,
      timeline,
      checkpoint,
      scope: establishedScope,
    }
  }, [getEpochTimeMs, isOperationCurrent, reportStorageFailure])

  const captureActiveRoundScope = useCallback(() => {
    const checkpoint = activeCheckpointRef.current
    if (!checkpoint || !identityKeyRef.current) {
      return null
    }
    return {
      identityKey: checkpoint.identityKey,
      lifecycleGeneration: lifecycleGenerationRef.current,
      replayGeneration: replayGenerationRef.current,
      clientRoundId: checkpoint.round.clientRoundId,
      backendSessionId: checkpoint.round.backendSessionId,
      writer: writerRef.current,
      writerGeneration: writerRef.current?.writerGeneration,
    }
  }, [])

  const captureRuntimeOperation = useCallback(() => {
    const scope = captureActiveRoundScope()
    if (
      !scope ||
      bootstrapStateRef.current !== SOLO_RECOVERY_BOOTSTRAP_STATES.READY ||
      activeCheckpointRef.current?.round.phase !==
        SOLO_RECOVERY_ROUND_PHASES.RUNNING
    ) {
      return { isCurrent: () => false }
    }
    return {
      ...scope,
      isCurrent: () => (
        isActiveRoundScopeCurrent(scope) &&
        getEpochTimeMs() < activeCheckpointRef.current.round.endsAtEpochMs
      ),
    }
  }, [captureActiveRoundScope, getEpochTimeMs, isActiveRoundScopeCurrent])

  const resolveLiveCatchInterval = useCallback(({
    plan,
    previousDistanceMeters,
    proposedDistanceMeters,
    previousEpochTimeMs,
    proposedEpochTimeMs,
    movementAnchor,
  }) => {
    const checkpoint = activeCheckpointRef.current
    if (
      !checkpoint ||
      checkpoint.round.phase !== SOLO_RECOVERY_ROUND_PHASES.RUNNING ||
      checkpoint.movement?.phase !== SOLO_RECOVERY_MOVEMENT_PHASES.MOVING ||
      bootstrapStateRef.current !== SOLO_RECOVERY_BOOTSTRAP_STATES.READY
    ) {
      return { entries: [], terminal: null }
    }

    return {
      ...resolveSoloLiveCatchInterval({
        plan,
        targets: checkpoint.targets,
        startDistanceMeters: previousDistanceMeters,
        endDistanceMeters: proposedDistanceMeters,
        windowStartEpochMs: previousEpochTimeMs,
        windowEndEpochMs: proposedEpochTimeMs,
        movementAnchor,
        roundEndsAtEpochMs: checkpoint.round.endsAtEpochMs,
        chasedTargetId:
          checkpoint.movement.purpose ===
            SOLO_RECOVERY_MOVEMENT_PURPOSES.CHASE
            ? checkpoint.movement.chasedTargetId
            : null,
      }),
      observedAtEpochMs: proposedEpochTimeMs,
    }
  }, [])

  const queueRuntimeCheckpoint = useCallback((transition = {}) => {
    let checkpoint = activeCheckpointRef.current
    const writer = writerRef.current
    if (
      !checkpoint ||
      checkpoint.round.phase !== SOLO_RECOVERY_ROUND_PHASES.RUNNING ||
      !writesEnabledRef.current ||
      !writer?.isAccepting() ||
      bootstrapStateRef.current !== SOLO_RECOVERY_BOOTSTRAP_STATES.READY
    ) {
      return false
    }

    const nowEpochMs = getEpochTimeMs()
    const isExactRoundTerminalCheckpoint =
      transition.allowRoundTerminal === true &&
      transition.roundTerminalAtEpochMs === checkpoint.round.endsAtEpochMs
    if (
      nowEpochMs >= checkpoint.round.endsAtEpochMs &&
      !isExactRoundTerminalCheckpoint
    ) {
      return false
    }

    const runtime = getRuntimeSnapshotRef.current?.({
      advanceMovement: true,
    }) ?? {}
    const checkpointAdvancedDuringSnapshot =
      activeCheckpointRef.current !== checkpoint
    if (checkpointAdvancedDuringSnapshot) {
      const advancedCheckpoint = activeCheckpointRef.current
      if (
        !advancedCheckpoint ||
        advancedCheckpoint.identityKey !== checkpoint.identityKey ||
        advancedCheckpoint.round.clientRoundId !==
          checkpoint.round.clientRoundId ||
        advancedCheckpoint.round.backendSessionId !==
          checkpoint.round.backendSessionId ||
        advancedCheckpoint.round.phase !==
          SOLO_RECOVERY_ROUND_PHASES.RUNNING
      ) {
        return false
      }
      checkpoint = advancedCheckpoint
    }
    const hasMovementOverride = Object.hasOwn(transition, 'movement')
    const caughtTargetIds = new Set(
      checkpoint.caughtTargets.map((target) => target.id),
    )
    const transitionTargets = transition.targets?.filter(
      (target) => !caughtTargetIds.has(target.id),
    )
    const nextCheckpoint = buildSoloRunningCheckpoint({
      identityKey: checkpoint.identityKey,
      backendSessionId: checkpoint.round.backendSessionId,
      timeline: {
        durationSeconds: checkpoint.round.durationSeconds,
        startedAtEpochMs: checkpoint.round.startedAtEpochMs,
        endsAtEpochMs: checkpoint.round.endsAtEpochMs,
      },
      playerPosition:
        checkpointAdvancedDuringSnapshot
          ? runtime.playerPosition
          : transition.settledPosition ?? runtime.playerPosition,
      simulationSpeedMetersPerSecond:
        transition.simulationSpeedMetersPerSecond ??
        runtime.simulationSpeedMetersPerSecond,
      movement: checkpointAdvancedDuringSnapshot
        ? runtime.movement
        : hasMovementOverride
          ? transition.movement
          : runtime.movement,
      gameplayState: {
        targets: transitionTargets ?? checkpoint.targets,
        caughtTargets:
          checkpointAdvancedDuringSnapshot
            ? checkpoint.caughtTargets
            : transition.caughtTargets ?? checkpoint.caughtTargets,
        score: checkpointAdvancedDuringSnapshot
          ? checkpoint.score
          : transition.score ?? checkpoint.score,
        xp: checkpointAdvancedDuringSnapshot
          ? checkpoint.xp
          : transition.xp ?? checkpoint.xp,
        spawning: transition.spawning ?? checkpoint.spawning,
        backendSync: checkpointAdvancedDuringSnapshot
          ? checkpoint.backendSync
          : transition.backendSync ?? checkpoint.backendSync,
      },
      previousCheckpoint: checkpoint,
      nowEpochMs: Math.max(
        isExactRoundTerminalCheckpoint
          ? transition.roundTerminalAtEpochMs
          : nowEpochMs,
        checkpoint.updatedAtEpochMs,
      ),
    })
    activeCheckpointRef.current = nextCheckpoint
    void writer.replace(nextCheckpoint)
    return true
  }, [getEpochTimeMs])

  const isCatchSubmissionScopeCurrent = useCallback((scope) => {
    const checkpoint = activeCheckpointRef.current
    return Boolean(
      isActiveRoundScopeCurrent(scope) &&
      checkpoint?.caughtTargets.some(
        (target) => target.id === scope.targetId,
      ) &&
      checkpoint?.backendSync.pendingCatches.some(
        (pendingCatch) =>
          pendingCatch.catchId === scope.catchId &&
          pendingCatch.targetId === scope.targetId,
      ),
    )
  }, [isActiveRoundScopeCurrent])

  const persistLiveCatchCheckpoint = useCallback(({
    checkpoint,
    writer,
    scope,
  }) => {
    if (
      !writesEnabledRef.current ||
      !writer?.isAccepting() ||
      typeof writer.replaceDurably !== 'function'
    ) {
      return Promise.resolve({
        durable: false,
        degraded: true,
        disabled: true,
        stale: !isCatchSubmissionScopeCurrent(scope),
      })
    }

    const write = writer.replaceDurably(checkpoint)
    return (async () => {
      const persistence = await waitBounded(write)
      if (!isCatchSubmissionScopeCurrent(scope)) {
        return { ...persistence, durable: false, degraded: false, stale: true }
      }
      if (persistenceSucceeded(persistence)) {
        return { ...persistence, durable: true, degraded: false, stale: false }
      }

      reportStorageFailure(scope)
      return { ...persistence, durable: false, degraded: true, stale: false }
    })()
  }, [isCatchSubmissionScopeCurrent, reportStorageFailure])

  const applyTargetCatchBatch = useCallback(({
    catches,
    checkpointAtEpochMs = getEpochTimeMs(),
    settledPosition,
    movement,
  }) => {
    const checkpoint = activeCheckpointRef.current
    const writer = writerRef.current
    if (
      !checkpoint ||
      checkpoint.round.phase !== SOLO_RECOVERY_ROUND_PHASES.RUNNING ||
      bootstrapStateRef.current !== SOLO_RECOVERY_BOOTSTRAP_STATES.READY ||
      !Array.isArray(catches) ||
      catches.length === 0
    ) {
      return { applied: false, stale: true }
    }
    const runtime = getRuntimeSnapshotRef.current?.({
      advanceMovement: false,
    }) ?? {}
    const hasMovementOverride = movement !== undefined
    let state = {
      ...checkpoint,
      movement: hasMovementOverride
        ? movement
        : runtime.movement ?? checkpoint.movement,
      player: {
        ...checkpoint.player,
        settledPosition:
          settledPosition ?? runtime.playerPosition ??
          checkpoint.player.settledPosition,
      },
    }
    const appliedCatches = []
    let duplicate = false
    catches.forEach((catchEvent) => {
      const transition = applySoloTargetCatchTransition(state, {
        targetId: catchEvent.targetId,
        caughtAtEpochMs: catchEvent.caughtAtEpochMs,
        settledPosition:
          settledPosition ?? runtime.playerPosition ??
          state.player.settledPosition,
      })
      state = transition.state
      duplicate ||= transition.duplicate === true
      if (transition.changed && transition.caughtTarget) {
        appliedCatches.push({
          caughtTarget: transition.caughtTarget,
          chaseStopped: transition.chaseStopped,
        })
      }
    })
    if (appliedCatches.length === 0) {
      return { applied: false, duplicate }
    }
    const nextCheckpoint = buildSoloRunningCheckpoint({
      identityKey: checkpoint.identityKey,
      backendSessionId: checkpoint.round.backendSessionId,
      timeline: {
        durationSeconds: checkpoint.round.durationSeconds,
        startedAtEpochMs: checkpoint.round.startedAtEpochMs,
        endsAtEpochMs: checkpoint.round.endsAtEpochMs,
      },
      playerPosition: state.player.settledPosition,
      simulationSpeedMetersPerSecond:
        runtime.simulationSpeedMetersPerSecond ??
        checkpoint.player.simulationSpeedMetersPerSecond,
      movement: state.movement,
      gameplayState: state,
      previousCheckpoint: checkpoint,
      nowEpochMs: checkpointAtEpochMs,
    })
    activeCheckpointRef.current = nextCheckpoint
    const baseScope = captureActiveRoundScope()
    const submissions = appliedCatches.map((appliedCatch) => {
      const pendingCatch = nextCheckpoint.backendSync.pendingCatches.find(
        (candidate) =>
          candidate.targetId === appliedCatch.caughtTarget.id,
      ) ?? null
      return {
        ...appliedCatch,
        pendingCatch,
        scope: pendingCatch && baseScope
          ? {
              ...baseScope,
              catchId: pendingCatch.catchId,
              targetId: pendingCatch.targetId,
            }
          : null,
      }
    })
    const durabilityScope = submissions[0]?.scope
    const durability = durabilityScope
      ? persistLiveCatchCheckpoint({
          checkpoint: nextCheckpoint,
          writer,
          scope: durabilityScope,
        })
      : Promise.resolve({
          durable: false,
          degraded: true,
          stale: true,
        })
    submissions.forEach((submission) => {
      submission.durability = durability
    })
    return {
      applied: true,
      checkpoint: nextCheckpoint,
      submissions,
      chaseStopped: appliedCatches.some(
        (appliedCatch) => appliedCatch.chaseStopped,
      ),
    }
  }, [captureActiveRoundScope, getEpochTimeMs, persistLiveCatchCheckpoint])

  const applyTargetCatch = useCallback(({
    targetId,
    caughtAtEpochMs = getEpochTimeMs(),
    checkpointAtEpochMs = caughtAtEpochMs,
    settledPosition,
    movement,
  }) => {
    const batch = applyTargetCatchBatch({
      catches: [{ targetId, caughtAtEpochMs }],
      checkpointAtEpochMs,
      settledPosition,
      movement,
    })
    const submission = batch.submissions?.[0]
    return submission
      ? {
          ...batch,
          caughtTarget: submission.caughtTarget,
          pendingCatch: submission.pendingCatch,
          scope: submission.scope,
          durability: submission.durability,
        }
      : batch
  }, [applyTargetCatchBatch, getEpochTimeMs])

  const applyTargetsExpired = useCallback(({
    targetIds,
    expiredAtEpochMs = getEpochTimeMs(),
    settledPosition,
    movement,
    targets,
    spawning,
  }) => {
    let checkpoint = activeCheckpointRef.current
    const writer = writerRef.current
    if (!checkpoint || checkpoint.round.phase !== SOLO_RECOVERY_ROUND_PHASES.RUNNING) {
      return { applied: false, stale: true }
    }
    const runtime = getRuntimeSnapshotRef.current?.({
      advanceMovement: true,
    }) ?? {}
    if (activeCheckpointRef.current !== checkpoint) {
      const advancedCheckpoint = activeCheckpointRef.current
      if (
        !advancedCheckpoint ||
        advancedCheckpoint.identityKey !== checkpoint.identityKey ||
        advancedCheckpoint.round.clientRoundId !==
          checkpoint.round.clientRoundId ||
        advancedCheckpoint.round.backendSessionId !==
          checkpoint.round.backendSessionId ||
        advancedCheckpoint.round.phase !==
          SOLO_RECOVERY_ROUND_PHASES.RUNNING
      ) {
        return { applied: false, stale: true }
      }
      checkpoint = advancedCheckpoint
    }
    let state = {
      ...checkpoint,
      movement: movement !== undefined
        ? movement
        : runtime.movement ?? checkpoint.movement,
      player: {
        ...checkpoint.player,
        settledPosition:
          settledPosition ?? runtime.playerPosition ??
          checkpoint.player.settledPosition,
      },
    }
    let changed = false
    let chaseStopped = false
    targetIds.forEach((targetId) => {
      const transition = applySoloTargetExpiryTransition(state, {
        targetId,
        settledPosition: state.player.settledPosition,
      })
      state = transition.state
      changed ||= transition.changed
      chaseStopped ||= transition.chaseStopped
    })
    if (targets) {
      const caughtTargetIds = new Set(
        state.caughtTargets.map((target) => target.id),
      )
      state = {
        ...state,
        targets: structuredClone(targets).filter(
          (target) => !caughtTargetIds.has(target.id),
        ),
      }
    }
    if (!changed) {
      return { applied: false, chaseStopped }
    }
    const nextCheckpoint = buildSoloRunningCheckpoint({
      identityKey: checkpoint.identityKey,
      backendSessionId: checkpoint.round.backendSessionId,
      timeline: {
        durationSeconds: checkpoint.round.durationSeconds,
        startedAtEpochMs: checkpoint.round.startedAtEpochMs,
        endsAtEpochMs: checkpoint.round.endsAtEpochMs,
      },
      playerPosition: state.player.settledPosition,
      simulationSpeedMetersPerSecond:
        runtime.simulationSpeedMetersPerSecond ??
        checkpoint.player.simulationSpeedMetersPerSecond,
      movement: state.movement,
      gameplayState: {
        ...state,
        spawning: spawning ?? runtime.spawning ?? checkpoint.spawning,
      },
      previousCheckpoint: checkpoint,
      nowEpochMs: expiredAtEpochMs,
    })
    activeCheckpointRef.current = nextCheckpoint
    if (writesEnabledRef.current && writer?.isAccepting()) {
      void writer.replace(nextCheckpoint)
    }
    return { applied: true, checkpoint: nextCheckpoint, chaseStopped }
  }, [getEpochTimeMs])

  const acknowledgePendingCatch = useCallback(async (scope) => {
    const checkpoint = activeCheckpointRef.current
    const writer = writerRef.current
    if (!checkpoint || !scope?.catchId || !isCatchSubmissionScopeCurrent(scope)) {
      return { acknowledged: false, stale: true }
    }
    const pendingCatch = checkpoint.backendSync.pendingCatches.find(
      (candidate) => candidate.catchId === scope.catchId,
    )
    const nextState = acknowledgeSoloPendingCatch(checkpoint, scope.catchId)
    if (nextState === checkpoint) {
      return { acknowledged: false, stale: false, duplicate: true }
    }

    const nowEpochMs = getEpochTimeMs()
    let nextCheckpoint
    if (checkpoint.round.phase === SOLO_RECOVERY_ROUND_PHASES.RECONCILING) {
      nextCheckpoint = createSoloReconcilingCheckpoint(nextState, nowEpochMs)
    } else if (checkpoint.round.phase === SOLO_RECOVERY_ROUND_PHASES.RUNNING) {
      const runtime = getRuntimeSnapshotRef.current?.({
        advanceMovement: false,
      }) ?? {}
      nextCheckpoint = buildSoloRunningCheckpoint({
        identityKey: checkpoint.identityKey,
        backendSessionId: checkpoint.round.backendSessionId,
        timeline: {
          durationSeconds: checkpoint.round.durationSeconds,
          startedAtEpochMs: checkpoint.round.startedAtEpochMs,
          endsAtEpochMs: checkpoint.round.endsAtEpochMs,
        },
        playerPosition:
          runtime.playerPosition ?? checkpoint.player.settledPosition,
        simulationSpeedMetersPerSecond:
          runtime.simulationSpeedMetersPerSecond ??
          checkpoint.player.simulationSpeedMetersPerSecond,
        movement: runtime.movement ?? checkpoint.movement,
        gameplayState: nextState,
        previousCheckpoint: checkpoint,
        nowEpochMs,
      })
    } else {
      return { acknowledged: false, stale: true }
    }

    if (!isActiveRoundScopeCurrent(scope)) {
      return { acknowledged: false, stale: true }
    }

    if (
      !writesEnabledRef.current ||
      !writer?.isAccepting() ||
      typeof writer.replaceDurably !== 'function'
    ) {
      return {
        acknowledged: false,
        stale: false,
        durable: false,
        degraded: true,
        checkpoint,
      }
    }

    // The in-memory removal is optimistic so later gameplay checkpoints cannot
    // reintroduce an ACKed catch behind the serialized durable replacement.
    // A failed replacement restores the same pending identity below.
    activeCheckpointRef.current = nextCheckpoint
    const persistence = await waitBounded(
      writer.replaceDurably(nextCheckpoint),
    )
    if (!isActiveRoundScopeCurrent(scope)) {
      return { acknowledged: false, stale: true }
    }
    const durable = persistenceSucceeded(persistence)
    if (!durable) {
      const currentCheckpoint = activeCheckpointRef.current
      if (
        pendingCatch &&
        roundMatchesScope(currentCheckpoint, scope) &&
        !currentCheckpoint.backendSync.pendingCatches.some(
          (candidate) => candidate.catchId === pendingCatch.catchId,
        )
      ) {
        activeCheckpointRef.current = {
          ...currentCheckpoint,
          backendSync: {
            ...currentCheckpoint.backendSync,
            pendingCatches: [
              ...currentCheckpoint.backendSync.pendingCatches,
              pendingCatch,
            ],
          },
        }
      }
      reportStorageFailure(scope)
    }
    return {
      ...persistence,
      acknowledged: durable,
      stale: false,
      durable,
      degraded: !durable,
      checkpoint: activeCheckpointRef.current,
    }
  }, [
    getEpochTimeMs,
    isActiveRoundScopeCurrent,
    isCatchSubmissionScopeCurrent,
    reportStorageFailure,
  ])

  const submitPendingCatch = useCallback((submission, {
    retryEpoch = replayRetryEpochRef.current,
  } = {}) => {
    const scope = submission?.scope
    if (
      !submission?.pendingCatch?.catchId ||
      !scope ||
      !isCatchSubmissionScopeCurrent(scope) ||
      typeof submitBackendCatchForSessionRef.current !== 'function'
    ) {
      return Promise.resolve({
        response: null,
        submitted: false,
        confirmed: false,
        acknowledged: false,
        stale: true,
      })
    }

    const flightKey = catchSubmissionScopeKey(scope)
    const existingFlight = catchSubmissionFlightsRef.current.get(flightKey)
    if (existingFlight) {
      return existingFlight.promise
    }

    const previousAttempt = catchSubmissionAttemptsRef.current.get(flightKey)
    const retryablePreviousFailure =
      previousAttempt?.failureKind ===
        SOLO_CATCH_SUBMISSION_FAILURE_KINDS.RETRYABLE ||
      previousAttempt?.failureKind ===
        SOLO_CATCH_SUBMISSION_FAILURE_KINDS.ACK_PERSISTENCE
    if (
      previousAttempt &&
      (!retryablePreviousFailure || retryEpoch <= previousAttempt.retryEpoch)
    ) {
      return Promise.resolve({
        response: null,
        submitted: false,
        confirmed: false,
        acknowledged: false,
        stale: false,
        retrySuppressed: true,
        failureKind: previousAttempt.failureKind,
      })
    }

    const flight = { promise: null }
    catchSubmissionAttemptsRef.current.set(flightKey, {
      failureKind: null,
      retryEpoch,
    })
    flight.promise = (async () => {
      const result = await submitLiveSoloCatchOnce({
        submission,
        submitBackendCatch: (catchId, creatureId) => (
          submitBackendCatchForSessionRef.current(
            scope.backendSessionId,
            catchId,
            creatureId,
            {
              shouldApply: () => isCatchSubmissionScopeCurrent(scope),
            },
          )
        ),
        isSubmissionScopeCurrent: isCatchSubmissionScopeCurrent,
        acknowledgePendingCatch,
      })

      catchSubmissionAttemptsRef.current.set(flightKey, {
        failureKind: result.failureKind ?? null,
        retryEpoch,
      })
      if (!result.stale && isActiveRoundScopeCurrent(scope)) {
        if (result.acknowledged) {
          if (
            activeCheckpointRef.current?.backendSync.pendingCatches.length ===
              0
          ) {
            setCatchReplayWarning('')
          }
        } else if (result.submitted || result.failureKind) {
          setCatchReplayWarning(SOLO_CATCH_SYNC_WARNING)
        }
      }
      return result
    })().finally(() => {
      if (catchSubmissionFlightsRef.current.get(flightKey) === flight) {
        catchSubmissionFlightsRef.current.delete(flightKey)
      }
    })
    catchSubmissionFlightsRef.current.set(flightKey, flight)
    return flight.promise
  }, [
    acknowledgePendingCatch,
    isActiveRoundScopeCurrent,
    isCatchSubmissionScopeCurrent,
  ])

  const retryPendingCatches = useCallback(() => {
    replayRetryEpochRef.current += 1
    setReplayTriggerVersion((version) => version + 1)
  }, [])

  useEffect(() => {
    const browserWindow = globalThis.window
    if (typeof browserWindow?.addEventListener !== 'function') {
      return undefined
    }
    browserWindow.addEventListener('online', retryPendingCatches)
    return () => browserWindow.removeEventListener(
      'online',
      retryPendingCatches,
    )
  }, [retryPendingCatches])

  useEffect(() => {
    const checkpoint = activeCheckpointRef.current
    const eligibility = replayEligibilityRef.current
    if (
      !SOLO_RECOVERED_CATCH_OUTBOX_SUBMISSION_ENABLED ||
      bootstrapState !== SOLO_RECOVERY_BOOTSTRAP_STATES.READY ||
      !checkpoint ||
      !eligibility?.backendVerified ||
      !eligibility.durable ||
      !writesEnabledRef.current ||
      typeof submitBackendCatchForSessionRef.current !== 'function' ||
      getEpochTimeMs() >= checkpoint.expiresAtEpochMs ||
      !roundMatchesScope(checkpoint, eligibility) ||
      !isOperationCurrent(eligibility)
    ) {
      return undefined
    }

    let active = true
    const retryEpoch = replayRetryEpochRef.current
    const runReplayWorker = async () => {
      const pendingCatches = orderSoloPendingCatches(
        checkpoint.backendSync.pendingCatches,
      )
      for (const pendingCatch of pendingCatches) {
        if (!active || !isOperationCurrent(eligibility)) {
          return
        }
        const currentCheckpoint = activeCheckpointRef.current
        const currentPendingCatch =
          currentCheckpoint?.backendSync.pendingCatches.find(
            (candidate) => candidate.catchId === pendingCatch.catchId,
          )
        const caughtTarget = currentCheckpoint?.caughtTargets.find(
          (target) => target.id === pendingCatch.targetId,
        )
        if (!currentPendingCatch || !caughtTarget) {
          continue
        }

        const scope = {
          ...eligibility,
          catchId: currentPendingCatch.catchId,
          targetId: currentPendingCatch.targetId,
        }
        const result = await submitPendingCatch({
          caughtTarget,
          pendingCatch: currentPendingCatch,
          scope,
          durability: Promise.resolve({
            ok: true,
            durable: true,
            degraded: false,
            recovered: true,
          }),
        }, { retryEpoch })
        if (!active || result.stale || !isOperationCurrent(eligibility)) {
          return
        }
        if (
          result.failureKind ===
            SOLO_CATCH_SUBMISSION_FAILURE_KINDS.RETRYABLE ||
          result.failureKind ===
            SOLO_CATCH_SUBMISSION_FAILURE_KINDS.ACK_PERSISTENCE
        ) {
          return
        }
      }
    }

    void runReplayWorker()
    return () => {
      active = false
    }
  }, [
    bootstrapState,
    getEpochTimeMs,
    isOperationCurrent,
    replayTriggerVersion,
    submitPendingCatch,
  ])

  const finishRound = useCallback(async ({ backendEnded, expectedScope }) => {
    const scope = expectedScope ?? captureActiveRoundScope()
    const checkpoint = activeCheckpointRef.current
    const writer = writerRef.current
    if (!isActiveRoundScopeCurrent(scope) || !checkpoint || !writer) {
      return { stale: true }
    }

    const hasPendingCleanup =
      checkpoint.backendSync.pendingCatches.length > 0 || !backendEnded
    if (
      hasPendingCleanup &&
      getEpochTimeMs() < checkpoint.expiresAtEpochMs
    ) {
      const reconciling = createSoloReconcilingCheckpoint(
        checkpoint,
        getEpochTimeMs(),
      )
      if (!isActiveRoundScopeCurrent(scope)) {
        return { stale: true }
      }
      activeCheckpointRef.current = reconciling
      let persistence = { ok: false, disabled: true }
      if (writesEnabledRef.current) {
        persistence = await waitBounded(writer.replace(reconciling))
      }
      if (!isActiveRoundScopeCurrent(scope)) {
        return { stale: true }
      }
      const persistenceAvailable = persistenceSucceeded(persistence)
      if (!persistenceAvailable) {
        reportStorageFailure({
          identityKey: scope.identityKey,
          lifecycleGeneration: scope.lifecycleGeneration,
          replayGeneration: scope.replayGeneration,
          writer,
          writerGeneration: writer.writerGeneration,
        })
      }
      return {
        stale: false,
        reconciled: persistenceAvailable,
        persistenceAvailable,
        timedOut: persistence.timedOut === true,
      }
    }

    if (!isActiveRoundScopeCurrent(scope)) {
      return { stale: true }
    }
    invalidateLifecycle()
    activeCheckpointRef.current = null
    const deletion = terminalDeleteAndRotateWriter()
    const cleanupScope = captureCurrentWriterScope()
    const persistence = await monitorPersistenceOperation(
      deletion,
      cleanupScope,
    )
    return {
      stale: false,
      deleted: persistence.persistenceAvailable,
      persistenceAvailable: persistence.persistenceAvailable,
      timedOut: persistence.timedOut === true,
    }
  }, [
    captureActiveRoundScope,
    getEpochTimeMs,
    invalidateLifecycle,
    isActiveRoundScopeCurrent,
    captureCurrentWriterScope,
    monitorPersistenceOperation,
    reportStorageFailure,
    terminalDeleteAndRotateWriter,
  ])

  const clearRound = useCallback(async () => {
    invalidateLifecycle()
    activeCheckpointRef.current = null
    setCatchReplayWarning('')
    const deletion = terminalDeleteAndRotateWriter()
    const cleanupScope = captureCurrentWriterScope()
    const persistence = await monitorPersistenceOperation(
      deletion,
      cleanupScope,
    )
    return {
      ...persistence,
      deleted: persistence.persistenceAvailable,
    }
  }, [
    captureCurrentWriterScope,
    invalidateLifecycle,
    monitorPersistenceOperation,
    terminalDeleteAndRotateWriter,
  ])

  const renderedIdentityMatches = loadingAuth === false && (
    isAuthenticated === true
      ? identityKey === createAuthenticatedSoloIdentityKey(
          currentUser?.userId,
        )
      : isAuthenticated === false && identityKey?.startsWith('guest:')
  )
  const effectiveBootstrapState =
    renderedIdentityMatches
      ? bootstrapState
      : loadingAuth === false
        ? SOLO_RECOVERY_BOOTSTRAP_STATES.LOADING
        : SOLO_RECOVERY_BOOTSTRAP_STATES.AUTH_UNRESOLVED

  return {
    bootstrapState: effectiveBootstrapState,
    isReady:
      effectiveBootstrapState === SOLO_RECOVERY_BOOTSTRAP_STATES.READY,
    identityKey,
    warning: warning || catchReplayWarning,
    catchReplayWarning,
    beginRoundOperation,
    beginRestartOperation,
    completeRoundOperation,
    isOperationCurrent,
    establishRound,
    captureActiveRoundScope,
    isActiveRoundScopeCurrent,
    captureRuntimeOperation,
    resolveLiveCatchInterval,
    queueRuntimeCheckpoint,
    isCatchSubmissionScopeCurrent,
    applyTargetCatchBatch,
    applyTargetCatch,
    applyTargetsExpired,
    acknowledgePendingCatch,
    submitPendingCatch,
    retryPendingCatches,
    finishRound,
    resetRound: clearRound,
    prepareRestart: clearRound,
  }
}
