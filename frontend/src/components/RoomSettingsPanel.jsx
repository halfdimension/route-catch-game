import { useState } from 'react'

const MIN_ROOM_SPEED_MPS = 40
const MAX_ROOM_SPEED_MPS = 700
const DEFAULT_ROOM_SETTINGS = {
  maxSpeedMps: 80,
  allowPlayerSpeedControl: false,
  allowManualCreatureSpawn: true,
}

function getEffectiveSettings(settings) {
  return {
    ...DEFAULT_ROOM_SETTINGS,
    ...(settings || {}),
  }
}

function formatBooleanLabel(value) {
  return value ? 'Yes' : 'No'
}

function RoomSettingsPanel({
  settings,
  isHost,
  isSaving,
  disabled = false,
  errorMessage = '',
  onSave,
}) {
  const effectiveSettings = getEffectiveSettings(settings)
  const [draftSettings, setDraftSettings] = useState(() => effectiveSettings)

  const draftSpeed = Number(draftSettings.maxSpeedMps)
  const hasDraftChanges =
    draftSpeed !== Number(effectiveSettings.maxSpeedMps) ||
    draftSettings.allowPlayerSpeedControl !==
      effectiveSettings.allowPlayerSpeedControl ||
    draftSettings.allowManualCreatureSpawn !==
      effectiveSettings.allowManualCreatureSpawn
  const canSave = isHost && hasDraftChanges && !isSaving && !disabled

  function updateDraftSpeed(rawValue) {
    const nextSpeed = Math.min(
      MAX_ROOM_SPEED_MPS,
      Math.max(MIN_ROOM_SPEED_MPS, Number(rawValue) || MIN_ROOM_SPEED_MPS),
    )
    setDraftSettings((currentSettings) => ({
      ...currentSettings,
      maxSpeedMps: nextSpeed,
    }))
  }

  function updateDraftToggle(name, checked) {
    setDraftSettings((currentSettings) => ({
      ...currentSettings,
      [name]: checked,
    }))
  }

  function handleSubmit(event) {
    event.preventDefault()

    if (!canSave) {
      return
    }

    onSave?.({
      maxSpeedMps: draftSpeed,
      allowPlayerSpeedControl: draftSettings.allowPlayerSpeedControl,
      allowManualCreatureSpawn: draftSettings.allowManualCreatureSpawn,
    })
  }

  return (
    <form className="room-settings-panel" onSubmit={handleSubmit}>
      <div className="room-settings-header">
        <p>Gameplay Settings</p>
        {!isHost && <span>Read only</span>}
      </div>

      {isHost ? (
        <>
          <label className="room-settings-speed-control">
            <span>Max speed: {draftSpeed} m/s</span>
            <div className="room-settings-speed-inputs">
              <input
                type="range"
                min={MIN_ROOM_SPEED_MPS}
                max={MAX_ROOM_SPEED_MPS}
                step="10"
                value={draftSpeed}
                onChange={(event) => updateDraftSpeed(event.target.value)}
                disabled={disabled || isSaving}
              />
              <input
                type="number"
                min={MIN_ROOM_SPEED_MPS}
                max={MAX_ROOM_SPEED_MPS}
                step="10"
                value={draftSpeed}
                onChange={(event) => updateDraftSpeed(event.target.value)}
                disabled={disabled || isSaving}
              />
            </div>
          </label>

          <label className="room-settings-toggle">
            <input
              type="checkbox"
              checked={draftSettings.allowPlayerSpeedControl}
              onChange={(event) =>
                updateDraftToggle('allowPlayerSpeedControl', event.target.checked)
              }
              disabled={disabled || isSaving}
            />
            <span>Player speed control</span>
          </label>

          <label className="room-settings-toggle">
            <input
              type="checkbox"
              checked={draftSettings.allowManualCreatureSpawn}
              onChange={(event) =>
                updateDraftToggle('allowManualCreatureSpawn', event.target.checked)
              }
              disabled={disabled || isSaving}
            />
            <span>Manual creature spawn</span>
          </label>

          <button
            type="submit"
            className="primary-button"
            disabled={!canSave}
          >
            {isSaving ? 'Saving' : 'Save Settings'}
          </button>
        </>
      ) : (
        <dl className="room-settings-readonly">
          <div>
            <dt>Max speed</dt>
            <dd>{effectiveSettings.maxSpeedMps} m/s</dd>
          </div>
          <div>
            <dt>Player speed control</dt>
            <dd>{formatBooleanLabel(effectiveSettings.allowPlayerSpeedControl)}</dd>
          </div>
          <div>
            <dt>Manual creature spawn</dt>
            <dd>{formatBooleanLabel(effectiveSettings.allowManualCreatureSpawn)}</dd>
          </div>
        </dl>
      )}

      {errorMessage && <p className="room-settings-error">{errorMessage}</p>}
    </form>
  )
}

export default RoomSettingsPanel
