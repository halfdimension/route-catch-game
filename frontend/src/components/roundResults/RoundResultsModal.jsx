import { useEffect, useRef } from 'react'
import CaughtCreatureCollection from './CaughtCreatureCollection'
import PersonalResultSummary from './PersonalResultSummary'
import RaritySummary from './RaritySummary'
import RoundEndReason from './RoundEndReason'
import RoundLeaderboard from './RoundLeaderboard'
import {
  createRoundResultsViewModel,
  getRoundResultsActions,
  returnToRoundLobby,
} from './roundResultsViewModel'

function getErrorDetail(error) {
  if (error?.status === 403) {
    return `403 · ${error.message}`
  }

  if (error?.status === 404) {
    return `404 · ${error.message}`
  }

  return error?.message || 'The result service is temporarily unavailable.'
}

function RoundResultsModal({
  result,
  error,
  isLoading,
  isFinalizing,
  isHost,
  canPlayAgain,
  isActionPending,
  onClose,
  onRetry,
  onReturnToLobby,
  onPlayAgain,
}) {
  const closeButtonRef = useRef(null)
  const dialogRef = useRef(null)

  useEffect(() => {
    const previouslyFocusedElement = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key === 'Tab') {
        const focusableElements = dialogRef.current?.querySelectorAll(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
        )
        const firstElement = focusableElements?.[0]
        const lastElement = focusableElements?.[focusableElements.length - 1]

        if (!firstElement || !lastElement) {
          event.preventDefault()
          return
        }

        if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault()
          lastElement.focus()
        } else if (
          !event.shiftKey &&
          document.activeElement === lastElement
        ) {
          event.preventDefault()
          firstElement.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocusedElement?.focus?.()
    }
  }, [onClose])

  const viewModel = createRoundResultsViewModel(result)
  const {
    caughtCreatures,
    leaderboard,
    personalResult,
    publicResult,
    rarityCounts,
  } = viewModel
  const actions = getRoundResultsActions({
    error,
    isHost,
    isOpen: true,
    result,
    canPlayAgain,
  })
  const showLoading = !result && (isLoading || isFinalizing)

  return (
    <div
      className="round-results-overlay"
      role="presentation"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        ref={dialogRef}
        className="round-results-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="round-results-title"
        aria-describedby="round-results-status"
      >
        <header className="round-results-header">
          <div>
            <span className="round-results-eyebrow">Final standings</span>
            <h1 id="round-results-title">Round Complete</h1>
            {publicResult && (
              <RoundEndReason reason={publicResult.endReason} />
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="round-results-close"
            aria-label="Close results and view map"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div id="round-results-status" className="round-results-content">
          {showLoading && (
            <div className="round-results-loading" role="status">
              <span className="round-results-spinner" aria-hidden="true" />
              <div>
                <strong>Finalizing round</strong>
                <p>Loading the authoritative final results…</p>
              </div>
            </div>
          )}

          {!showLoading && error && !result && (
            <div className="round-results-failure" role="alert">
              <span aria-hidden="true">!</span>
              <div>
                <h2>Unable to load final results</h2>
                <p>{getErrorDetail(error)}</p>
                <button type="button" onClick={onRetry} disabled={isLoading}>
                  {isLoading ? 'Retrying…' : 'Retry'}
                </button>
              </div>
            </div>
          )}

          {publicResult && personalResult && (
            <>
              <PersonalResultSummary result={personalResult} />
              <RaritySummary rarityCounts={rarityCounts} />
              <div className="round-results-detail-grid">
                <RoundLeaderboard
                  entries={leaderboard}
                  currentPlayerId={personalResult.playerId}
                />
                <CaughtCreatureCollection
                  creatures={caughtCreatures}
                />
              </div>
            </>
          )}
        </div>

        <footer className="round-results-actions">
          <button type="button" onClick={onClose}>
            View Map
          </button>
          <button
            type="button"
            onClick={() => returnToRoundLobby(onReturnToLobby)}
          >
            Return to Lobby
          </button>
          {actions.showPlayAgain && (
            <button
              type="button"
              className="primary-button"
              onClick={onPlayAgain}
              disabled={isActionPending}
            >
              {isActionPending ? 'Starting…' : 'Play Again'}
            </button>
          )}
          {actions.showWaitingForHost && (
            <p className="round-results-waiting">
              Waiting for the host to start the next round
            </p>
          )}
        </footer>
      </div>
    </div>
  )
}

export default RoundResultsModal
