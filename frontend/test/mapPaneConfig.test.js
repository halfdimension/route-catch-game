import assert from 'node:assert/strict'
import test from 'node:test'
import { MAP_PANE } from '../src/config/mapPaneConfig.js'

test('clickable shared creatures render above player markers', () => {
  assert.ok(
    MAP_PANE.SHARED_ROOM_CREATURE.zIndex > MAP_PANE.PLAYER.zIndex,
    'player markers must not intercept shared-creature clicks',
  )
  assert.notEqual(
    MAP_PANE.SHARED_ROOM_CREATURE.name,
    MAP_PANE.CREATURE.name,
    'solo and shared creatures use separate pane ordering',
  )
})
