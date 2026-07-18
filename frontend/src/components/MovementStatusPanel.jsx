function MovementStatusPanel({
  isMoving,
  onCancel,
  simulationSpeed,
  status,
}) {
  const displayedStatus = status || (isMoving ? 'Moving' : 'Idle')
  const canCancel = Boolean(
    onCancel && (status ? status === 'MOVING' : isMoving),
  )

  return (
    <section className="movement-status-panel" aria-label="Movement status">
      <p>{displayedStatus}</p>
      <span>{simulationSpeed} m/s</span>
      {canCancel && (
        <button type="button" onClick={onCancel}>
          Cancel route
        </button>
      )}
    </section>
  )
}

export default MovementStatusPanel
