import TargetMarker from './TargetMarker'

function TargetLayer({
  targets,
  onTargetClick,
  chasedTargetId,
  routingTargetId,
}) {
  return (
    <>
      {targets.map((target) => (
        <TargetMarker
          key={target.id}
          target={target}
          onClick={onTargetClick}
          isChased={target.id === chasedTargetId}
          isRouting={target.id === routingTargetId}
        />
      ))}
    </>
  )
}

export default TargetLayer
