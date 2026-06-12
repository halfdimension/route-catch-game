function formatCaughtTime(caughtAt) {
  if (!caughtAt) {
    return 'Unknown time'
  }

  return new Date(caughtAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function CaughtInventoryPanel({ caughtTargets }) {
  return (
    <section className="caught-inventory-panel" aria-label="Caught inventory">
      <p>Catches</p>
      {caughtTargets.length === 0 ? (
        <span>No catches yet</span>
      ) : (
        <ul>
          {caughtTargets.map((target) => (
            <li key={`${target.id}-${target.caughtAt}`}>
              <strong>
                <span className="creature-symbol">{target.symbol}</span>
                {target.name}
              </strong>
              <span>
                {target.type} · {target.rarity} · {target.score} pts ·{' '}
                {target.difficulty}
              </span>
              <span>{target.shortDescription}</span>
              <time dateTime={new Date(target.caughtAt).toISOString()}>
                {formatCaughtTime(target.caughtAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default CaughtInventoryPanel
