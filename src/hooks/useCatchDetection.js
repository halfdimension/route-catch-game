import { useEffect, useRef } from 'react'

const CATCH_RADIUS_METERS = 25
const EARTH_RADIUS_METERS = 6371000

function toRadians(degrees) {
  return (degrees * Math.PI) / 180
}

function getDistanceMeters(source, target) {
  const latDelta = toRadians(target.lat - source.lat)
  const lonDelta = toRadians(target.lon - source.lon)
  const sourceLatRadians = toRadians(source.lat)
  const targetLatRadians = toRadians(target.lat)

  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(sourceLatRadians) *
      Math.cos(targetLatRadians) *
      Math.sin(lonDelta / 2) ** 2

  return (
    EARTH_RADIUS_METERS *
    2 *
    Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  )
}

export function useCatchDetection({
  playerPosition,
  targets,
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

    if (!isMoving) {
      return
    }

    const now = Date.now()

    targets
      .filter((target) => target.expiresAt > now)
      .forEach((target) => {
        if (reportedTargetIdsRef.current.has(target.id)) {
          return
        }

        const distanceMeters = getDistanceMeters(playerPosition, target)

        if (distanceMeters <= CATCH_RADIUS_METERS) {
          reportedTargetIdsRef.current.add(target.id)
          onCatchTarget(target)
        }
      })
  }, [isMoving, onCatchTarget, playerPosition, targets])
}
