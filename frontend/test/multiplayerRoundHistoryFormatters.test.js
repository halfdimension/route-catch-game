import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatMultiplayerRoundDuration,
  formatMultiplayerRoundEndReason,
  formatMultiplayerRoundRank,
} from '../src/components/multiplayerRoundHistoryFormatters.js'
import { formatRoundEndReason } from '../src/components/roundResults/roundResultFormatters.js'

test('formats persisted rank, duration, and known end reasons for history rows', () => {
  assert.equal(formatMultiplayerRoundRank(1, 2), '#1 of 2')
  assert.equal(formatMultiplayerRoundDuration(60), '1 min')
  assert.equal(formatMultiplayerRoundDuration(90), '1 min 30 sec')
  assert.equal(formatMultiplayerRoundEndReason('TIME_EXPIRED'), 'Time expired')
  assert.equal(formatMultiplayerRoundEndReason('HOST_ENDED'), 'Host ended')
  assert.equal(formatMultiplayerRoundEndReason('ROOM_CLOSED'), 'Room closed')
  assert.equal(formatRoundEndReason('HOST_ENDED'), 'Host ended the round')
})

test('formats unknown values safely', () => {
  assert.equal(formatMultiplayerRoundDuration(undefined), 'Duration unavailable')
  assert.equal(formatMultiplayerRoundEndReason('SERVER_OVERRIDE'), 'Server override')
})
