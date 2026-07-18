const EARTH_RADIUS_METERS = 6371000

export const PRESENCE_UPDATE_INTERVAL_MS = 200
export const MIN_PRESENCE_MOVEMENT_METERS = 1

function toRadians(degrees) {
  return (degrees * Math.PI) / 180
}

export function getDistanceMeters(source, target) {
  if (!source || !target) {
    return Number.POSITIVE_INFINITY
  }

  const sourceLat = Number(source.lat)
  const sourceLon = Number(source.lon)
  const targetLat = Number(target.lat)
  const targetLon = Number(target.lon)

  if (
    !Number.isFinite(sourceLat) ||
    !Number.isFinite(sourceLon) ||
    !Number.isFinite(targetLat) ||
    !Number.isFinite(targetLon)
  ) {
    return Number.POSITIVE_INFINITY
  }

  const latDelta = toRadians(targetLat - sourceLat)
  const lonDelta = toRadians(targetLon - sourceLon)
  const sourceLatRadians = toRadians(sourceLat)
  const targetLatRadians = toRadians(targetLat)
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(sourceLatRadians) *
      Math.cos(targetLatRadians) *
      Math.sin(lonDelta / 2) ** 2

  return (
    EARTH_RADIUS_METERS *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  )
}

export function normalizePresencePlayers(payload) {
  if (!Array.isArray(payload)) {
    return []
  }

  return payload
    .filter((player) => (
      player &&
      player.userId !== undefined &&
      player.userId !== null &&
      String(player.userId).length > 0 &&
      Number.isFinite(Number(player.lat)) &&
      Number.isFinite(Number(player.lon))
    ))
    .map((player) => ({
      ...player,
      userId: String(player.userId),
    }))
}

function getPresenceTimestamp(player) {
  const value = player?.lastSeenAt

  if (typeof value !== 'string') {
    return null
  }

  const instantMatch = value.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/,
  )

  if (instantMatch) {
    const secondTimestamp = Date.parse(`${instantMatch[1]}Z`)

    if (Number.isFinite(secondTimestamp)) {
      const nanoseconds = (instantMatch[2] || '').padEnd(9, '0')
      return (
        BigInt(secondTimestamp) * 1000000n +
        BigInt(nanoseconds || '0')
      )
    }
  }

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? BigInt(timestamp) * 1000000n : null
}

export function reconcilePresencePlayers(currentPlayers, incomingPlayers) {
  const currentPlayersById = new Map(
    currentPlayers.map((player) => [String(player.userId), player]),
  )
  const acceptedPlayerIds = []
  const rejectedPlayerIds = []
  const players = incomingPlayers.map((incomingPlayer) => {
    const playerId = String(incomingPlayer.userId)
    const currentPlayer = currentPlayersById.get(playerId)

    if (!currentPlayer) {
      acceptedPlayerIds.push(playerId)
      return incomingPlayer
    }

    const currentTimestamp = getPresenceTimestamp(currentPlayer)
    const incomingTimestamp = getPresenceTimestamp(incomingPlayer)
    const isOlderOrEqual =
      currentTimestamp !== null &&
      (incomingTimestamp === null || incomingTimestamp <= currentTimestamp)

    if (isOlderOrEqual) {
      rejectedPlayerIds.push(playerId)
      return currentPlayer
    }

    acceptedPlayerIds.push(playerId)
    return incomingPlayer
  })

  return {
    players,
    acceptedPlayerIds,
    rejectedPlayerIds,
  }
}

export function shouldPublishPresence({
  force = false,
  lastSentPosition,
  lastSentStatus,
  position,
  status,
}) {
  if (force) {
    return true
  }

  return (
    lastSentStatus !== status ||
    getDistanceMeters(lastSentPosition, position) >=
      MIN_PRESENCE_MOVEMENT_METERS
  )
}

export function isCurrentPresenceSubscription({
  client,
  currentClient,
  connectionId,
  currentConnectionId,
  subscriptionGeneration,
  currentSubscriptionGeneration,
  roomId,
  currentRoomId,
}) {
  return (
    client === currentClient &&
    connectionId === currentConnectionId &&
    subscriptionGeneration === currentSubscriptionGeneration &&
    roomId === currentRoomId
  )
}

export function createPresencePublishScheduler({
  intervalMs = PRESENCE_UPDATE_INTERVAL_MS,
  now,
  setTimer,
  clearTimer,
  onAttempt,
}) {
  let lastAttemptAt = Number.NEGATIVE_INFINITY
  let pendingTimer = null
  let attemptHandler = onAttempt

  function cancelPendingTimer() {
    if (pendingTimer !== null) {
      clearTimer(pendingTimer)
      pendingTimer = null
    }
  }

  return {
    cancel() {
      cancelPendingTimer()
    },

    markAttempt() {
      lastAttemptAt = now()
    },

    reset() {
      cancelPendingTimer()
      lastAttemptAt = Number.NEGATIVE_INFINITY
    },

    schedule() {
      if (pendingTimer !== null) {
        return false
      }

      const elapsed = now() - lastAttemptAt
      const delay = Math.max(0, intervalMs - elapsed)
      pendingTimer = setTimer(() => {
        pendingTimer = null
        lastAttemptAt = now()
        attemptHandler()
      }, delay)
      return true
    },

    setOnAttempt(nextAttemptHandler) {
      attemptHandler = nextAttemptHandler
    },
  }
}
