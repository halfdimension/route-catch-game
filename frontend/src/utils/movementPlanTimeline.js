const EARTH_RADIUS_METERS = 6371000
const POLYLINE6_SCALE = 1000000

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value))
}

function requireFiniteNumber(value, label) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    throw new TypeError(`${label} must be a finite number`)
  }

  return number
}

function requireNonNegativeNumber(value, label) {
  const number = requireFiniteNumber(value, label)

  if (number < 0) {
    throw new RangeError(`${label} must not be negative`)
  }

  return number
}

function decodePolylineValue(encodedPolyline6, startIndex) {
  if (startIndex >= encodedPolyline6.length) {
    throw new TypeError('Encoded polyline6 contains an incomplete coordinate')
  }

  let index = startIndex
  let result = 0
  let shift = 0

  while (true) {
    if (index >= encodedPolyline6.length) {
      throw new TypeError('Encoded polyline6 contains a truncated value')
    }

    const encodedChunk = encodedPolyline6.charCodeAt(index) - 63
    index += 1

    if (encodedChunk < 0 || encodedChunk > 63) {
      throw new TypeError('Encoded polyline6 contains an invalid character')
    }

    const chunk = encodedChunk % 32
    const contribution = chunk * (2 ** shift)

    if (
      !Number.isSafeInteger(contribution) ||
      !Number.isSafeInteger(result + contribution)
    ) {
      throw new RangeError('Encoded polyline6 value exceeds safe precision')
    }

    result += contribution

    if (encodedChunk < 32) {
      break
    }

    shift += 5

    if (shift > 50) {
      throw new RangeError('Encoded polyline6 value exceeds safe precision')
    }
  }

  const value = result % 2 === 0
    ? result / 2
    : -(Math.floor(result / 2) + 1)

  return { index, value }
}

function validateLeafletCoordinate(coordinate, label) {
  if (!Array.isArray(coordinate) || coordinate.length < 2) {
    throw new TypeError(`${label} must be a [latitude, longitude] coordinate`)
  }

  const latitude = requireFiniteNumber(coordinate[0], `${label} latitude`)
  const longitude = requireFiniteNumber(coordinate[1], `${label} longitude`)

  if (latitude < -90 || latitude > 90) {
    throw new RangeError(`${label} latitude must be between -90 and 90`)
  }

  if (longitude < -180 || longitude > 180) {
    throw new RangeError(`${label} longitude must be between -180 and 180`)
  }

  return [latitude, longitude]
}

/**
 * Decodes OSRM's polyline6 response directly into Leaflet [lat, lon] pairs.
 */
export function decodePolyline6(encodedPolyline6) {
  if (
    typeof encodedPolyline6 !== 'string' ||
    encodedPolyline6.trim().length === 0
  ) {
    throw new TypeError('Encoded polyline6 must not be blank')
  }

  const coordinates = []
  let latitude = 0
  let longitude = 0
  let index = 0

  while (index < encodedPolyline6.length) {
    const latitudeDelta = decodePolylineValue(encodedPolyline6, index)
    const longitudeDelta = decodePolylineValue(
      encodedPolyline6,
      latitudeDelta.index,
    )
    latitude += latitudeDelta.value
    longitude += longitudeDelta.value

    if (
      !Number.isSafeInteger(latitude) ||
      !Number.isSafeInteger(longitude)
    ) {
      throw new RangeError('Decoded polyline6 coordinate exceeds safe precision')
    }

    const coordinate = validateLeafletCoordinate(
      [latitude / POLYLINE6_SCALE, longitude / POLYLINE6_SCALE],
      'Decoded polyline6 coordinate',
    )
    coordinates.push(coordinate)
    index = longitudeDelta.index
  }

  return coordinates
}

export function haversineDistanceMeters(source, destination) {
  const [sourceLatitude, sourceLongitude] = validateLeafletCoordinate(
    source,
    'Source',
  )
  const [destinationLatitude, destinationLongitude] =
    validateLeafletCoordinate(destination, 'Destination')
  const toRadians = (degrees) => (degrees * Math.PI) / 180
  const sourceLatitudeRadians = toRadians(sourceLatitude)
  const destinationLatitudeRadians = toRadians(destinationLatitude)
  const latitudeDelta = toRadians(destinationLatitude - sourceLatitude)
  const longitudeDelta = toRadians(destinationLongitude - sourceLongitude)
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(sourceLatitudeRadians) *
      Math.cos(destinationLatitudeRadians) *
      Math.sin(longitudeDelta / 2) ** 2
  const boundedHaversine = clamp(haversine, 0, 1)

  return (
    EARTH_RADIUS_METERS *
    2 *
    Math.atan2(
      Math.sqrt(boundedHaversine),
      Math.sqrt(1 - boundedHaversine),
    )
  )
}

