import { useEffect, useRef } from 'react'
import { isSoloTargetCatchableAt } from '../utils/soloCatchGeometry.js'

export function useCatchDetection({
  playerPosition,
  targets,
  enabled = true,
  isMoving,
  onCatchTarget,
}) {
  const reportedTargetIdsRef = useRef(new Set())

  useEffect(() => {
    const activeTargetIds = new Set(targets.map((target) => target.id))

    reportedTargetIdsRef.current.forEach((targetId) => {
      if (!activeTargetIds.has(targetId)) {
        reportedTargetIdsRef.current.delete(targetId)
      }
    })

    // Moving catches are resolved from logical route-distance intervals by
    // useRouteAnimation. Sampling rendered positions here would reintroduce a
    // frame-rate-dependent event model and could race the interval resolver.
    if (!enabled || isMoving) {
      return
    }

    const now = Date.now()

    targets
      .filter((target) => target.expiresAt > now)
      .forEach((target) => {
        if (reportedTargetIdsRef.current.has(target.id)) {
          return
        }

        if (isSoloTargetCatchableAt(playerPosition, target, now)) {
          reportedTargetIdsRef.current.add(target.id)
          onCatchTarget(target)
        }
      })
  }, [enabled, isMoving, onCatchTarget, playerPosition, targets])
}
