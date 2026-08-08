import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listMultiplayerRoundHistory } from '../api/multiplayerRoundHistoryClient'
import { getRoundResult } from '../api/multiplayerRoundResultClient'
import RoundResultsModal from './roundResults/RoundResultsModal'
import {
  formatMultiplayerRoundDate,
  formatMultiplayerRoundDuration,
  formatMultiplayerRoundEndReason,
  formatMultiplayerRoundRank,
} from './multiplayerRoundHistoryFormatters'
import {
  createMultiplayerRoundHistoryController,
  createMultiplayerRoundHistoryInitialState,
  getMultiplayerRoundHistoryPagination,
  isMultiplayerHistoryAuthStateCurrent,
} from './multiplayerRoundHistoryState'

function MultiplayerHistorySkeleton() {
  return (
    <div
      className="multiplayer-history-skeleton"
      role="status"
      aria-label="Loading multiplayer history"
    >
      {[0, 1, 2].map((index) => (
        <span key={index} aria-hidden="true" />
      ))}
    </div>
  )
}

function MultiplayerRoundHistoryItem({ round, onViewResult }) {
  const completedAt = formatMultiplayerRoundDate(round.endedAt)

  return (
    <li className="multiplayer-history-item">
      <article aria-labelledby={`multiplayer-round-${round.roundId}`}>
        <div className="multiplayer-history-round">
          <span>Room</span>
          <h3 id={`multiplayer-round-${round.roundId}`} title={round.roomCode}>
            {round.roomCode}
          </h3>
          <time dateTime={round.endedAt}>{completedAt}</time>
          <small>{formatMultiplayerRoundEndReason(round.endReason)}</small>
        </div>

        <dl className="multiplayer-history-stats">
          <div className="is-rank">
            <dt>Rank</dt>
            <dd>{formatMultiplayerRoundRank(round.rank, round.participantCount)}</dd>
          </div>
          <div className="is-score">
            <dt>Score</dt>
            <dd>{round.score}</dd>
          </div>
          <div className="is-catches">
            <dt>Catches</dt>
            <dd>{round.creaturesCaught}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{formatMultiplayerRoundDuration(round.durationSeconds)}</dd>
          </div>
        </dl>

        <button
          type="button"
          className="multiplayer-history-view"
          aria-label={`View result for room ${round.roomCode}, completed ${completedAt}`}
          onClick={() => onViewResult(round)}
        >
          View result
        </button>
      </article>
    </li>
  )
}

