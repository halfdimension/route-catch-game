function getRemainingSeconds(target) {
  return Math.max(0, Math.ceil((target.expiresAt - Date.now()) / 1000))
}

function TargetConfirmPanel({ target, onConfirm, onCancel, isLoading }) {
  return (
    <section className="move-confirm-panel" aria-label="Confirm target movement">
      <p>{isLoading ? 'Fetching route...' : 'Move to target?'}</p>
      <div className="target-confirm-details">
        <strong>{target.name}</strong>
        <span>Rarity: {target.rarity}</span>
        <span>Score: {target.score}</span>
        <span>Expires in: {getRemainingSeconds(target)}s</span>
      </div>
      <div className="move-confirm-actions">
        <button
          type="button"
          className="primary-button"
          onClick={onConfirm}
          disabled={isLoading}
        >
          {isLoading ? 'Loading' : 'Yes'}
        </button>
        <button type="button" onClick={onCancel} disabled={isLoading}>
          Cancel
        </button>
      </div>
    </section>
  )
}

export default TargetConfirmPanel
