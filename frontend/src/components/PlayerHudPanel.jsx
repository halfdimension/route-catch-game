import AuthPanel from './AuthPanel'

function getInitial(displayName) {
  return displayName.trim().charAt(0).toUpperCase() || 'G'
}

function PlayerHudPanel({
  score,
  caughtCount,
  level,
  xp,
  nextLevelXp,
  gameState,
  remainingSeconds,
  selectedRoundSeconds,
  playerName,
}) {
  const displayName = playerName?.trim() || 'Guest'
  const sessionTime =
    gameState === 'running' ? remainingSeconds : selectedRoundSeconds

  return (
    <section className="player-hud-panel" aria-label="Player HUD">
      <div className="player-hud-header">
        <div className="player-hud-profile">
          <div className="player-hud-avatar" aria-hidden="true">
            <span>{getInitial(displayName)}</span>
          </div>
          <div>
            <p>{displayName}</p>
            <span>{gameState}</span>
          </div>
        </div>
        <AuthPanel />
      </div>

      <div className="player-hud-stats">
        <span>
          Score <strong>{score}</strong>
        </span>
        <span>
          Catches <strong>{caughtCount}</strong>
        </span>
        <span>
          Level <strong>{level}</strong>
        </span>
        <span>
          Time <strong>{sessionTime}s</strong>
        </span>
      </div>

      <div className="player-hud-xp">
        XP: {xp} / {nextLevelXp === null ? 'Max' : nextLevelXp}
      </div>
    </section>
  )
}

export default PlayerHudPanel