function MultiplayerRoundHistoryPanel({
  authIdentity,
  isAuthenticated,
  token,
  onAuthExpired,
  refreshVersion,
}) {
  const panelRef = useRef(null)
  const authContextMarker = useMemo(
    () => (token ? {} : null),
    [token],
  )
  const [state, setState] = useState(
    createMultiplayerRoundHistoryInitialState,
  )
  const [controller] = useState(() => (
    createMultiplayerRoundHistoryController({
      getResult: getRoundResult,
      listHistory: listMultiplayerRoundHistory,
      onAuthExpired,
      onStateChange: setState,
    })
  ))

  useEffect(() => {
    controller.updateContext({
      authContextMarker,
      authIdentity,
      isAuthenticated,
      refreshVersion,
      token,
    })
  }, [
    authContextMarker,
    authIdentity,
    controller,
    isAuthenticated,
    refreshVersion,
    token,
  ])

  useEffect(() => () => controller.destroy(), [controller])

  const loadPage = useCallback((page) => {
    if (page < 0 || state.isHistoryLoading) {
      return
    }

    controller.loadPage(page)
    panelRef.current?.focus({ preventScroll: true })
    panelRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [controller, state.isHistoryLoading])

  const rounds = state.history?.content || []
  const totalElements = state.history?.totalElements ?? 0
  const totalPages = state.history?.totalPages ?? 0
  const { canGoNext, canGoPrevious } = getMultiplayerRoundHistoryPagination({
    history: state.history,
    isLoading: state.isHistoryLoading,
    page: state.page,
  })
  const isInitialLoading = state.isHistoryLoading && !state.history
  const hasCurrentAuthState = isMultiplayerHistoryAuthStateCurrent({
    authContextMarker,
    authIdentity,
    isAuthenticated,
    stateAuthIdentity: state.authIdentity,
    stateAuthContextMarker: state.authContextMarker,
    token,
  })
  const completedAtLabel = state.selectedRound
    ? formatMultiplayerRoundDate(state.selectedRound.endedAt)
    : ''

  return (
    <section
      ref={panelRef}
      className="multiplayer-history-panel"
      aria-labelledby="multiplayer-history-heading"
      aria-busy={state.isHistoryLoading}
      tabIndex="-1"
    >
      <div className="multiplayer-history-header">
        <div>
          <h2 id="multiplayer-history-heading">Multiplayer history</h2>
          <p>
            Completed room rounds remain available here after the room ends.
          </p>
        </div>
        {hasCurrentAuthState && state.history && (
          <span>{totalElements} {totalElements === 1 ? 'round' : 'rounds'}</span>
        )}
      </div>

      {!isAuthenticated || !token ? (
        <p className="multiplayer-history-empty" role="status">
          Sign in to view your completed multiplayer rounds.
        </p>
      ) : !hasCurrentAuthState ? (
        <MultiplayerHistorySkeleton />
      ) : (
        <>
          {state.historyError && (
            <div className="multiplayer-history-error" role="alert">
              <span>{state.historyError}</span>
              <button
                type="button"
                onClick={controller.retryHistory}
                disabled={state.isHistoryLoading}
              >
                Retry
              </button>
            </div>
          )}

          {state.isHistoryLoading && state.pendingPage !== null && state.history && (
            <p className="multiplayer-history-loading-page" role="status">
              Loading page {state.pendingPage + 1}…
            </p>
          )}

          {isInitialLoading ? (
            <MultiplayerHistorySkeleton />
          ) : rounds.length === 0 ? (
            <p className="multiplayer-history-empty" role="status">
              {totalElements === 0
                ? 'No completed multiplayer rounds yet.'
                : 'No completed multiplayer rounds on this page.'}
            </p>
          ) : (
            <ul className={
              state.isHistoryLoading
                ? 'multiplayer-history-list is-refreshing'
                : 'multiplayer-history-list'
            }>
              {rounds.map((round) => (
                <MultiplayerRoundHistoryItem
                  key={round.roundId}
                  round={round}
                  onViewResult={controller.openResult}
                />
              ))}
            </ul>
          )}

          {(state.history || state.historyError) && (
            <nav
              className="multiplayer-history-pagination"
              aria-label="Multiplayer history pages"
            >
              <button
                type="button"
                onClick={() => loadPage(state.page - 1)}
                disabled={!canGoPrevious}
                aria-label="Previous multiplayer history page"
              >
                Previous
              </button>
              <span aria-live="polite">
                Page {state.page + 1}{totalPages > 0 ? ` of ${totalPages}` : ''}
              </span>
              <button
                type="button"
                onClick={() => loadPage(state.page + 1)}
                disabled={!canGoNext || state.isHistoryLoading}
                aria-label="Next multiplayer history page"
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}

      {hasCurrentAuthState && state.isResultOpen && (
        <RoundResultsModal
          result={state.detailResult}
          error={state.detailError}
          isLoading={state.isDetailLoading}
          isFinalizing={false}
          isHost={false}
          canPlayAgain={false}
          isActionPending={false}
          historical
          historicalContext={{
            completedAt: completedAtLabel,
            roomCode: state.selectedRound?.roomCode,
          }}
          focusFallbackRef={panelRef}
          onClose={controller.closeResult}
          onRetry={controller.retryDetail}
        />
      )}
    </section>
  )
}

export default MultiplayerRoundHistoryPanel
