const CATCH_TONES = {
  common: [440, 660],
  rare: [523.25, 783.99],
  legendary: [659.25, 987.77, 1318.51],
}

export function playCatchSound(rarity) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext

    if (!AudioContext) {
      return
    }

    const audioContext = new AudioContext()
    const gain = audioContext.createGain()
    const tones = CATCH_TONES[rarity] ?? CATCH_TONES.common
    const now = audioContext.currentTime

    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)
    gain.connect(audioContext.destination)

    tones.forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator()
      const startTime = now + index * 0.08
      const stopTime = startTime + 0.16

      oscillator.type = rarity === 'legendary' ? 'triangle' : 'sine'
      oscillator.frequency.setValueAtTime(frequency, startTime)
      oscillator.connect(gain)
      oscillator.start(startTime)
      oscillator.stop(stopTime)
    })

    window.setTimeout(() => {
      audioContext.close().catch(() => {})
    }, 600)
  } catch {
    // Audio feedback is optional; blocked or unavailable audio should not affect play.
  }
}
