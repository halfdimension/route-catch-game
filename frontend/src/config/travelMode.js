export const TRAVEL_MODES = Object.freeze({
  CAR: 'CAR',
  MOTORCYCLE: 'MOTORCYCLE',
  WALKING: 'WALKING',
})

export const DEFAULT_TRAVEL_MODE = TRAVEL_MODES.CAR

export const SOLO_TRAVEL_MODE_OPTIONS = Object.freeze([
  Object.freeze({ label: 'Car', value: TRAVEL_MODES.CAR }),
  Object.freeze({ label: 'Motorcycle', value: TRAVEL_MODES.MOTORCYCLE }),
  Object.freeze({ label: 'Walking', value: TRAVEL_MODES.WALKING }),
])

const TRAVEL_MODE_VALUES = new Set(Object.values(TRAVEL_MODES))

export function isTravelMode(value) {
  return typeof value === 'string' && TRAVEL_MODE_VALUES.has(value)
}

export function requireTravelMode(value, name = 'Travel mode') {
  if (!isTravelMode(value)) {
    throw new TypeError(`${name} must be CAR, MOTORCYCLE, or WALKING`)
  }

  return value
}
