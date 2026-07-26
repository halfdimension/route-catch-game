import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { publishMovementStart } from '../src/api/multiplayerMovementClient.js'
import { MAP_PANE } from '../src/config/mapPaneConfig.js'
import {
  createSharedCreatureMovementIntent,
} from '../src/utils/movementArchitecture.js'

const frontendRoot = fileURLToPath(new URL('..', import.meta.url))

function leafletComponentTestStubs() {
  return {
    name: 'leaflet-component-test-stubs',
    enforce: 'pre',
    resolveId(source) {
      if (source === 'leaflet') {
        return '\0leaflet-component-test'
      }

      if (source === 'react-leaflet') {
        return '\0react-leaflet-component-test'
      }

      return null
    },
    load(id) {
      if (id === '\0leaflet-component-test') {
        return `
          export const DomEvent = {
            stop(event) {
              event.stopped = true
            },
          }
          export function divIcon(options) {
            return { options }
          }
        `
      }

      if (id === '\0react-leaflet-component-test') {
        return `
          export function Marker() {}
          export function Tooltip() {}
        `
      }

      return null
    },
  }
}

test('shared creature marker click publishes its authoritative movement intent', async (context) => {
  const server = await createServer({
    root: frontendRoot,
    logLevel: 'silent',
    server: {
      middlewareMode: true,
    },
    ssr: {
      noExternal: ['leaflet', 'react-leaflet'],
    },
    plugins: [leafletComponentTestStubs()],
  })
  context.after(() => server.close())

  const { default: SharedRoomCreatureMarkers } = await server.ssrLoadModule(
    '/src/components/SharedRoomCreatureMarkers.jsx',
  )
  const publications = []
  const client = {
    connected: true,
    publish(publication) {
      publications.push(publication)
    },
  }
  const creature = {
    instanceId: 'creature-1',
    latitude: 28.61,
    longitude: 77.21,
    name: 'Cat',
    rarity: 'COMMON',
    scoreValue: 10,
    remainingSeconds: 60,
  }
  const [marker] = SharedRoomCreatureMarkers({
    creatures: [creature],
    onCatchCreature(clickedCreature) {
      publishMovementStart(client, 'ABC123', {
        ...createSharedCreatureMovementIntent(
          clickedCreature.instanceId,
          12,
        ),
        clientCommandId: 'command-1',
        expectedMovementVersion: 4,
      })
    },
  })
  const originalEvent = {}

  marker.props.eventHandlers.click({ originalEvent })

  assert.equal(originalEvent.stopped, true)
  assert.equal(marker.props.pane, MAP_PANE.SHARED_ROOM_CREATURE.name)
  assert.equal(publications.length, 1)
  assert.equal(
    publications[0].destination,
    '/app/rooms/ABC123/movements/start',
  )
  assert.deepEqual(JSON.parse(publications[0].body), {
    requestedSpeedMps: 12,
    destinationType: 'CREATURE',
    targetCreatureInstanceId: 'creature-1',
    clientCommandId: 'command-1',
    expectedMovementVersion: 4,
  })
})
