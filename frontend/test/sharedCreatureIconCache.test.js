import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSharedCreatureIconCache,
} from '../src/utils/sharedCreatureIconCache.js'

test('shared creature icon identity survives unrelated movement frames', () => {
  let createdIconCount = 0
  const getIcon = createSharedCreatureIconCache((visualState) => {
    createdIconCount += 1
    return { createdIconCount, visualState }
  })
  const idleVisualState = {
    initial: 'C',
    rarityClassName: 'rarity-common',
    isChased: false,
    isRouting: false,
  }

  const firstFrameIcon = getIcon(idleVisualState)
  const nextFrameIcon = getIcon({ ...idleVisualState })

  assert.strictEqual(nextFrameIcon, firstFrameIcon)
  assert.equal(createdIconCount, 1)

  const routingIcon = getIcon({
    ...idleVisualState,
    isChased: true,
    isRouting: true,
  })

  assert.notStrictEqual(routingIcon, firstFrameIcon)
  assert.equal(createdIconCount, 2)
})
