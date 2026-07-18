import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPresencePublishScheduler,
  isCurrentPresenceSubscription,
  normalizePresencePlayers,
  reconcilePresencePlayers,
  shouldPublishPresence,
} from '../src/hooks/presenceSync.js'

const METERS_PER_LATITUDE_DEGREE = 111195

function createFakeClock() {
  let currentTime = 0
  let nextTimerId = 1
  const timers = new Map()

  function nextPendingTimer(targetTime) {
    return [...timers.entries()]
      .filter(([, timer]) => timer.runAt <= targetTime)
      .sort((first, second) => first[1].runAt - second[1].runAt)[0]
  }

  return {
    advanceTo(targetTime) {
      let pendingTimer = nextPendingTimer(targetTime)

      while (pendingTimer) {
        const [timerId, timer] = pendingTimer
        timers.delete(timerId)
        currentTime = timer.runAt
        timer.callback()
        pendingTimer = nextPendingTimer(targetTime)
      }

      currentTime = targetTime
    },

    clearTimer(timerId) {
      timers.delete(timerId)
    },

    now() {
      return currentTime
    },

    setTimer(callback, delay) {
      const timerId = nextTimerId
      nextTimerId += 1
      timers.set(timerId, {
        callback,
        runAt: currentTime + delay,
      })
      return timerId
    },
  }
}

test('continuous 90-second movement keeps publishing at no more than 5 Hz', () => {
  const clock = createFakeClock()
  const sentUpdates = []
  let position = { lat: 28.6, lon: 77.2 }
  let lastSentPosition = null
  let lastSentStatus = ''
  const status = 'MOVING'
  const scheduler = createPresencePublishScheduler({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onAttempt: () => {
      if (!shouldPublishPresence({
        lastSentPosition,
        lastSentStatus,
        position,
        status,
      })) {
        return
      }

      lastSentPosition = position
      lastSentStatus = status
      sentUpdates.push({ at: clock.now(), position })
    },
  })

  for (let elapsed = 0; elapsed <= 90000; elapsed += 16) {
    clock.advanceTo(elapsed)
    position = {
      lat: 28.6 + (elapsed / 1000 * 10) / METERS_PER_LATITUDE_DEGREE,
      lon: 77.2,
    }
    scheduler.schedule()
  }
  clock.advanceTo(90200)

  assert.ok(sentUpdates.length >= 445)
  assert.ok(sentUpdates.at(-1).at >= 89800)
  for (let index = 1; index < sentUpdates.length; index += 1) {
    assert.ok(sentUpdates[index].at - sentUpdates[index - 1].at >= 200)
  }
})

test('stop, cancellation, and a new route cannot permanently suppress publishing', () => {
  const clock = createFakeClock()
  const sentStatuses = []
  let position = { lat: 28.6, lon: 77.2 }
  let status = 'MOVING'
  let lastSentPosition = null
  let lastSentStatus = ''
  const scheduler = createPresencePublishScheduler({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onAttempt: () => {
      if (!shouldPublishPresence({
        lastSentPosition,
        lastSentStatus,
        position,
        status,
      })) {
        return
      }

      lastSentPosition = position
      lastSentStatus = status
      sentStatuses.push(status)
    },
  })

  scheduler.schedule()
  clock.advanceTo(0)
  status = 'IDLE'
  scheduler.schedule()
  clock.advanceTo(200)

  scheduler.schedule()
  scheduler.reset()
  clock.advanceTo(1000)

  status = 'MOVING'
  scheduler.schedule()
  clock.advanceTo(1000)
  position = { lat: 28.60002, lon: 77.2 }
  scheduler.schedule()
  clock.advanceTo(1200)

  assert.deepEqual(sentStatuses, ['MOVING', 'IDLE', 'MOVING', 'MOVING'])
})

test('status changes publish while sub-metre position changes remain suppressed', () => {
  const initialPosition = { lat: 28.6, lon: 77.2 }
  const subMetrePosition = {
    lat: 28.6 + 0.5 / METERS_PER_LATITUDE_DEGREE,
    lon: 77.2,
  }

  assert.equal(shouldPublishPresence({
    lastSentPosition: initialPosition,
    lastSentStatus: 'IDLE',
    position: subMetrePosition,
    status: 'IDLE',
  }), false)
  assert.equal(shouldPublishPresence({
    lastSentPosition: initialPosition,
    lastSentStatus: 'IDLE',
    position: subMetrePosition,
    status: 'MOVING',
  }), true)
})

test('newer server timestamps are accepted and delayed older updates are rejected', () => {
  const currentPlayers = normalizePresencePlayers([{
    userId: 42,
    lat: 28.61,
    lon: 77.21,
    lastSeenAt: '2026-07-18T10:00:02Z',
  }])
  const stalePlayers = normalizePresencePlayers([{
    userId: '42',
    lat: 28.6,
    lon: 77.2,
    lastSeenAt: '2026-07-18T10:00:01Z',
  }])
  const latestPlayers = normalizePresencePlayers([{
    userId: '42',
    lat: 28.62,
    lon: 77.22,
    lastSeenAt: '2026-07-18T10:00:03Z',
  }])

  const staleResult = reconcilePresencePlayers(currentPlayers, stalePlayers)
  assert.equal(staleResult.players[0].lat, 28.61)
  assert.deepEqual(staleResult.rejectedPlayerIds, ['42'])

  const latestResult = reconcilePresencePlayers(
    staleResult.players,
    latestPlayers,
  )
  assert.equal(latestResult.players[0].lat, 28.62)
  assert.deepEqual(latestResult.acceptedPlayerIds, ['42'])
})

test('nanosecond timestamps within the same millisecond remain ordered', () => {
  const currentPlayers = normalizePresencePlayers([{
    userId: 'player-1',
    lat: 28.61,
    lon: 77.21,
    lastSeenAt: '2026-07-18T10:00:02.123456789Z',
  }])
  const stalePlayers = normalizePresencePlayers([{
    userId: 'player-1',
    lat: 28.6,
    lon: 77.2,
    lastSeenAt: '2026-07-18T10:00:02.123456700Z',
  }])
  const latestPlayers = normalizePresencePlayers([{
    userId: 'player-1',
    lat: 28.62,
    lon: 77.22,
    lastSeenAt: '2026-07-18T10:00:02.123456900Z',
  }])

  const staleResult = reconcilePresencePlayers(currentPlayers, stalePlayers)
  assert.equal(staleResult.players[0].lat, 28.61)
  const latestResult = reconcilePresencePlayers(
    staleResult.players,
    latestPlayers,
  )
  assert.equal(latestResult.players[0].lat, 28.62)
})

test('only the current reconnect subscription generation can update state', () => {
  const currentClient = {}
  const commonState = {
    currentClient,
    currentConnectionId: 7,
    currentSubscriptionGeneration: 3,
    currentRoomId: 'ROOM-1',
  }

  assert.equal(isCurrentPresenceSubscription({
    ...commonState,
    client: currentClient,
    connectionId: 7,
    subscriptionGeneration: 3,
    roomId: 'ROOM-1',
  }), true)
  assert.equal(isCurrentPresenceSubscription({
    ...commonState,
    client: currentClient,
    connectionId: 7,
    subscriptionGeneration: 2,
    roomId: 'ROOM-1',
  }), false)
  assert.equal(isCurrentPresenceSubscription({
    ...commonState,
    client: {},
    connectionId: 7,
    subscriptionGeneration: 3,
    roomId: 'ROOM-1',
  }), false)
})
