import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  buildPreparedMovementRoute,
  getMovementPlanPosition,
  movementCoordinateToLeaflet,
} from '../utils/movementPlanTimeline.js'

function toPlayerPosition([lat, lon]) {
  return { lat, lon }
}

export function prepareMovementPlans(movementPlans, routeCache = new Map()) {
  const preparedPlans = new Map()
  const activeMovementIds = new Set()

  for (const plan of movementPlans) {
    if (!plan?.playerId || !plan?.movementId) {
      continue
    }

    try {
      const movementId = String(plan.movementId)
      const cachedRoute = routeCache.get(movementId)
      const route =
        cachedRoute?.version === plan.version &&
        cachedRoute?.encodedPolyline6 === plan.encodedPolyline6
          ? cachedRoute.route
          : buildPreparedMovementRoute(plan)

      if (route !== cachedRoute?.route) {
        routeCache.set(movementId, {
          encodedPolyline6: plan.encodedPolyline6,
          route,
          version: plan.version,
        })
      }

      activeMovementIds.add(movementId)
      preparedPlans.set(String(plan.playerId), {
        plan,
        route,
      })
    } catch (error) {
      console.warn('Ignored invalid authoritative movement geometry.', {
        movementId: plan.movementId,
        playerId: plan.playerId,
        error,
      })
    }
  }

  for (const movementId of routeCache.keys()) {
    if (!activeMovementIds.has(movementId)) {
      routeCache.delete(movementId)
    }
  }

  return preparedPlans
}

export function calculateMovementPositions(preparedPlans, estimatedServerNowMs) {
  const positions = new Map()

  for (const [playerId, preparedPlan] of preparedPlans) {
    try {
      positions.set(
        playerId,
        toPlayerPosition(
          getMovementPlanPosition(
            preparedPlan.plan,
            preparedPlan.route,
            estimatedServerNowMs,
          ),
        ),
      )
    } catch (error) {
      try {
        positions.set(
          playerId,
          toPlayerPosition(
            movementCoordinateToLeaflet(preparedPlan.plan.currentPosition),
          ),
        )
      } catch {
        console.warn('Could not render authoritative movement plan.', {
          movementId: preparedPlan.plan.movementId,
          playerId,
          error,
        })
      }
    }
  }

  return positions
}

export function useMovementPlanRenderer({
  movementPlans,
  serverOffsetMs,
}) {
  const routeCache = useMemo(() => new Map(), [])
  const preparedPlans = useMemo(
    () => prepareMovementPlans(movementPlans, routeCache),
    [movementPlans, routeCache],
  )
  const [positionsByPlayerId, setPositionsByPlayerId] = useState(new Map())

  const renderCurrentPositions = useCallback(() => {
    setPositionsByPlayerId(
      calculateMovementPositions(
        preparedPlans,
        Date.now() + serverOffsetMs,
      ),
    )
  }, [preparedPlans, serverOffsetMs])

  const getCurrentPlayerPosition = useCallback((playerId) => {
    if (!playerId) {
      return null
    }

    return calculateMovementPositions(
      new Map([
        [
          String(playerId),
          preparedPlans.get(String(playerId)),
        ],
      ].filter(([, preparedPlan]) => Boolean(preparedPlan))),
      Date.now() + serverOffsetMs,
    ).get(String(playerId)) ?? null
  }, [preparedPlans, serverOffsetMs])

  useEffect(() => {
    let frameId = null
    const hasMovingPlan = [...preparedPlans.values()].some(
      ({ plan }) => plan.status === 'MOVING',
    )

    const redraw = () => {
      renderCurrentPositions()

      if (hasMovingPlan) {
        frameId = window.requestAnimationFrame(redraw)
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        renderCurrentPositions()
      }
    }

    redraw()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [preparedPlans, renderCurrentPositions])

  return {
    positionsByPlayerId,
    preparedPlans,
    getCurrentPlayerPosition,
    renderCurrentPositions,
  }
}
