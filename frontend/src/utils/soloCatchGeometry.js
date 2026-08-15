import { CATCH_RADIUS_METERS } from '../config/gameConfig.js'

const EARTH_RADIUS_METERS = 6371000
const INTERSECTION_EPSILON_METERS = 0.001

function toRadians(degrees) {
  return (degrees * Math.PI) / 180
}

function normalizeLongitudeDelta(longitudeDelta) {
  if (longitudeDelta > 180) {
    return longitudeDelta - 360
  }
  if (longitudeDelta < -180) {
    return longitudeDelta + 360
  }
  return longitudeDelta
}

export function getSoloCatchDistanceMeters(source, target) {
  const latDelta = toRadians(target.lat - source.lat)
  const lonDelta = toRadians(
    normalizeLongitudeDelta(target.lon - source.lon),
  )
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
    Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
  )
}

export function isSoloTargetCatchableAt(
  playerPosition,
  target,
  atEpochMs,
  catchRadiusMeters = CATCH_RADIUS_METERS,
) {
  return Boolean(
    target &&
    Number.isFinite(target.expiresAt) &&
    target.expiresAt > atEpochMs &&
    getSoloCatchDistanceMeters(playerPosition, target) <= catchRadiusMeters,
  )
}

function projectRelativeToTarget(coordinate, target) {
  const latitudeRadians = toRadians(target.lat)
  return {
    x:
      EARTH_RADIUS_METERS *
      toRadians(normalizeLongitudeDelta(coordinate[1] - target.lon)) *
      Math.cos(latitudeRadians),
    y: EARTH_RADIUS_METERS * toRadians(coordinate[0] - target.lat),
  }
}

function squaredDistanceAt(start, delta, progress) {
  const x = start.x + delta.x * progress
  const y = start.y + delta.y * progress
  return x * x + y * y
}

function findSegmentEntryProgress(
  segment,
  target,
  minimumProgress,
  maximumProgress,
  catchRadiusMeters,
) {
  const start = projectRelativeToTarget(segment.start, target)
  const end = projectRelativeToTarget(segment.end, target)
  const delta = { x: end.x - start.x, y: end.y - start.y }
  const radiusWithTolerance =
    catchRadiusMeters + INTERSECTION_EPSILON_METERS
  const radiusWithToleranceSquared = radiusWithTolerance ** 2

  if (
    squaredDistanceAt(start, delta, minimumProgress) <=
      radiusWithToleranceSquared
  ) {
    return minimumProgress
  }

  const a = delta.x * delta.x + delta.y * delta.y
  if (a <= Number.EPSILON) {
    return null
  }
  const closestProgressOnLine = -(
    start.x * delta.x + start.y * delta.y
  ) / a
  const closestPointDistanceSquared = squaredDistanceAt(
    start,
    delta,
    closestProgressOnLine,
  )
  if (closestPointDistanceSquared > radiusWithToleranceSquared) {
    return null
  }

  // Work in physical metre-space instead of comparing a metre^4 quadratic
  // discriminant with a fixed epsilon. The half span is the route-progress
  // distance from the closest point on the infinite line to either circle
  // intersection.
  const halfSpan = Math.sqrt(Math.max(
    0,
    radiusWithToleranceSquared - closestPointDistanceSquared,
  ) / a)
  const roots = [
    closestProgressOnLine - halfSpan,
    closestProgressOnLine + halfSpan,
  ]

  return roots.find((progress) => (
    progress >= minimumProgress - Number.EPSILON &&
    progress <= maximumProgress + Number.EPSILON
  )) ?? null
}

export function findEarliestSoloRouteCatchDistance(
  plan,
  target,
  {
    startDistanceMeters = 0,
    endDistanceMeters = plan?.totalDistanceMeters ?? 0,
    catchRadiusMeters = CATCH_RADIUS_METERS,
  } = {},
) {
  if (!plan || !target || plan.segments.length === 0) {
    return null
  }

  const rangeStart = Math.max(
    0,
    Math.min(startDistanceMeters, plan.totalDistanceMeters),
  )
  const rangeEnd = Math.max(
    rangeStart,
    Math.min(endDistanceMeters, plan.totalDistanceMeters),
  )

  for (const segment of plan.segments) {
    if (
      segment.endDistanceMeters < rangeStart ||
      segment.startDistanceMeters > rangeEnd
    ) {
      continue
    }

    const minimumProgress = Math.max(
      0,
      (rangeStart - segment.startDistanceMeters) / segment.distanceMeters,
    )
    const maximumProgress = Math.min(
      1,
      (rangeEnd - segment.startDistanceMeters) / segment.distanceMeters,
    )
    const entryProgress = findSegmentEntryProgress(
      segment,
      target,
      minimumProgress,
      maximumProgress,
      catchRadiusMeters,
    )

    if (entryProgress !== null) {
      return Math.max(
        rangeStart,
        Math.min(
          rangeEnd,
          segment.startDistanceMeters +
            entryProgress * segment.distanceMeters,
        ),
      )
    }
  }

  return null
}
