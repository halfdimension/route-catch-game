import { useState } from 'react'
import GameHistoryPanel from './GameHistoryPanel'
import LeaderboardPanel from './LeaderboardPanel'
import PlayerStatsPanel from './PlayerStatsPanel'

function StatsDrawer({ activeSessionId, playerName, refreshVersion }) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('leaderboard')

  return (
    <section
      className="stats-drawer"
      aria-label="Game statistics"
    >
      <button
        type="button"
        className="stats-drawer-trigger"
        onClick={() => setIsOpen(true)}
        aria-expanded={isOpen}
      >
        <span>Stats</span>
      </button>

      {isOpen && (
        <div className="stats-overlay" role="presentation">
          <div className="stats-overlay-panel" role="dialog" aria-modal="true">
            <div className="stats-drawer-header">
              <p>Stats</p>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="stats-drawer-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'leaderboard'}
                className={
                  activeTab === 'leaderboard' ? 'is-active' : undefined
                }
                onClick={() => setActiveTab('leaderboard')}
              >
                Leaderboard
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'history'}
                className={activeTab === 'history' ? 'is-active' : undefined}
                onClick={() => setActiveTab('history')}
              >
                History
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'my-stats'}
                className={activeTab === 'my-stats' ? 'is-active' : undefined}
                onClick={() => setActiveTab('my-stats')}
              >
                My Stats
              </button>
            </div>

            <div className="stats-drawer-content">
              <div hidden={activeTab !== 'leaderboard'}>
                <LeaderboardPanel refreshVersion={refreshVersion} />
              </div>
              <div hidden={activeTab !== 'history'}>
                <GameHistoryPanel
                  activeSessionId={activeSessionId}
                  refreshVersion={refreshVersion}
                />
              </div>
              <div hidden={activeTab !== 'my-stats'}>
                <PlayerStatsPanel
                  playerName={playerName}
                  refreshVersion={refreshVersion}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default StatsDrawer
