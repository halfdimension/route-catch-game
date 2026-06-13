const SUPPORTED_RARITIES = new Set(['common', 'rare', 'legendary'])

export function getRarityClassName(rarity) {
  const normalizedRarity = String(rarity ?? '').toLowerCase()

  return SUPPORTED_RARITIES.has(normalizedRarity)
    ? `rarity-${normalizedRarity}`
    : 'rarity-unknown'
}
