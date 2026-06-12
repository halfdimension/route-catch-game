function MovementStatusPanel({ isMoving, simulationSpeed }) {
  return (
    <section className="movement-status-panel" aria-label="Movement status">
      <p>{isMoving ? 'Moving' : 'Idle'}</p>
      <span>{simulationSpeed} m/s</span>
    </section>
  )
}

export default MovementStatusPanel
