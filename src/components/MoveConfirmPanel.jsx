function MoveConfirmPanel({ destination, onConfirm, onCancel, isLoading }) {
  return (
    <section className="move-confirm-panel" aria-label="Confirm movement">
      <p>{isLoading ? 'Fetching route...' : 'Move here?'}</p>
      <span>
        {destination.lat.toFixed(5)}, {destination.lon.toFixed(5)}
      </span>
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

export default MoveConfirmPanel
