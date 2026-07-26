export function createSharedCreatureIconCache(createIcon) {
  if (typeof createIcon !== 'function') {
    throw new TypeError('Shared creature icon factory is required')
  }

  const iconsByVisualState = new Map()

  return function getSharedCreatureIcon({
    initial,
    rarityClassName,
    isChased,
    isRouting,
  }) {
    const visualStateKey = JSON.stringify([
      initial,
      rarityClassName,
      Boolean(isChased),
      Boolean(isRouting),
    ])

    if (!iconsByVisualState.has(visualStateKey)) {
      iconsByVisualState.set(
        visualStateKey,
        createIcon({
          initial,
          rarityClassName,
          isChased: Boolean(isChased),
          isRouting: Boolean(isRouting),
        }),
      )
    }

    return iconsByVisualState.get(visualStateKey)
  }
}
