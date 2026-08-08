import { formatRoundEndReason } from './roundResults/roundResultFormatters.js'

const completedAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function formatMultiplayerRoundDate(timestamp) {
  const date = new Date(timestamp)

  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : completedAtFormatter.format(date)
}

export function formatMultiplayerRoundDuration(durationSeconds) {
  const seconds = Number(durationSeconds)

  if (!Number.isFinite(seconds) || seconds < 0) {
    return 'Duration unavailable'
  }

  const wholeSeconds = Math.round(seconds)
  const minutes = Math.floor(wholeSeconds / 60)
  const remainingSeconds = wholeSeconds % 60

  if (minutes === 0) {
    return `${remainingSeconds} sec`
  }

  if (remainingSeconds === 0) {
    return `${minutes} min`
  }

  return `${minutes} min ${remainingSeconds} sec`
}

export function formatMultiplayerRoundRank(rank, participantCount) {
  return `#${rank} of ${participantCount}`
}

export function formatMultiplayerRoundEndReason(reason) {
  if (reason === 'HOST_ENDED') {
    return 'Host ended'
  }

  return formatRoundEndReason(reason)
}
