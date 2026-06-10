import TargetMarker from './TargetMarker'

function TargetLayer({ targets, onTargetClick }) {
  return (
    <>
      {targets.map((target) => (
        <TargetMarker
          key={target.id}
          target={target}
          onClick={onTargetClick}
        />
      ))}
    </>
  )
}

export default TargetLayer
