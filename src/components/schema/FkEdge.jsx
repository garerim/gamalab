import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react'
import { useAppStore } from '@/store/appStore'

function FkEdgeInner(props) {
  const {
    id,
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    markerEnd,
  } = props

  const selectedEdgeId = useAppStore((s) => s.selectedEdgeId)
  const setSelectedEdgeId = useAppStore((s) => s.setSelectedEdgeId)

  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  })

  const isSelected = selectedEdgeId === id
  const isOtherSelected = selectedEdgeId && !isSelected

  const stroke = isSelected ? '#ff9a3c' : '#4a9eff'
  const strokeWidth = isSelected ? 2.5 : 1.5
  const opacity = isOtherSelected ? 0.2 : 1

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ stroke, strokeWidth, opacity }}
        interactionWidth={20}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
            opacity,
          }}
          className="nodrag nopan"
          onClick={(e) => {
            e.stopPropagation()
            setSelectedEdgeId(isSelected ? null : id)
          }}
        >
          <div
            className="rounded border px-1.5 py-0.5 text-[10px] font-mono cursor-pointer"
            style={{
              background: isSelected ? '#ff9a3c' : '#252526',
              color: isSelected ? '#1e1e1e' : '#888',
              borderColor: isSelected ? '#ff9a3c' : '#3e3e42',
            }}
          >
            1 — *
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export const FkEdge = memo(FkEdgeInner)
