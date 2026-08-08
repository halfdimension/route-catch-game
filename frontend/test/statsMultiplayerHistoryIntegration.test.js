import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const statsPagePath = new URL('../src/pages/StatsPage.jsx', import.meta.url)
const panelPath = new URL(
  '../src/components/MultiplayerRoundHistoryPanel.jsx',
  import.meta.url,
)
const modalPath = new URL(
  '../src/components/roundResults/RoundResultsModal.jsx',
  import.meta.url,
)

test('Stats keeps existing stats and solo history while adding multiplayer history', async () => {
  const source = await readFile(statsPagePath, 'utf8')

  assert.match(source, /<PlayerStatsPanel/)
  assert.match(source, /<GameHistoryPanel/)
  assert.match(source, /<MultiplayerRoundHistoryPanel/)
  assert.match(source, /authIdentity=\{currentUser\?\.userId\}/)
})

test('history list load is separate from exact detail retrieval', async () => {
  const source = await readFile(panelPath, 'utf8')

  assert.match(source, /listHistory: listMultiplayerRoundHistory/)
  assert.match(source, /getResult: getRoundResult/)
  assert.match(source, /View result/)
  assert.match(source, /No completed multiplayer rounds yet\./)
  assert.match(source, />Rank</)
  assert.match(source, />Score</)
  assert.match(source, />Catches</)
  assert.match(source, />Duration</)
  assert.match(source, /Previous/)
  assert.match(source, /Next/)
})

test('historical modal mode exposes Close and retains live result actions outside that mode', async () => {
  const source = await readFile(modalPath, 'utf8')

  assert.match(source, /controls\.showClose \? \(/)
  assert.match(source, />\s*Close\s*</)
  assert.match(source, /View Map/)
  assert.match(source, /Return to Lobby/)
  assert.match(source, /Play Again/)
})
