export const SOLO_NAVIGATION_START_KINDS = Object.freeze({
  FRESH: 'FRESH',
  RECOVERED_ACTIVE: 'RECOVERED_ACTIVE',
})

export function createNavigationFrameChannel({
  onListenerError = (error) => {
    console.error('Navigation frame listener failed:', error)
  },
} = {}) {
  let latestFrame = null
  const listeners = new Set()

  return {
    publish(navigationFrame) {
      latestFrame = navigationFrame
      listeners.forEach((listener) => {
        try {
          listener(navigationFrame)
        } catch (error) {
          onListenerError(error)
        }
      })
    },
    subscribe(listener) {
      if (typeof listener !== 'function') {
        return () => {}
      }

      listeners.add(listener)

      if (latestFrame) {
        listener(latestFrame)
      }

      return () => {
        listeners.delete(listener)
      }
    },
    clear() {
      listeners.clear()
    },
  }
}
