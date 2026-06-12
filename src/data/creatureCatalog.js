export const CREATURE_CATALOG = [
  {
    id: 'lane-sprite',
    name: 'Lane Sprite',
    rarity: 'common',
    score: 10,
    color: '#f97316',
    symbol: '✦',
  },
  {
    id: 'curb-mite',
    name: 'Curb Mite',
    rarity: 'common',
    score: 10,
    color: '#f97316',
    symbol: '◆',
  },
  {
    id: 'signal-pip',
    name: 'Signal Pip',
    rarity: 'common',
    score: 10,
    color: '#f97316',
    symbol: '●',
  },
  {
    id: 'zebra-wisp',
    name: 'Zebra Wisp',
    rarity: 'common',
    score: 10,
    color: '#f97316',
    symbol: '◇',
  },
  {
    id: 'flyover-imp',
    name: 'Flyover Imp',
    rarity: 'rare',
    score: 30,
    color: '#ef4444',
    symbol: '✹',
  },
  {
    id: 'metro-glint',
    name: 'Metro Glint',
    rarity: 'rare',
    score: 30,
    color: '#ef4444',
    symbol: '⬟',
  },
  {
    id: 'turnshade',
    name: 'Turnshade',
    rarity: 'rare',
    score: 30,
    color: '#ef4444',
    symbol: '✧',
  },
  {
    id: 'crown-beacon',
    name: 'Crown Beacon',
    rarity: 'legendary',
    score: 100,
    color: '#9333ea',
    symbol: '★',
  },
  {
    id: 'night-orbit',
    name: 'Night Orbit',
    rarity: 'legendary',
    score: 100,
    color: '#9333ea',
    symbol: '✺',
  },
]

export function getCreaturesByRarity(rarity) {
  return CREATURE_CATALOG.filter((creature) => creature.rarity === rarity)
}
