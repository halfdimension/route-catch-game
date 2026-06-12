function CatchToast({ caughtTarget }) {
  if (!caughtTarget) {
    return null
  }

  return (
    <div className="catch-toast" role="status" aria-live="polite">
      Caught {caughtTarget.symbol} {caughtTarget.name}! +{caughtTarget.score}
    </div>
  )
}

export default CatchToast
