export const SOLO_GUEST_INSTALLATION_STORAGE_KEY =
  'routeCatchSoloGuestInstallationId'

export const SOLO_RECOVERY_IDENTITY_STATUS = Object.freeze({
  UNRESOLVED: 'UNRESOLVED',
  AUTHENTICATED: 'AUTHENTICATED',
  GUEST: 'GUEST',
})

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function createAuthenticatedSoloIdentityKey(userId) {
  if (!isUuid(userId)) {
    throw new TypeError('Authenticated SOLO recovery requires a valid user UUID')
  }

  return `user:${userId.toLowerCase()}`
}

export function createGuestSoloIdentityKey(installationId) {
  if (!isUuid(installationId)) {
    throw new TypeError('Guest SOLO recovery requires a valid installation UUID')
  }

  return `guest:${installationId.toLowerCase()}`
}

export function parseSoloIdentityKey(identityKey) {
  if (typeof identityKey !== 'string') {
    return null
  }

  const separatorIndex = identityKey.indexOf(':')

  if (separatorIndex <= 0) {
    return null
  }

  const kind = identityKey.slice(0, separatorIndex)
  const subjectId = identityKey.slice(separatorIndex + 1)

  if ((kind !== 'user' && kind !== 'guest') || !isUuid(subjectId)) {
    return null
  }

  return {
    kind,
    subjectId: subjectId.toLowerCase(),
    identityKey: `${kind}:${subjectId.toLowerCase()}`,
  }
}

export function isValidSoloIdentityKey(identityKey) {
  const parsed = parseSoloIdentityKey(identityKey)
  return parsed !== null && parsed.identityKey === identityKey
}

export function getOrCreateGuestSoloIdentityKey({
  storage = globalThis.localStorage,
  randomUuid = () => globalThis.crypto.randomUUID(),
} = {}) {
  let installationId = null

  try {
    installationId = storage?.getItem?.(
      SOLO_GUEST_INSTALLATION_STORAGE_KEY,
    )
  } catch {
    // Storage can be unavailable. The generated identity still isolates this
    // runtime, although it cannot survive a reload without localStorage.
  }

  if (!isUuid(installationId)) {
    installationId = randomUuid()

    if (!isUuid(installationId)) {
      throw new TypeError('Guest installation UUID generator returned invalid data')
    }

    try {
      storage?.setItem?.(
        SOLO_GUEST_INSTALLATION_STORAGE_KEY,
        installationId,
      )
    } catch {
      // Recovery degrades to this runtime's ephemeral guest identity.
    }
  }

  return createGuestSoloIdentityKey(installationId)
}

export function resolveSoloRecoveryIdentity({
  loadingAuth,
  isAuthenticated,
  currentUser,
  storage = globalThis.localStorage,
  randomUuid = () => globalThis.crypto.randomUUID(),
}) {
  if (loadingAuth !== false) {
    return Object.freeze({
      status: SOLO_RECOVERY_IDENTITY_STATUS.UNRESOLVED,
      identityKey: null,
    })
  }

  if (isAuthenticated === true) {
    return Object.freeze({
      status: SOLO_RECOVERY_IDENTITY_STATUS.AUTHENTICATED,
      identityKey: createAuthenticatedSoloIdentityKey(currentUser?.userId),
    })
  }

  if (isAuthenticated !== false) {
    throw new TypeError('Resolved authentication state must be explicit')
  }

  return Object.freeze({
    status: SOLO_RECOVERY_IDENTITY_STATUS.GUEST,
    identityKey: getOrCreateGuestSoloIdentityKey({ storage, randomUuid }),
  })
}