/**
 * Decodes and measures a plan once. `backendRouteDistanceMeters` deliberately
 * remains separate from measured geometry distance: the backend advances the
 * normalized timeline using OSRM's authoritative route summary distance.
 */
export function buildPreparedMovementRoute(movementPlan) {
  if (!movementPlan || typeof movementPlan !== 'object') {
    throw new TypeError('Movement plan is required')
  }

  const coordinates = decodePolyline6(movementPlan.encodedPolyline6)
  const cumulativeDistancesMeters = [0]

  for (let index = 1; index < coordinates.length; index += 1) {
    cumulativeDistancesMeters.push(
      cumulativeDistancesMeters[index - 1] +
        haversineDistanceMeters(coordinates[index - 1], coordinates[index]),
    )
  }

  return {
    coordinates,
    cumulativeDistancesMeters,
    measuredTotalDistanceMeters:
      cumulativeDistancesMeters[cumulativeDistancesMeters.length - 1],
    backendRouteDistanceMeters: requireNonNegativeNumber(
      movementPlan.totalDistanceMeters,
      'Backend route distance',
    ),
  }
}

export const prepareMovementRoute = buildPreparedMovementRoute

function coordinateAtMeasuredDistance(preparedRoute, distanceMeters) {
  const {
    coordinates,
    cumulativeDistancesMeters,
    measuredTotalDistanceMeters,
  } = preparedRoute

  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    throw new TypeError('Prepared route must contain coordinates')
  }

  if (
    !Array.isArray(cumulativeDistancesMeters) ||
    cumulativeDistancesMeters.length !== coordinates.length
  ) {
    throw new TypeError('Prepared route cumulative distances are invalid')
  }

  if (distanceMeters <= 0) {
    return [...coordinates[0]]
  }

  if (distanceMeters >= measuredTotalDistanceMeters) {
    return [...coordinates[coordinates.length - 1]]
  }

  let lowerIndex = 1
  let upperIndex = cumulativeDistancesMeters.length - 1

  while (lowerIndex < upperIndex) {
    const middleIndex = Math.floor((lowerIndex + upperIndex) / 2)

    if (cumulativeDistancesMeters[middleIndex] >= distanceMeters) {
      upperIndex = middleIndex
    } else {
      lowerIndex = middleIndex + 1
    }
  }

  const segmentEndIndex = lowerIndex
  const segmentStartIndex = segmentEndIndex - 1
  const segmentStartDistance = cumulativeDistancesMeters[segmentStartIndex]
  const segmentDistance =
    cumulativeDistancesMeters[segmentEndIndex] - segmentStartDistance

  if (segmentDistance <= 0) {
    return [...coordinates[segmentEndIndex]]
  }

  const segmentFraction =
    (distanceMeters - segmentStartDistance) / segmentDistance
  const source = coordinates[segmentStartIndex]
  const destination = coordinates[segmentEndIndex]

  return [
    source[0] + (destination[0] - source[0]) * segmentFraction,
    source[1] + (destination[1] - source[1]) * segmentFraction,
  ]
}

/**
 * Converts distance travelled along the backend timeline to a geometry point.
 */
export function interpolateRoutePosition(
  preparedRoute,
  travelledDistanceMeters,
) {
  if (!preparedRoute || typeof preparedRoute !== 'object') {
    throw new TypeError('Prepared route is required')
  }

  const travelledDistance = requireNonNegativeNumber(
    travelledDistanceMeters,
    'Travelled distance',
  )
  const backendRouteDistance = requireNonNegativeNumber(
    preparedRoute.backendRouteDistanceMeters,
    'Backend route distance',
  )
  const measuredTotalDistance = requireNonNegativeNumber(
    preparedRoute.measuredTotalDistanceMeters,
    'Measured route distance',
  )
  const routeFraction = backendRouteDistance === 0
    ? 1
    : clamp(travelledDistance / backendRouteDistance, 0, 1)

  return coordinateAtMeasuredDistance(
    preparedRoute,
    measuredTotalDistance * routeFraction,
  )
}

export function movementCoordinateToLeaflet(coordinate) {
  if (!coordinate || typeof coordinate !== 'object') {
    throw new TypeError('Authoritative movement coordinate is required')
  }

  return validateLeafletCoordinate(
    [coordinate.latitude, coordinate.longitude],
    'Authoritative movement coordinate',
  )
}

