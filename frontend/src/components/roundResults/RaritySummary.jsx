import { getRarityClassName } from '../../utils/rarityStyles'

const FEATURED_RARITIES = ['common', 'rare', 'legendary']

function formatRarity(rarity) {
  return String(rarity)
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (character) => character.toUpperCase())
}

function RaritySummary({ rarityCounts = {} }) {
  const normalizedCounts = Object.entries(rarityCounts).reduce(
    (counts, [rarity, count]) => ({
      ...counts,
      [String(rarity).toLowerCase()]: count,
    }),
    {},
  )
  const unknownRarities = Object.keys(normalizedCounts)
    .filter((rarity) => !FEATURED_RARITIES.includes(rarity))
  const rarities = [...FEATURED_RARITIES, ...unknownRarities]

  return (
    <section className="round-results-rarity" aria-labelledby="rarity-heading">
      <h2 id="rarity-heading">Rarity breakdown</h2>
      <div className="round-results-rarity-grid">
        {rarities.map((rarity) => (
          <div key={rarity} className={getRarityClassName(rarity)}>
            <span>{formatRarity(rarity)}</span>
            <strong>{normalizedCounts[rarity] ?? 0}</strong>
          </div>
        ))}
      </div>
    </section>
  )
}

export default RaritySummary
