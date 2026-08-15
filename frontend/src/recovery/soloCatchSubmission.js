export const SOLO_CATCH_SUBMISSION_FAILURE_KINDS = Object.freeze({
  ACK_PERSISTENCE: 'ACK_PERSISTENCE',
  RESPONSE_IDENTITY: 'RESPONSE_IDENTITY',
  RETRYABLE: 'RETRYABLE',
  TERMINAL: 'TERMINAL',
})

export class SoloCatchResponseIdentityError extends Error {
  constructor(catchId, responseCatchId) {
    super('Backend catch response did not match the submitted catch ID')
    this.name = 'SoloCatchResponseIdentityError'
    this.catchId = catchId
    this.responseCatchId = responseCatchId ?? null
    this.failureKind =
      SOLO_CATCH_SUBMISSION_FAILURE_KINDS.RESPONSE_IDENTITY
  }
}

export function responseConfirmsSoloCatch(response, catchId) {
  return Boolean(
    response &&
    typeof catchId === 'string' &&
    response.catchId === catchId,
  )
}

export function classifySoloCatchSubmissionError(error) {
  if (
    error?.failureKind ===
      SOLO_CATCH_SUBMISSION_FAILURE_KINDS.RESPONSE_IDENTITY
  ) {
    return SOLO_CATCH_SUBMISSION_FAILURE_KINDS.RESPONSE_IDENTITY
  }

  const status = Number(error?.status)
  if (
    !Number.isFinite(status) ||
    status === 429 ||
    status >= 500
  ) {
    return SOLO_CATCH_SUBMISSION_FAILURE_KINDS.RETRYABLE
  }

  return SOLO_CATCH_SUBMISSION_FAILURE_KINDS.TERMINAL
}

function failureResult({
  response = null,
  error = null,
  failureKind,
  durability,
}) {
  return {
    response,
    error,
    failureKind,
    submitted: true,
    confirmed: false,
    acknowledged: false,
    stale: false,
    durability,
  }
}

export async function submitLiveSoloCatchOnce({
  submission,
  submitBackendCatch,
  isSubmissionScopeCurrent,
  acknowledgePendingCatch,
  onSynchronizationFailure,
}) {
  const {
    caughtTarget,
    pendingCatch,
    scope,
    durability,
  } = submission ?? {}
  if (
    !caughtTarget ||
    !pendingCatch?.catchId ||
    typeof submitBackendCatch !== 'function'
  ) {
    return {
      response: null,
      submitted: false,
      confirmed: false,
      acknowledged: false,
      stale: false,
    }
  }

  const durabilityResult = await durability
  if (
    durabilityResult?.stale ||
    (
      durabilityResult?.durable !== true &&
      durabilityResult?.degraded !== true
    ) ||
    isSubmissionScopeCurrent?.(scope) === false
  ) {
    return {
      response: null,
      submitted: false,
      confirmed: false,
      acknowledged: false,
      stale: true,
      durability: durabilityResult,
    }
  }

  let response
  try {
    response = await submitBackendCatch(
      pendingCatch.catchId,
      pendingCatch.creatureId,
    )
  } catch (error) {
    if (isSubmissionScopeCurrent?.(scope) === false) {
      return {
        response: null,
        error,
        submitted: true,
        confirmed: false,
        acknowledged: false,
        stale: true,
        durability: durabilityResult,
      }
    }
    const failureKind = classifySoloCatchSubmissionError(error)
    onSynchronizationFailure?.({
      catchId: pendingCatch.catchId,
      error,
      failureKind,
      scope,
    })
    return failureResult({
      error,
      failureKind,
      durability: durabilityResult,
    })
  }

  if (isSubmissionScopeCurrent?.(scope) === false) {
    return {
      response,
      submitted: true,
      confirmed: false,
      acknowledged: false,
      stale: true,
      durability: durabilityResult,
    }
  }

  if (!responseConfirmsSoloCatch(response, pendingCatch.catchId)) {
    const error = new SoloCatchResponseIdentityError(
      pendingCatch.catchId,
      response?.catchId,
    )
    onSynchronizationFailure?.({
      catchId: pendingCatch.catchId,
      error,
      failureKind: error.failureKind,
      scope,
    })
    return failureResult({
      response: response ?? null,
      error,
      failureKind: error.failureKind,
      durability: durabilityResult,
    })
  }

  const acknowledgement = await acknowledgePendingCatch?.(scope)
  if (acknowledgement?.stale === true) {
    return {
      response,
      submitted: true,
      confirmed: true,
      acknowledged: false,
      stale: true,
      acknowledgement,
      durability: durabilityResult,
    }
  }

  if (
    acknowledgement?.acknowledged !== true ||
    acknowledgement?.durable === false
  ) {
    const failureKind =
      SOLO_CATCH_SUBMISSION_FAILURE_KINDS.ACK_PERSISTENCE
    onSynchronizationFailure?.({
      catchId: pendingCatch.catchId,
      error: acknowledgement?.error ?? null,
      failureKind,
      scope,
    })
    return {
      ...failureResult({
        response,
        error: acknowledgement?.error ?? null,
        failureKind,
        durability: durabilityResult,
      }),
      confirmed: true,
      acknowledgement,
    }
  }

  return {
    response,
    submitted: true,
    confirmed: true,
    stale: false,
    acknowledged: true,
    acknowledgement,
    durability: durabilityResult,
  }
}
