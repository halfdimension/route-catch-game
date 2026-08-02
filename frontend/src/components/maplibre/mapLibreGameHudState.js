import { getRarityClassName } from '../../utils/rarityStyles.js'

export const MAPLIBRE_HUD_WARNING_SECONDS = 15

export function resolveMapLibreDebugControlsEnabled(configuredValue) {
  return String(configuredValue ?? '').trim().toLowerCase() === 'true'
}

export const MAPLIBRE_DEBUG_CONTROLS_ENABLED =
  resolveMapLibreDebugControlsEnabled(
    import.meta.env?.VITE_ENABLE_DEBUG_CONTROLS,
  )

export function getMapLibreRoundViewState({
  gameState,
  remainingSeconds,
  selectedRoundSeconds,
}) {
  const rawSeconds =
    gameState === 'running' ? remainingSeconds : selectedRoundSeconds
  const totalSeconds = Math.max(0, Number(rawSeconds) || 0)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)

  return {
    timeLabel: `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
    stateLabel:
      gameState === 'running'
        ? 'Round live'
        : gameState === 'ended'
          ? 'Round complete'
          : 'Ready to explore',
    isWarning:
      gameState === 'running' &&
      totalSeconds <= MAPLIBRE_HUD_WARNING_SECONDS,
  }
}

export function getMapLibreTargetViewState(
  target,
  chasedTargetId,
  routingTargetId,
  now = Date.now(),
) {
  const isChased = target.id === chasedTargetId
  const isRouting = target.id === routingTargetId

  return {
    rarityClassName: getRarityClassName(target.rarity),
    remainingSeconds: Math.max(
      0,
      Math.ceil((Number(target.expiresAt) - now) / 1000),
    ),
    isChased,
    isRouting,
    statusLabel: isRouting ? 'Routing' : isChased ? 'Chasing' : target.difficulty,
  }
}

export function getNonChasedMapLibreTargets(targets, chasedTargetId) {
  return targets.filter((target) => target.id !== chasedTargetId)
}

export function stopMapLibreHudEvent(event) {
  event.stopPropagation()
}

export function handleMapLibreHudTargetClick(event, target, onTargetClick) {
  stopMapLibreHudEvent(event)
  onTargetClick(target)
}

export function handleMapLibreHudCancelChase(event, onCancelChase) {
  stopMapLibreHudEvent(event)
  onCancelChase()
}
