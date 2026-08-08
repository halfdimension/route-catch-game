import assert from 'node:assert/strict'
import test from 'node:test'
import { restoreRoundResultsFocus } from '../src/components/roundResults/roundResultsFocus.js'

function focusable(isConnected) {
  return {
    focusCalls: 0,
    isConnected,
    focus() { this.focusCalls += 1 },
  }
}

test('restores focus to the connected modal trigger', () => {
  const trigger = focusable(true)
  const fallback = focusable(true)

  const focused = restoreRoundResultsFocus(trigger, fallback)

  assert.equal(focused, trigger)
  assert.equal(trigger.focusCalls, 1)
  assert.equal(fallback.focusCalls, 0)
})

test('uses a connected fallback when the original trigger unmounts', () => {
  const trigger = focusable(false)
  const fallback = focusable(true)

  const focused = restoreRoundResultsFocus(trigger, fallback)

  assert.equal(focused, fallback)
  assert.equal(trigger.focusCalls, 0)
  assert.equal(fallback.focusCalls, 1)
})

test('does not focus detached elements when no connected target remains', () => {
  const trigger = focusable(false)
  const fallback = focusable(false)

  assert.equal(restoreRoundResultsFocus(trigger, fallback), null)
  assert.equal(trigger.focusCalls, 0)
  assert.equal(fallback.focusCalls, 0)
})
