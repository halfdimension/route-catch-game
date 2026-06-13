import { getRarityClassName } from '../utils/rarityStyles'

function CatchToast({ caughtTarget }) {
  if (!caughtTarget) {
    return null
  }

  const rarityClassName = getRarityClassName(caughtTarget.rarity)

  return (
    <div
      className={`catch-toast ${rarityClassName}`}
      role="status"
      aria-live="polite"
    >
      <span className="catch-toast-symbol">{caughtTarget.symbol}</span>
      <span className="catch-toast-message">
        <strong>+{caughtTarget.score}</strong>
        <span>{caughtTarget.name} caught!</span>
      </span>
      <span className={`rarity-badge ${rarityClassName}`}>
        {caughtTarget.rarity}
      </span>
    </div>
  )
}

export default CatchToast
