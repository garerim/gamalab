import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { ExternalLink, KeyRound, Link as LinkIcon, Lock } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { schemaHue } from '@/lib/schemaLayout'
import { cn } from '@/lib/utils'

function formatRowCount(n, isEstimate) {
  if (n == null) return ''
  const abs = Math.abs(n)
  let label
  if (abs >= 1_000_000) label = (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  else if (abs >= 1_000) label = (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k'
  else label = String(n)
  return `${isEstimate ? '~' : ''}${label} rows`
}

function TableNodeInner({ data, selected }) {
  const { schema, name, columns, indexes, rowCount, isEstimate } = data
  const setActiveTable = useAppStore((s) => s.setActiveTable)
  const setSidebarTab = useAppStore((s) => s.setSidebarTab)
  const hue = schemaHue(schema)
  const borderColor = `hsl(${hue} 60% 55%)`

  return (
    <div
      className={cn(
        'group rounded-md bg-[#1e1e1e] text-[#e8e8e8] font-mono text-xs shadow-lg',
        selected && 'ring-2 ring-offset-2 ring-offset-[#1e1e1e]'
      )}
      style={{ border: `1px solid ${borderColor}`, minWidth: 240 }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-2 rounded-t-md border-b px-3 py-1.5"
        style={{ background: `hsl(${hue} 30% 18%)`, borderBottomColor: borderColor }}
      >
        <div className="flex items-baseline gap-1 truncate">
          <span className="text-[10px] text-muted-foreground">{schema}.</span>
          <span className="truncate font-semibold text-[#ffa657]">{name}</span>
        </div>
        <div className="flex items-center gap-2">
          {rowCount != null && (
            <span className="text-[10px] text-muted-foreground">
              {formatRowCount(rowCount, isEstimate)}
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              setActiveTable({ schema, name })
              setSidebarTab('tables')
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
            title="Open in Table Browser"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Columns */}
      <div className="py-1">
        {columns.map((c) => (
          <div
            key={c.name}
            className="relative flex items-center justify-between gap-3 px-3 py-0.5"
          >
            {/* Left handle — for incoming FK edges */}
            <Handle
              type="target"
              position={Position.Left}
              id={c.name}
              style={{ background: 'transparent', border: 'none', width: 6, height: 6, left: -3 }}
            />
            <div className="flex min-w-0 items-center gap-1.5 truncate">
              {c.isPrimary && <KeyRound className="h-3 w-3 flex-none text-[#f0c674]" />}
              {!c.isPrimary && c.foreignKey && (
                <LinkIcon className="h-3 w-3 flex-none text-[#7ec699]" />
              )}
              {!c.isPrimary && !c.foreignKey && c.isUnique && (
                <Lock className="h-3 w-3 flex-none text-[#b294bb]" />
              )}
              <span className={cn('truncate', c.isPrimary && 'font-semibold')}>{c.name}</span>
            </div>
            <span className="flex-none text-[10px] text-muted-foreground">
              {c.type}
              {!c.nullable && ' NOT NULL'}
              {c.foreignKey ? '' : c.isUnique && !c.isPrimary ? ' UQ' : ''}
            </span>
            {/* Right handle — for outgoing FK edges */}
            <Handle
              type="source"
              position={Position.Right}
              id={c.name}
              style={{ background: 'transparent', border: 'none', width: 6, height: 6, right: -3 }}
            />
          </div>
        ))}
      </div>

      {/* Indexes footer */}
      {indexes?.length > 0 && (
        <div className="rounded-b-md border-t border-[#2d2d30] bg-[#181818] px-3 py-1 text-[10px] text-muted-foreground">
          {indexes.map((idx) => (
            <div key={idx.name} className="truncate">
              idx: {idx.name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export const TableNode = memo(TableNodeInner)
