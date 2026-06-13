import { useState } from 'react'
import GameHistoryPanel from './GameHistoryPanel'
import LeaderboardPanel from './LeaderboardPanel'

function StatsDrawer({ activeSessionId, refreshVersion }) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('leaderboard')

  return (
    <section
      className={`stats-drawer${isOpen ? ' is-open' : ''}`}
      aria-label="Game statistics"
    >
      {!isOpen ? (
        <button
          type="button"
          className="stats-drawer-trigger"
          onClick={() => setIsOpen(true)}
          aria-expanded={false}
        >
          <span>Stats</span>
          <span>Show</span>
        </button>
      ) : (
        <>
          <div className="stats-drawer-header">
            <p>Stats</p>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-expanded={true}
            >
              Hide
            </button>
          </div>

          <div className="stats-drawer-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'leaderboard'}
              className={activeTab === 'leaderboard' ? 'is-active' : undefined}
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
          </div>
        </>
      )}
    </section>
  )
}

export default StatsDrawer
