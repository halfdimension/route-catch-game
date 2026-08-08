export function restoreRoundResultsFocus(previousElement, fallbackElement) {
  const focusTarget = previousElement?.isConnected
    ? previousElement
    : fallbackElement?.isConnected
      ? fallbackElement
      : null

  focusTarget?.focus?.()
  return focusTarget
}
