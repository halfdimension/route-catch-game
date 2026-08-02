import { getRarityClassName } from '../utils/rarityStyles.js'

function formatScore(score) {
  return Number.isFinite(Number(score)) ? Number(score) : 0
}

function formatValue(value, fallback = 'Unknown') {
  const text = String(value ?? '').trim()

  return text || fallback
}

export function getRemainingTargetSeconds(target, now = Date.now()) {
  const expiresAt = Number(target?.expiresAt)

  if (!Number.isFinite(expiresAt) || !Number.isFinite(now)) {
    return 0
  }

  return Math.max(0, Math.ceil((expiresAt - now) / 1000))
}

export function getTargetMarkerViewModel(
  target,
  {
    isChased = false,
    isRouting = false,
    now = Date.now(),
  } = {},
) {
  const name = formatValue(target?.name, 'Unknown target')
  const rarityLabel = formatValue(target?.rarity)
  const difficultyLabel = isRouting
    ? 'Routing'
    : isChased
      ? 'Chasing'
      : formatValue(target?.difficulty)
  const score = formatScore(target?.score)
  const remainingSeconds = getRemainingTargetSeconds(target, now)
  const rarityClassName = getRarityClassName(target?.rarity)
  const stateClassName = [
    isChased ? 'is-chased' : '',
    isRouting ? 'is-routing' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const chaseClassName = stateClassName ? ` ${stateClassName}` : ''
  const chasedDescription = isChased ? ', currently chased' : ''

  return {
    name,
    rarityLabel,
    difficultyLabel,
    score,
    remainingSeconds,
    rarityClassName,
    chaseClassName,
    isChased,
    isRouting,
    markerClassName:
      `target-creature-marker ${rarityClassName}${chaseClassName}`,
    title: `${name}, ${rarityLabel} target${chasedDescription}`,
    ariaLabel:
      `${name}: ${rarityLabel}, ${score} points, ` +
      `${remainingSeconds} seconds remaining, ${difficultyLabel} difficulty`,
  }
}
