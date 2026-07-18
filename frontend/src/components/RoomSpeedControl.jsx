import {
  DEFAULT_SIMULATION_SPEED,
  MIN_SIMULATION_SPEED,
} from '../config/gameConfig'

function clampSpeed(speed, maxSpeedMps) {
  const numericSpeed = Number(speed)
  const numericMaxSpeed = Number(maxSpeedMps)
  const safeMaxSpeed = Number.isFinite(numericMaxSpeed)
    ? Math.max(MIN_SIMULATION_SPEED, numericMaxSpeed)
    : MIN_SIMULATION_SPEED

  if (!Number.isFinite(numericSpeed)) {
    return Math.min(DEFAULT_SIMULATION_SPEED, safeMaxSpeed)
  }

  return Math.min(safeMaxSpeed, Math.max(MIN_SIMULATION_SPEED, numericSpeed))
}

function RoomSpeedControl({
  currentSpeedMps,
  maxSpeedMps,
  allowPlayerSpeedControl,
  onSpeedChange,
}) {
  const effectiveMaxSpeedMps = Math.max(
    MIN_SIMULATION_SPEED,
    Number(maxSpeedMps) || MIN_SIMULATION_SPEED,
  )
  const displayedSpeedMps = clampSpeed(currentSpeedMps, effectiveMaxSpeedMps)

  function handleSpeedChange(event) {
    onSpeedChange?.(clampSpeed(event.target.value, effectiveMaxSpeedMps))
  }

  return (
    <section className="room-speed-control" aria-label="Player speed">
      <div className="room-speed-control-header">
        <p>Player Speed</p>
        <span>Max {effectiveMaxSpeedMps} m/s</span>
      </div>

      {allowPlayerSpeedControl ? (
        <label className="room-speed-control-input">
          <span>{displayedSpeedMps} m/s</span>
          <div>
            <input
              type="range"
              min={MIN_SIMULATION_SPEED}
              max={effectiveMaxSpeedMps}
              step="10"
              value={displayedSpeedMps}
              onChange={handleSpeedChange}
            />
            <input
              type="number"
              min={MIN_SIMULATION_SPEED}
              max={effectiveMaxSpeedMps}
              step="10"
              value={displayedSpeedMps}
              onChange={handleSpeedChange}
            />
          </div>
        </label>
      ) : (
        <p className="room-speed-readonly">{displayedSpeedMps} m/s</p>
      )}
    </section>
  )
}

export default RoomSpeedControl
