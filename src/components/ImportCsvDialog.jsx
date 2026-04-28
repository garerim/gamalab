// src/components/ImportCsvDialog.jsx
// Preview + auto-mapping dialog for CSV import. Reads importCsvContext from the
// store, parses with papaparse, displays the mapping/preview, and on confirm
// dispatches db:import-rows in a single transaction.

import { useEffect, useMemo, useState } from 'react'
import Papa from 'papaparse'
import { Upload, Loader2, CheckCircle2, Ban } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ImportCsvDialog() {
  const open = useAppStore((s) => s.importCsvDialogOpen)
  const ctx = useAppStore((s) => s.importCsvContext)
  const setOpen = useAppStore((s) => s.setImportCsvDialogOpen)
  const setContext = useAppStore((s) => s.setImportCsvContext)
  const showToast = useAppStore((s) => s.showToast)
  const bumpTablesRefresh = useAppStore((s) => s.bumpTablesRefresh)

  const [parseResult, setParseResult] = useState(null)
  // shape: { headers: string[], rows: object[], errors: any[], mapping: [{csvHeader, tableColumn|null, dropped}] }
  const [tableColumns, setTableColumns] = useState([])
  // shape from listColumns: [{ name, data_type, is_nullable, ... }]
  const [importing, setImporting] = useState(false)
  const [loadError, setLoadError] = useState(null)

  // Load table columns + parse CSV when dialog opens
  useEffect(() => {
    if (!open || !ctx) return
    let cancelled = false
    setLoadError(null)
    setParseResult(null)
    setTableColumns([])
    ;(async () => {
      try {
        const cols = await window.gamalab.db.listColumns(
          ctx.connectionId,
          ctx.schema,
          ctx.table
        )
        if (cancelled) return
        setTableColumns(cols)

        const parsed = Papa.parse(ctx.content, {
          header: true,
          skipEmptyLines: true,
          transform: (value) => (value === '' ? null : value),
        })
        if (cancelled) return

        const csvHeaders = parsed.meta.fields || []
        const colNames = cols.map((c) => c.name)
        const colNamesLower = new Map(colNames.map((n) => [n.toLowerCase(), n]))
        const mapping = csvHeaders.map((h) => {
          const matched = colNamesLower.get(h.toLowerCase())
          return {
            csvHeader: h,
            tableColumn: matched || null,
            dropped: !matched,
          }
        })

        setParseResult({
          headers: csvHeaders,
          rows: parsed.data,
          errors: parsed.errors || [],
          mapping,
        })
      } catch (err) {
        if (cancelled) return
        setLoadError(err.message || String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, ctx])

  // Reset on close
  useEffect(() => {
    if (!open) {
      setParseResult(null)
      setTableColumns([])
      setImporting(false)
      setLoadError(null)
    }
  }, [open])

  const validMapping = useMemo(
    () => (parseResult ? parseResult.mapping.filter((m) => !m.dropped) : []),
    [parseResult]
  )

  const tableColumnTypeMap = useMemo(() => {
    const m = new Map()
    for (const c of tableColumns) m.set(c.name, c.data_type || c.udt_name || '')
    return m
  }, [tableColumns])

  const canImport =
    !importing &&
    parseResult &&
    parseResult.rows.length > 0 &&
    validMapping.length > 0

  const handleImport = async () => {
    if (!canImport || !ctx) return
    setImporting(true)
    const targetColumns = validMapping.map((m) => m.tableColumn)
    const rowsAsArrays = parseResult.rows.map((row) =>
      validMapping.map((m) => row[m.csvHeader] ?? null)
    )
    try {
      const result = await window.gamalab.db.importRows(
        ctx.connectionId,
        ctx.schema,
        ctx.table,
        targetColumns,
        rowsAsArrays
      )
      if (result.ok) {
        showToast(
          `Imported ${result.inserted} row${result.inserted === 1 ? '' : 's'}`,
          'success'
        )
        bumpTablesRefresh()
        setOpen(false)
        setContext(null)
      } else {
        showToast(`Import failed: ${result.error}`, 'error')
      }
    } catch (err) {
      showToast(`Import failed: ${err.message}`, 'error')
    } finally {
      setImporting(false)
    }
  }

  const onOpenChange = (next) => {
    if (importing) return
    if (!next) {
      setOpen(false)
      setContext(null)
    }
  }

  if (!open || !ctx) return null

  const previewRows = parseResult ? parseResult.rows.slice(0, 10) : []

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-lab-blue" />
            Import CSV into "{ctx.schema}.{ctx.table}"
          </DialogTitle>
        </DialogHeader>

        {/* File summary */}
        <div className="flex items-center gap-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
          <span className="font-mono">{ctx.filename}</span>
          <span className="text-muted-foreground">·</span>
          <span>{formatSize(ctx.sizeBytes)}</span>
          {parseResult && (
            <>
              <span className="text-muted-foreground">·</span>
              <span>{parseResult.rows.length} rows</span>
            </>
          )}
        </div>

        {/* Loading / error state */}
        {!parseResult && !loadError && (
          <div className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Parsing CSV…
          </div>
        )}
        {loadError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Failed to load: {loadError}
          </div>
        )}

        {parseResult && (
          <>
            {/* Mapping list */}
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-medium text-muted-foreground">
                Auto-mapped ({validMapping.length} / {parseResult.mapping.length} columns)
              </div>
              <div className="flex flex-col gap-0.5 rounded-md border border-border bg-card px-2 py-1.5 text-[11px] font-mono">
                {parseResult.mapping.length === 0 && (
                  <span className="italic text-muted-foreground">
                    No columns detected in the CSV header.
                  </span>
                )}
                {parseResult.mapping.map((m) => (
                  <div key={m.csvHeader} className="flex items-center gap-2">
                    {m.dropped ? (
                      <Ban className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                    ) : (
                      <CheckCircle2 className="h-3 w-3 shrink-0 text-lab-green" />
                    )}
                    <span className={cn('truncate', m.dropped && 'text-muted-foreground/70')}>
                      {m.csvHeader}
                    </span>
                    <span className="text-muted-foreground">→</span>
                    {m.dropped ? (
                      <span className="italic text-muted-foreground">
                        (not in table — will be dropped)
                      </span>
                    ) : (
                      <span>
                        {m.tableColumn}
                        {tableColumnTypeMap.get(m.tableColumn) && (
                          <span className="text-muted-foreground">
                            {' '}
                            ({tableColumnTypeMap.get(m.tableColumn)})
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Parse warnings */}
            {parseResult.errors.length > 0 && (
              <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs">
                ⚠ {parseResult.errors.length} parse warning{parseResult.errors.length === 1 ? '' : 's'} detected.
                Affected rows may have missing or malformed cells — review the preview before importing.
              </div>
            )}

            {/* Preview table */}
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-medium text-muted-foreground">
                Preview (first {Math.min(10, parseResult.rows.length)} of {parseResult.rows.length} rows)
              </div>
              <div className="max-h-64 overflow-auto rounded-md border border-border">
                <table className="w-full font-mono text-[11px]">
                  <thead className="sticky top-0 bg-muted/30">
                    <tr>
                      {validMapping.map((m) => (
                        <th
                          key={m.csvHeader}
                          className="border-b border-r border-border px-2 py-1 text-left font-semibold last:border-r-0"
                        >
                          {m.tableColumn}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.length === 0 && (
                      <tr>
                        <td
                          colSpan={Math.max(1, validMapping.length)}
                          className="px-2 py-3 text-center italic text-muted-foreground"
                        >
                          No rows to import.
                        </td>
                      </tr>
                    )}
                    {previewRows.map((row, i) => (
                      <tr key={i} className="even:bg-muted/10">
                        {validMapping.map((m) => {
                          const v = row[m.csvHeader]
                          return (
                            <td
                              key={m.csvHeader}
                              className="border-b border-r border-border px-2 py-1 last:border-r-0"
                            >
                              {v === null || v === undefined ? (
                                <span className="text-muted-foreground/60">NULL</span>
                              ) : (
                                String(v)
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Transaction warning */}
            <div className="rounded-md border border-border bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground">
              ⚠ All rows imported in a single transaction. Any error rolls back the
              whole import.
            </div>
          </>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={importing}
          >
            Cancel
          </Button>
          <Button
            variant="lab"
            onClick={handleImport}
            disabled={!canImport}
          >
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Importing…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Import {parseResult?.rows.length ?? 0} row
                {parseResult?.rows.length === 1 ? '' : 's'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
