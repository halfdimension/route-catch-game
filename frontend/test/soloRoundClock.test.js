import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  createSoloRoundTimeline,
  getRecoverableSoloRoundState,
  getSoloRoundRemainingSeconds,
} from '../src/recovery/soloRoundClock.js'

const STARTED_AT = 1_800_000_000_000

test('remaining round time is derived from absolute endsAt', () => {
  const timeline = createSoloRoundTimeline({
    durationSeconds: 60,
    startedAtEpochMs: STARTED_AT,
  })

  assert.equal(getSoloRoundRemainingSeconds(timeline, STARTED_AT), 60)
  assert.equal(getSoloRoundRemainingSeconds(timeline, STARTED_AT + 1), 60)
  assert.equal(getSoloRoundRemainingSeconds(timeline, STARTED_AT + 1_000), 59)
})

test('five seconds of reload time consumes five seconds of the round', () => {
  const timeline = createSoloRoundTimeline({
    durationSeconds: 60,
    startedAtEpochMs: STARTED_AT,
  })

  const beforeReload = getSoloRoundRemainingSeconds(
    timeline,
    STARTED_AT + 10_000,
  )
  const afterReload = getSoloRoundRemainingSeconds(
    timeline,
    STARTED_AT + 15_000,
  )
  assert.equal(beforeReload - afterReload, 5)
})

test('expired round never resolves to RUNNING', () => {
  const timeline = createSoloRoundTimeline({
    durationSeconds: 10,
    startedAtEpochMs: STARTED_AT,
  })

  assert.equal(
    getRecoverableSoloRoundState(timeline, timeline.endsAtEpochMs - 1),
    'running',
  )
  assert.equal(
    getRecoverableSoloRoundState(timeline, timeline.endsAtEpochMs),
    'ended',
  )
})

test('late display intervals do not extend the absolute round deadline', () => {
  const timeline = createSoloRoundTimeline({
    durationSeconds: 10,
    startedAtEpochMs: STARTED_AT,
  })

  assert.equal(
    getSoloRoundRemainingSeconds(timeline, timeline.endsAtEpochMs + 5_000),
    0,
  )
})

test('useGameSession consumes wall-clock primitives rather than decrementing state', () => {
  const source = readFileSync(
    new URL('../src/hooks/useGameSession.js', import.meta.url),
    'utf8',
  )

  assert.match(source, /getSoloRoundRemainingSeconds/)
  assert.match(source, /endsAtEpochMs/)
  assert.doesNotMatch(source, /currentSeconds\s*-\s*1/)
})
