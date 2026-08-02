import { DomEvent, divIcon } from 'leaflet'
import { Marker, Tooltip } from 'react-leaflet'
import { getTargetMarkerViewModel } from './targetMarkerViewModel'

const TARGET_ICON_SIZE = 44
const TARGET_ICON_ANCHOR = TARGET_ICON_SIZE / 2

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      })[character],
  )
}

function TargetMarker({ target, onClick, isChased, isRouting }) {
  const viewModel = getTargetMarkerViewModel(target, {
    isChased,
    isRouting,
  })
  const icon = divIcon({
    className: viewModel.markerClassName,
    html: `
      <span class="target-creature-marker-core">
        <span class="target-creature-marker-symbol">${escapeHtml(target.symbol)}</span>
      </span>
    `,
    iconAnchor: [TARGET_ICON_ANCHOR, TARGET_ICON_ANCHOR],
    iconSize: [TARGET_ICON_SIZE, TARGET_ICON_SIZE],
  })

  return (
    <Marker
      position={[target.lat, target.lon]}
      icon={icon}
      pane="creature-marker-pane"
      bubblingMouseEvents={false}
      zIndexOffset={400}
      title={viewModel.title}
      eventHandlers={{
        click(event) {
          DomEvent.stop(event.originalEvent)
          onClick(target)
        },
      }}
    >
      <Tooltip
        className={`creature-hover-tooltip ${viewModel.rarityClassName}`}
        direction="top"
        offset={[0, -18]}
        opacity={1}
      >
        <span
          className={`creature-hover-card ${viewModel.rarityClassName}`}
          style={{ '--creature-rarity-color': target.color }}
          aria-label={viewModel.ariaLabel}
        >
          <span className="creature-hover-card-header">
            <span className="creature-hover-card-symbol" aria-hidden="true">
              {target.symbol}
            </span>
            <span className="creature-hover-card-title">
              <strong>{target.name}</strong>
              <span>{viewModel.rarityLabel}</span>
            </span>
          </span>
          <span className="creature-hover-card-grid">
            <span>
              <span>Score</span>
              <strong>{viewModel.score}</strong>
            </span>
            <span>
              <span>Time</span>
              <strong>{viewModel.remainingSeconds}s</strong>
            </span>
            <span>
              <span>Difficulty</span>
              <strong>{viewModel.difficultyLabel}</strong>
            </span>
          </span>
        </span>
      </Tooltip>
    </Marker>
  )
}

export default TargetMarker
