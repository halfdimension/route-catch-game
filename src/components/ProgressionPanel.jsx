function ProgressionPanel({ level, xp, nextLevelXp }) {
  return (
    <section className="progression-panel" aria-label="Player progression">
      <p>Progression</p>
      <strong>Level {level}</strong>
      <span>
        XP: {xp} / {nextLevelXp === null ? 'Max' : nextLevelXp}
      </span>
    </section>
  )
}

export default ProgressionPanel
