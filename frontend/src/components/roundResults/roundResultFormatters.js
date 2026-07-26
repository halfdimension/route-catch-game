const END_REASON_LABELS = {
  TIME_EXPIRED: 'Time expired',
  HOST_ENDED: 'Host ended the round',
  ROOM_CLOSED: 'Room closed',
}

export function formatUnknownReason(reason) {
  const normalizedReason = String(reason || '').trim()

  if (!normalizedReason) {
    return 'Round completed'
  }

  return normalizedReason
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (character) => character.toUpperCase())
}

export function formatRoundEndReason(reason) {
  return END_REASON_LABELS[reason] || formatUnknownReason(reason)
}
