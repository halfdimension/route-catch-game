function MoveConfirmPanel({ destination, onConfirm, onCancel }) {
  return (
    <section className="move-confirm-panel" aria-label="Confirm movement">
      <p>Move here?</p>
      <span>
        {destination.lat.toFixed(5)}, {destination.lon.toFixed(5)}
      </span>
      <div className="move-confirm-actions">
        <button type="button" className="primary-button" onClick={onConfirm}>
          Yes
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  )
}

export default MoveConfirmPanel
