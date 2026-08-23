import { SOLO_TRAVEL_MODE_OPTIONS } from '../config/travelMode.js'

function TravelModeSelector({
  selectedTravelMode,
  activeTravelMode,
  onSelectedTravelModeChange,
  disabled = false,
  className = '',
}) {
  const isLocked = disabled || activeTravelMode !== null

  return (
    <fieldset
      className={`travel-mode-selector${className ? ` ${className}` : ''}`}
      disabled={isLocked}
    >
      <legend>Travel mode</legend>
      <div className="travel-mode-options">
        {SOLO_TRAVEL_MODE_OPTIONS.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name="solo-travel-mode"
              value={option.value}
              checked={selectedTravelMode === option.value}
              disabled={isLocked}
              onChange={() => {
                if (!isLocked) {
                  onSelectedTravelModeChange(option.value)
                }
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export default TravelModeSelector
