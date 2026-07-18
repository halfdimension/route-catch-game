import { DomEvent, divIcon } from 'leaflet'
import { Marker, Tooltip } from 'react-leaflet'
import { getRarityClassName } from '../utils/rarityStyles'

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

function getRemainingSeconds(target) {
  return Math.max(0, Math.ceil((target.expiresAt - Date.now()) / 1000))
}

function formatScore(score) {
  return Number.isFinite(Number(score)) ? Number(score) : 0
}

function formatValue(value, fallback = 'Unknown') {
  const text = String(value ?? '').trim()

  return text || fallback
}

function TargetMarker({ target, onClick, isChased, isRouting }) {
  const rarityClassName = getRarityClassName(target.rarity)
  const rarityLabel = formatValue(target.rarity)
  const difficultyLabel = isRouting
    ? 'Routing'
    : isChased
      ? 'Chasing'
      : formatValue(target.difficulty)
  const chaseClassName = isChased
    ? ` is-chased${isRouting ? ' is-routing' : ''}`
    : ''
  const icon = divIcon({
    className: `target-creature-marker ${rarityClassName}${chaseClassName}`,
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
      title={`${target.name}, ${target.rarity} target${
        isChased ? ', currently chased' : ''
      }`}
      eventHandlers={{
        click(event) {
          DomEvent.stop(event.originalEvent)
          onClick(target)
        },
      }}
    >
      <Tooltip
        className={`creature-hover-tooltip ${rarityClassName}`}
        direction="top"
        offset={[0, -18]}
        opacity={1}
      >
        <span
          className={`creature-hover-card ${rarityClassName}`}
          style={{ '--creature-rarity-color': target.color }}
          aria-label={`${target.name}: ${rarityLabel}, ${formatScore(
            target.score,
          )} points, ${getRemainingSeconds(
            target,
          )} seconds remaining, ${difficultyLabel} difficulty`}
        >
          <span className="creature-hover-card-header">
            <span className="creature-hover-card-symbol" aria-hidden="true">
              {target.symbol}
            </span>
            <span className="creature-hover-card-title">
              <strong>{target.name}</strong>
              <span>{rarityLabel}</span>
            </span>
          </span>
          <span className="creature-hover-card-grid">
            <span>
              <span>Score</span>
              <strong>{formatScore(target.score)}</strong>
            </span>
            <span>
              <span>Time</span>
              <strong>{getRemainingSeconds(target)}s</strong>
            </span>
            <span>
              <span>Difficulty</span>
              <strong>{difficultyLabel}</strong>
            </span>
          </span>
        </span>
      </Tooltip>
    </Marker>
  )
}

export default TargetMarker
