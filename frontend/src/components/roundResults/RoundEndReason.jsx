import { formatRoundEndReason } from './roundResultFormatters'

function RoundEndReason({ reason }) {
  return (
    <p className="round-results-end-reason">
      {formatRoundEndReason(reason)}
    </p>
  )
}

export default RoundEndReason
