import { getRarityClassName } from '../../utils/rarityStyles'

const catchTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
})

function formatCatchTime(caughtAt) {
  const caughtDate = new Date(caughtAt)

  return Number.isNaN(caughtDate.getTime())
    ? 'Time unavailable'
    : catchTimeFormatter.format(caughtDate)
}

function CaughtCreatureCollection({ creatures = [] }) {
  return (
    <section
      className="round-results-catches"
      aria-labelledby="round-catches-heading"
    >
      <div className="round-results-section-heading">
        <h2 id="round-catches-heading">Your catches</h2>
        <span>{creatures.length}</span>
      </div>

      {creatures.length === 0 ? (
        <p className="round-results-empty">
          No creatures caught this round. The next one is yours.
        </p>
      ) : (
        <ul>
          {creatures.map((creature) => {
            const rarityClassName = getRarityClassName(creature.rarity)

            return (
              <li key={creature.instanceId} className={rarityClassName}>
                <div>
                  <strong title={creature.name}>{creature.name}</strong>
                  <span className={`rarity-badge ${rarityClassName}`}>
                    {String(creature.rarity || 'Unknown').toLowerCase()}
                  </span>
                </div>
                <div className="round-results-catch-meta">
                  <strong>+{creature.scoreAwarded}</strong>
                  <time dateTime={creature.caughtAt}>
                    {formatCatchTime(creature.caughtAt)}
                  </time>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default CaughtCreatureCollection
