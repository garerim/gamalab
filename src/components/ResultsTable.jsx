import { useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  AlertTriangle,
  CheckCircle2,
  Table2,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn, formatDuration } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'

const PAGE_SIZE = 100

function renderValue(v) {
  if (v === null || v === undefined) return <span className="italic text-muted-foreground">NULL</span>
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function copyToClipboard(text) {
  navigator.clipboard?.writeText(text).catch(() => {})
}

export function ResultsTable() {
  const { queryResult, queryError, queryRunning, showToast } = useAppStore()
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState(null)

  const result = queryResult

  const rows = result?.rows || []
  const fields = result?.fields || (rows[0] ? Object.keys(rows[0]).map((n) => ({ name: n })) : [])

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const pageRows = useMemo(
    () => rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE),
    [rows, currentPage]
  )

  const copyRow = (row) => {
    const values = fields.map((f) => row[f.name]).join('\t')
    copyToClipboard(values)
    showToast('Row copied', 'info')
  }

  const copyCell = (value) => {
    copyToClipboard(value === null || value === undefined ? '' : String(value))
    showToast('Cell copied', 'info')
  }

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex h-9 items-center justify-between border-b border-border bg-card px-3">
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
            <Table2 className="h-3.5 w-3.5" />
            Results
          </div>

          {queryRunning && (
            <Badge variant="info" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Running
            </Badge>
          )}

          {!queryRunning && queryError && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              Error
            </Badge>
          )}

          {!queryRunning && result && !queryError && (
            <>
              <Badge variant="success" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {result.command || 'OK'}
              </Badge>
              <span className="text-muted-foreground">
                {rows.length} row{rows.length !== 1 ? 's' : ''}
              </span>
              {typeof result.duration === 'number' && (
                <span className="text-muted-foreground">· {formatDuration(result.duration)}</span>
              )}
            </>
          )}
        </div>

        {pageCount > 1 && (
          <div className="flex items-center gap-1 text-xs">
            <Button
              size="iconSm"
              variant="ghost"
              disabled={currentPage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="px-1 text-muted-foreground">
              {currentPage + 1} / {pageCount}
            </span>
            <Button
              size="iconSm"
              variant="ghost"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {queryError ? (
          <div className="m-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 font-mono text-xs text-destructive">
            {queryError}
          </div>
        ) : !result ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
            Run a query to see results. Press <kbd className="mx-1 rounded border border-border bg-card px-1">Ctrl/Cmd+Enter</kbd> to execute.
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
            Query executed successfully. No rows returned.
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-card">
              <tr>
                <th className="sticky left-0 z-20 w-10 border-b border-r border-border bg-card px-2 py-1.5 text-right text-[10px] font-normal text-muted-foreground">
                  #
                </th>
                {fields.map((f) => (
                  <th
                    key={f.name}
                    className="border-b border-r border-border px-3 py-1.5 text-left font-medium text-foreground"
                  >
                    {f.name}
                  </th>
                ))}
                <th className="border-b border-border px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, i) => {
                const idx = currentPage * PAGE_SIZE + i
                const isSelected = selected === idx
                return (
                  <tr
                    key={idx}
                    className={cn(
                      'group',
                      isSelected ? 'bg-accent/30' : i % 2 === 0 ? 'bg-background' : 'bg-card/40'
                    )}
                    onClick={() => setSelected(idx)}
                  >
                    <td className="sticky left-0 border-b border-r border-border bg-inherit px-2 py-1 text-right text-muted-foreground">
                      {idx + 1}
                    </td>
                    {fields.map((f) => (
                      <td
                        key={f.name}
                        className="max-w-xs truncate border-b border-r border-border px-3 py-1 font-mono"
                        title={row[f.name] === null ? 'NULL' : String(row[f.name])}
                        onDoubleClick={() => copyCell(row[f.name])}
                      >
                        {renderValue(row[f.name])}
                      </td>
                    ))}
                    <td className="w-8 border-b border-border px-1 py-1">
                      <Button
                        size="iconSm"
                        variant="ghost"
                        className="h-5 w-5 opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation()
                          copyRow(row)
                        }}
                        title="Copy row"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