export function parseServerTimestampMs(serverTimestamp) {
  const timestampMs = serverTimestamp instanceof Date
    ? serverTimestamp.getTime()
    : typeof serverTimestamp === 'number'
      ? serverTimestamp
      : Date.parse(serverTimestamp)

  if (!Number.isFinite(timestampMs)) {
    throw new TypeError('Server timestamp must be a valid ISO-8601 timestamp')
  }

  return timestampMs
}

/**
 * Resolves a plan from authoritative server-relative time. Animation frames
 * only choose when this pure calculation is redrawn; no frame history is used.
 */
export function getMovementPlanPosition(
  movementPlan,
  preparedRoute,
  estimatedServerNowMs,
) {
  if (!movementPlan || typeof movementPlan !== 'object') {
    throw new TypeError('Movement plan is required')
  }

  if (movementPlan.status === 'CANCELLED') {
    return movementCoordinateToLeaflet(movementPlan.currentPosition)
  }

  if (movementPlan.status === 'COMPLETED') {
    const coordinates = preparedRoute?.coordinates

    if (!Array.isArray(coordinates) || coordinates.length === 0) {
      throw new TypeError('Completed movement route must contain coordinates')
    }

    return [...coordinates[coordinates.length - 1]]
  }

  if (movementPlan.status !== 'MOVING') {
    throw new RangeError(`Unsupported movement status: ${movementPlan.status}`)
  }

  const serverNowMs = requireFiniteNumber(
    estimatedServerNowMs,
    'Estimated server time',
  )
  const startedAtMs = parseServerTimestampMs(movementPlan.startedAt)
  const speedMetersPerSecond = requireNonNegativeNumber(
    movementPlan.simulationSpeedMps,
    'Simulation speed',
  )
  const elapsedSeconds = Math.max(0, serverNowMs - startedAtMs) / 1000

  return interpolateRoutePosition(
    preparedRoute,
    elapsedSeconds * speedMetersPerSecond,
  )
}

export function calculateServerClockOffsetMs(
  serverTimestamp,
  clientReceiveTimeMs,
) {
  return (
    parseServerTimestampMs(serverTimestamp) -
    requireFiniteNumber(clientReceiveTimeMs, 'Client receive time')
  )
}

export function smoothServerClockOffsetMs(
  currentOffsetMs,
  observedOffsetMs,
  {
    smoothingFactor = 0.2,
    maximumAdjustmentMs = 250,
  } = {},
) {
  const observedOffset = requireFiniteNumber(
    observedOffsetMs,
    'Observed server clock offset',
  )

  if (currentOffsetMs === null || currentOffsetMs === undefined) {
    return observedOffset
  }

  const currentOffset = requireFiniteNumber(
    currentOffsetMs,
    'Current server clock offset',
  )
  const smoothing = requireFiniteNumber(smoothingFactor, 'Smoothing factor')
  const maximumAdjustment = requireNonNegativeNumber(
    maximumAdjustmentMs,
    'Maximum clock adjustment',
  )

  if (smoothing < 0 || smoothing > 1) {
    throw new RangeError('Smoothing factor must be between 0 and 1')
  }

  const adjustment = clamp(
    (observedOffset - currentOffset) * smoothing,
    -maximumAdjustment,
    maximumAdjustment,
  )

  return currentOffset + adjustment
}

/**
 * Uses the first accepted sample immediately, then applies bounded EWMA
 * adjustments from non-older server timestamps. This damps delivery-jitter but
 * cannot remove unknown one-way network latency from the offset estimate.
 */
export function createServerClockOffsetEstimator(options = {}) {
  let offsetMs = null
  let latestServerTimestampMs = Number.NEGATIVE_INFINITY

  return {
    estimateServerNow(clientNowMs) {
      const clientNow = requireFiniteNumber(clientNowMs, 'Client time')
      return clientNow + (offsetMs ?? 0)
    },

    getOffsetMs() {
      return offsetMs ?? 0
    },

    hasEstimate() {
      return offsetMs !== null
    },

    observe(serverTimestamp, clientReceiveTimeMs) {
      const timestampMs = parseServerTimestampMs(serverTimestamp)

      if (timestampMs <= latestServerTimestampMs) {
        return offsetMs ?? 0
      }

      const observedOffsetMs = calculateServerClockOffsetMs(
        timestampMs,
        clientReceiveTimeMs,
      )
      offsetMs = smoothServerClockOffsetMs(
        offsetMs,
        observedOffsetMs,
        options,
      )
      latestServerTimestampMs = timestampMs
      return offsetMs
    },

    reset() {
      offsetMs = null
      latestServerTimestampMs = Number.NEGATIVE_INFINITY
    },
  }
}
