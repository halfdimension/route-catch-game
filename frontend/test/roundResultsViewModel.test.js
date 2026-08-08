import assert from 'node:assert/strict'
import test from 'node:test'
import { formatUnknownReason } from '../src/components/roundResults/roundResultFormatters.js'
import {
  createRoundResultsViewModel,
  getRoundResultsActions,
  getRoundResultsModalControls,
  isCurrentRoundPlayer,
  playAgainAndClear,
  returnToRoundLobby,
} from '../src/components/roundResults/roundResultsViewModel.js'
import { getRarityClassName } from '../src/utils/rarityStyles.js'

function backendResult() {
  return {
    publicResult: {
      endReason: 'HOST_ENDED',
      leaderboard: [
        { creaturesCaught: 7, displayName: 'Ada', playerId: 'ada', rank: 1, score: 140 },
        { creaturesCaught: 7, displayName: 'Bea', playerId: 'bea', rank: 1, score: 140 },
      ],
      roomCode: 'ROOM',
      roundId: 'round-1',
    },
    personalResult: {
      caughtCreatures: [
        { caughtAt: '2026-07-26T10:00:00Z', instanceId: 'catch-1', name: 'Flare', rarity: 'rare', scoreAwarded: 30 },
      ],
      creaturesCaught: 7,
      displayName: 'Ada',
      playerCount: 2,
      playerId: 'ada',
      rank: 1,
      rarityCounts: { common: 3, rare: 3, legendary: 1 },
      roomCode: 'ROOM',
      roundId: 'round-1',
      score: 140,
    },
  }
}

test('the display model preserves backend score, rank, player count, catches, rarities, and leaderboard', () => {
  const result = backendResult()
  const viewModel = createRoundResultsViewModel(result)

  assert.equal(viewModel.personalResult.score, 140)
  assert.equal(viewModel.personalResult.rank, 1)
  assert.equal(viewModel.personalResult.playerCount, 2)
  assert.equal(viewModel.caughtCreatures, result.personalResult.caughtCreatures)
  assert.equal(viewModel.rarityCounts, result.personalResult.rarityCounts)
  assert.equal(viewModel.leaderboard, result.publicResult.leaderboard)
})

test('the current player is identified while tied backend ranks remain unchanged', () => {
  const entries = backendResult().publicResult.leaderboard

  assert.equal(isCurrentRoundPlayer(entries[0], 'ada'), true)
  assert.equal(isCurrentRoundPlayer(entries[1], 'ada'), false)
  assert.deepEqual(entries.map((entry) => entry.rank), [1, 1])
})

test('empty and long caught-creature collections remain renderable data', () => {
  const emptyResult = backendResult()
  emptyResult.personalResult.caughtCreatures = []
  assert.deepEqual(createRoundResultsViewModel(emptyResult).caughtCreatures, [])

  const longResult = backendResult()
  longResult.personalResult.caughtCreatures = Array.from({ length: 250 }, (_, index) => ({
    instanceId: `catch-${index}`,
    name: `Creature ${index}`,
    rarity: 'common',
  }))
  const catches = createRoundResultsViewModel(longResult).caughtCreatures
  assert.equal(catches.length, 250)
  assert.equal(catches.at(-1).name, 'Creature 249')
})

test('unknown rarity and unknown end reason have safe fallbacks', () => {
  assert.equal(getRarityClassName('cosmic'), 'rarity-unknown')
  assert.equal(formatUnknownReason('SERVER_OVERRIDE'), 'Server override')
  assert.equal(formatUnknownReason(), 'Round completed')
})

test('closing retains View Results availability for an existing result', () => {
  const actions = getRoundResultsActions({
    canPlayAgain: false,
    error: null,
    isHost: false,
    isOpen: false,
    result: backendResult(),
  })

  assert.equal(actions.showReopen, true)
})

test('host Play Again calls its start callback and clears only after success', async () => {
  let starts = 0
  let clears = 0
  const actions = getRoundResultsActions({
    canPlayAgain: true,
    error: null,
    isHost: true,
    isOpen: true,
    result: backendResult(),
  })

  const didStart = await playAgainAndClear({
    clearResult: () => { clears += 1 },
    onPlayAgain: async () => { starts += 1; return true },
  })

  assert.equal(actions.showPlayAgain, true)
  assert.equal(didStart, true)
  assert.equal(starts, 1)
  assert.equal(clears, 1)
})

test('a non-host cannot start a new round and sees the waiting state', () => {
  const actions = getRoundResultsActions({
    canPlayAgain: true,
    error: null,
    isHost: false,
    isOpen: true,
    result: backendResult(),
  })

  assert.equal(actions.showPlayAgain, false)
  assert.equal(actions.showWaitingForHost, true)
})

test('Return to Lobby invokes the supplied navigation callback', () => {
  let returnCalls = 0
  returnToRoundLobby(() => { returnCalls += 1 })
  assert.equal(returnCalls, 1)
})

test('historical modal controls are view-only while live controls remain available', () => {
  const liveActions = getRoundResultsActions({
    canPlayAgain: true,
    error: null,
    isHost: true,
    isOpen: true,
    result: backendResult(),
  })

  assert.deepEqual(
    getRoundResultsModalControls({ actions: liveActions, historical: true }),
    {
      showClose: true,
      showPlayAgain: false,
      showReturnToLobby: false,
      showViewMap: false,
      showWaitingForHost: false,
    },
  )
  assert.deepEqual(
    getRoundResultsModalControls({ actions: liveActions, historical: false }),
    {
      showClose: false,
      showPlayAgain: true,
      showReturnToLobby: true,
      showViewMap: true,
      showWaitingForHost: false,
    },
  )
})
