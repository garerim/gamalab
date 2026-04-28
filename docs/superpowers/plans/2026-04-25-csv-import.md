# CSV Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Git convention for this project:** The user handles all `git commit` and `git push` operations manually. Each commit step is a pause point with a suggested message — do NOT run `git commit` yourself. Wait for the user to commit (or explicitly ask them to) before proceeding to the next task.

**Goal:** Add CSV import to GamaLab as the natural pendant of the existing CSV export — user clicks Import in the TableBrowser toolbar, picks a CSV file, sees a preview dialog with auto-mapped columns and the first 10 rows, and on confirmation the rows are inserted in a single transaction.

**Architecture:** Native Electron file picker (consistent with `saveExport`) → main reads file content → renderer parses with `papaparse` (`header: true`, BOM-stripped, empty cells → null) → renderer auto-maps CSV headers to table columns case-insensitively → user reviews `ImportCsvDialog` → backend `importRows` runs `BEGIN` + chunked parameterized `INSERT` (500 rows/chunk) + `COMMIT` (or `ROLLBACK` on any error) → toast result and refresh the TableBrowser.

**Tech Stack:** React 18, Electron IPC, `pg` Pool, `papaparse` (~13 KB gz), shadcn `Dialog`, `lucide-react` icons, Tailwind.

**Reference spec:** `docs/superpowers/specs/2026-04-25-csv-import-design.md`

---

## File Structure

**Created:**
- `src/components/ImportCsvDialog.jsx` — preview + auto-mapping + Import button (~200 LOC)

**Modified:**
- `package.json` — add `"papaparse": "^5.4.1"` to `dependencies`
- `electron/services/db.service.js` — add `importRows(id, schema, table, columns, rows)` method (~35 LOC)
- `electron/main.js` — add `ipcMain.handle('dialog:open-csv', ...)` and `ipcMain.handle('db:import-rows', ...)` (~25 LOC total)
- `electron/preload.js` — add `openCsv` to `dialog:` namespace and `importRows` to `db:` namespace (2 lines)
- `src/store/appStore.js` — add `importCsvDialogOpen`, `importCsvContext`, `setImportCsvDialogOpen`, `setImportCsvContext` (~8 LOC)
- `src/components/TableBrowser.jsx` — add `Upload` icon import, `handleImportCsv` callback, Import button in toolbar (~25 LOC)
- `src/App.jsx` — import + mount `<ImportCsvDialog />` (2 lines)

---

## Task 1: Install `papaparse` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

Run from the project root:

```bash
npm install papaparse@^5.4.1
```

Expected: `package.json` and `package-lock.json` are updated. No peer-dependency warnings that block install.

- [ ] **Step 2: Verify the dependency was added**

Inspect `package.json` and confirm a new entry like:

```json
"dependencies": {
  ...
  "papaparse": "^5.4.1",
  ...
}
```

- [ ] **Step 3: Verify the build**

```bash
npx vite build
```

Expected: success.

- [ ] **Step 4: Pause for manual commit**

Suggested message: `chore(deps): add papaparse for CSV import`

---

## Task 2: Add `importRows` method to `db.service.js`

**Files:**
- Modify: `electron/services/db.service.js`

- [ ] **Step 1: Add the method**

Open `electron/services/db.service.js`. Place the method near `exportRows` (around line 679) — its conceptual sibling. Insert after `exportRows`:

```js
  async importRows(id, schema, table, columns, rows) {
    const pool = this.pools.get(id)
    if (!pool) throw new Error('No active connection')
    this._validateIdent(schema)
    this._validateIdent(table)
    for (const col of columns) this._validateIdent(col)

    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: true, inserted: 0 }
    }

    const qualified = `${this._qi(schema)}.${this._qi(table)}`
    const colList = columns.map((c) => this._qi(c)).join(', ')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      let inserted = 0
      const CHUNK = 500
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK)
        const params = []
        const valueClauses = chunk.map((row) => {
          const placeholders = columns.map((_, ci) => {
            params.push(row[ci])
            return `$${params.length}`
          })
          return `(${placeholders.join(', ')})`
        })
        const sql = `INSERT INTO ${qualified} (${colList}) VALUES ${valueClauses.join(', ')}`
        const res = await client.query(sql, params)
        inserted += res.rowCount
      }
      await client.query('COMMIT')
      return { ok: true, inserted }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      return { ok: false, error: this._friendlyError(err), inserted: 0 }
    } finally {
      client.release()
    }
  }
```

Match surrounding style (no semicolons, 2-space indent, async/await).

**Key contract:** the method NEVER throws on SQL/connection errors after the initial pool check — it returns `{ ok: false, error }`. The renderer relies on this contract (consistent with `testConnection` from earlier work).

- [ ] **Step 2: Verify the file parses**

```bash
node -c electron/services/db.service.js
```

Expected: no output.

- [ ] **Step 3: Verify build**

```bash
npx vite build
```

Expected: success.

- [ ] **Step 4: Pause for manual commit**

Suggested message: `feat(db): add importRows with batched transactional INSERT`

---

## Task 3: Wire IPC handlers + preload bindings

**Files:**
- Modify: `electron/main.js`
- Modify: `electron/preload.js`

- [ ] **Step 1: Verify `fs` and `path` are available in main.js**

`dialog:open-csv` needs `fs.promises.readFile`, `fs.promises.stat`, and `path.basename`. Open `electron/main.js` and confirm the requires at the top include both:

```js
const fs = require('fs')
const path = require('path')
```

If either is missing, add it next to the existing `require('electron')` line. Other handlers (logger, services) likely already use them — check before adding to avoid duplicates.

- [ ] **Step 2: Add the `dialog:open-csv` handler**

Locate the existing `dialog:save-export` handler in `electron/main.js` (around line 256). Add the new handler immediately before or after it (group with related handlers):

```js
ipcMain.handle('dialog:open-csv', async (_evt, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import CSV',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    properties: ['openFile'],
    ...options,
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true }
  }
  const filePath = result.filePaths[0]
  try {
    const content = await fs.promises.readFile(filePath, 'utf8')
    const stats = await fs.promises.stat(filePath)
    return {
      canceled: false,
      content,
      filename: path.basename(filePath),
      sizeBytes: stats.size,
    }
  } catch (err) {
    return { canceled: false, error: err.message }
  }
})
```

Match the existing handler style (no semicolons, 2-space indent, async/await).

- [ ] **Step 3: Add the `db:import-rows` handler**

Still in `electron/main.js`, locate the existing `db:export-rows` handler (around line 233). Add the new import handler immediately after it:

```js
ipcMain.handle('db:import-rows', async (_evt, id, schema, table, columns, rows) => {
  return await dbService.importRows(id, schema, table, columns, rows)
})
```

- [ ] **Step 4: Add preload bindings**

Open `electron/preload.js`. Two changes:

**A) Add `openCsv` to the `dialog:` namespace.** Locate the existing `dialog:` block (around line 66-69):

```js
  dialog: {
    saveExport: (options) => ipcRenderer.invoke('dialog:save-export', options),
    savePng: (options) => ipcRenderer.invoke('dialog:save-png', options),
  },
```

Change to:

```js
  dialog: {
    openCsv: (options) => ipcRenderer.invoke('dialog:open-csv', options),
    saveExport: (options) => ipcRenderer.invoke('dialog:save-export', options),
    savePng: (options) => ipcRenderer.invoke('dialog:save-png', options),
  },
```

**B) Add `importRows` to the `db:` namespace.** Locate the existing `exportRows` line (around line 23-24):

```js
    exportRows: (id, schema, table, options) =>
      ipcRenderer.invoke('db:export-rows', id, schema, table, options),
```

Add immediately after it:

```js
    importRows: (id, schema, table, columns, rows) =>
      ipcRenderer.invoke('db:import-rows', id, schema, table, columns, rows),
```

- [ ] **Step 5: Verify both files parse**

```bash
node -c electron/main.js && node -c electron/preload.js
```

Expected: no output.

- [ ] **Step 6: Verify Vite build**

```bash
npx vite build
```

Expected: success.

- [ ] **Step 7: Pause for manual commit**

Suggested message: `feat(csv): wire dialog:open-csv and db:import-rows IPC + preload`

---

## Task 4: Extend store with import-csv state

**Files:**
- Modify: `src/store/appStore.js`

- [ ] **Step 1: Add the new state fields**

Open `src/store/appStore.js`. Add these state fields next to other transient dialog state (e.g. near `confirmDialog` from earlier work):

```js
  // --- Import CSV (transient; context is null when closed) ---
  importCsvDialogOpen: false,
  importCsvContext: null,
```

`importCsvContext` shape (set when the dialog opens, null when closed):

```js
{
  schema: string,
  table: string,
  content: string,         // raw CSV text from main
  filename: string,
  sizeBytes: number,
}
```

- [ ] **Step 2: Add the setters**

Add the setters next to the other dialog setters (e.g. near `setConfirmDialog`):

```js
  // --- Import CSV actions ---
  setImportCsvDialogOpen: (open) => set({ importCsvDialogOpen: open }),
  setImportCsvContext: (ctx) => set({ importCsvContext: ctx }),
```

- [ ] **Step 3: Confirm `partialize` does NOT include the new fields**

The `persist` middleware's `partialize` (already exists in `appStore.js`) lists only durable fields. Verify `importCsvDialogOpen` and `importCsvContext` are NOT added to it. The `content` field of the context is a potentially-large CSV string — must not hit `localStorage`.

- [ ] **Step 4: Verify build**

```bash
npx vite build
```

Expected: success.

- [ ] **Step 5: Pause for manual commit**

Suggested message: `feat(csv): add importCsvDialogOpen/importCsvContext state to appStore`

---

## Task 5: Create `ImportCsvDialog` component

**Files:**
- Create: `src/components/ImportCsvDialog.jsx`

- [ ] **Step 1: Verify `papaparse` import path**

Confirm by quick test in DevTools / test file: the package exports a default object usable as `import Papa from 'papaparse'`. (papaparse is CJS in npm but Vite handles it transparently — `import Papa from 'papaparse'` works.)

- [ ] **Step 2: Verify primitives match the project**

The component uses:
- `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter` from `@/components/ui/dialog` (verified by sibling dialogs like `SaveSnippetDialog`)
- `Button` from `@/components/ui/button` (verified)
- `cn` from `@/lib/utils` (verified)
- Icons `Upload`, `Loader2`, `CheckCircle2`, `Ban` from `lucide-react`

If any path differs in your project, swap accordingly.

- [ ] **Step 3: Write the component**

Create `src/components/ImportCsvDialog.jsx` with this content:

```jsx
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
  const activeConnection = useAppStore((s) =>
    s.connections.find((c) => c.id === s.activeConnectionId) ?? null
  )

  const [parseResult, setParseResult] = useState(null)
  // shape: { headers: string[], rows: object[], errors: any[], mapping: [{csvHeader, tableColumn|null, dropped}] }
  const [tableColumns, setTableColumns] = useState([])
  // shape from listColumns: [{ name, data_type, is_nullable, ... }]
  const [importing, setImporting] = useState(false)
  const [loadError, setLoadError] = useState(null)

  // Load table columns + parse CSV when dialog opens
  useEffect(() => {
    if (!open || !ctx || !activeConnection) return
    let cancelled = false
    setLoadError(null)
    setParseResult(null)
    setTableColumns([])
    ;(async () => {
      try {
        const cols = await window.gamalab.db.listColumns(
          activeConnection.id,
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
  }, [open, ctx, activeConnection])

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
    if (!canImport || !ctx || !activeConnection) return
    setImporting(true)
    const targetColumns = validMapping.map((m) => m.tableColumn)
    const rowsAsArrays = parseResult.rows.map((row) =>
      validMapping.map((m) => row[m.csvHeader] ?? null)
    )
    try {
      const result = await window.gamalab.db.importRows(
        activeConnection.id,
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
                ⚠ {parseResult.errors.length} row{parseResult.errors.length === 1 ? '' : 's'}{' '}
                had parse errors and {parseResult.errors.length === 1 ? 'was' : 'were'} skipped.
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
```

- [ ] **Step 4: Verify build**

```bash
npx vite build
```

Expected: success. Component is created but not yet mounted (Task 6 mounts it).

- [ ] **Step 5: Pause for manual commit**

Suggested message: `feat(csv): add ImportCsvDialog with preview + auto-mapping`

---

## Task 6: Mount dialog in App.jsx + add Import button to TableBrowser

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/components/TableBrowser.jsx`

After this task, the import flow is complete end-to-end.

- [ ] **Step 1: Mount `ImportCsvDialog` in App.jsx**

Open `src/App.jsx`. Add an import near the other dialog imports (e.g. next to `ConfirmDialog`):

```js
import { ImportCsvDialog } from '@/components/ImportCsvDialog'
```

In the JSX, mount it next to other dialogs (e.g. `<ConfirmDialog />`, `<SaveSnippetDialog />`):

```jsx
        <ImportCsvDialog />
```

- [ ] **Step 2: Add `Upload` icon import to TableBrowser**

Open `src/components/TableBrowser.jsx`. Locate the existing `lucide-react` import. Add `Upload` to it. Example: if the existing import is

```js
import { Download, Filter, Plus, Trash2, Pencil, ... } from 'lucide-react'
```

change to

```js
import { Download, Filter, Plus, Trash2, Pencil, Upload, ... } from 'lucide-react'
```

(Adjust to match the actual existing import in the file.)

- [ ] **Step 3: Pull import-csv setters from the store**

Inside the `TableBrowser` function body, near the other store selectors, add:

```js
  const setImportCsvDialogOpen = useAppStore((s) => s.setImportCsvDialogOpen)
  const setImportCsvContext = useAppStore((s) => s.setImportCsvContext)
```

If the existing destructure pattern in this component is `const { ... } = useAppStore()`, you may either match that pattern or use individual selectors. The new code uses individual selectors (consistent with newer code patterns). Both work.

- [ ] **Step 4: Add the `handleImportCsv` callback**

Place near the existing `handleExport` callback (around line 709):

```js
  const handleImportCsv = async () => {
    if (!activeConnection || !activeTable) return
    const result = await window.gamalab.dialog.openCsv()
    if (result.canceled) return
    if (result.error) {
      showToast(`Failed to read CSV: ${result.error}`, 'error')
      return
    }
    setImportCsvContext({
      schema: activeTable.schema,
      table: activeTable.name,
      content: result.content,
      filename: result.filename,
      sizeBytes: result.sizeBytes,
    })
    setImportCsvDialogOpen(true)
  }
```

- [ ] **Step 5: Add the Import button in the toolbar**

Locate the toolbar in TableBrowser's JSX where the Export menu is rendered. Add a new Import button immediately to the LEFT of the Export menu trigger (so the natural reading order is Import → Export):

```jsx
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                onClick={handleImportCsv}
                disabled={!activeConnection || !activeTable}
                title="Import CSV into this table"
              >
                <Upload className="h-3 w-3" />
                Import
              </Button>
```

If the toolbar uses different button props (sizing, classNames), match the existing Export button's style exactly.

- [ ] **Step 6: Verify build**

```bash
npx vite build
```

Expected: success.

- [ ] **Step 7: Smoke test (optional, interactive)**

If you can run `npm run dev`:
1. Open a table in TableBrowser
2. Click Import → native file picker opens with .csv filter
3. Pick a small valid CSV (or generate one: 2 columns matching the table, 3 rows)
4. Dialog opens with preview
5. Click "Import N rows" → toast appears, dialog closes, rows appear in the table

If interactive testing isn't available, the build verification of Step 6 is sufficient.

- [ ] **Step 8: Pause for manual commit**

Suggested message: `feat(csv): wire Import button in TableBrowser and mount ImportCsvDialog`

---

## Task 7: Final manual verification checklist

**Files:** none — verification only.

- [ ] **Step 1: Walk the spec's manual verification checklist end-to-end**

From `docs/superpowers/specs/2026-04-25-csv-import-design.md` (Testing section):

- [ ] Import button visible in `TableBrowser` toolbar next to Export menu
- [ ] Import button disabled when no connection or no active table
- [ ] Click → native file picker opens with `.csv` filter
- [ ] Cancel file picker → no dialog opens, no error
- [ ] Pick a valid CSV → `ImportCsvDialog` opens with header / mapping / preview
- [ ] Auto-mapping shows ✅ for matched columns and ⊘ for dropped CSV columns
- [ ] Preview displays first 10 rows in a scrollable table
- [ ] Click Cancel → dialog closes, no DB mutation
- [ ] Click "Import N rows" with valid CSV → spinner, then toast `Imported N rows`, dialog closes, table refreshes with new rows
- [ ] **Round-trip:** Export the table as CSV → wipe rows (or use a different empty table with same schema) → Import the CSV back → row count and contents match
- [ ] CSV with one header in DIFFERENT case (e.g. `Email` for column `email`) → matched (case-insensitive)
- [ ] CSV with extra column not in table → `⊘` icon, still importable, that column ignored
- [ ] CSV with type mismatch (e.g. text in integer column) → toast friendly error, table unchanged (transaction rolled back)
- [ ] CSV with PK conflict (e.g. id 1 already exists) → toast friendly error, table unchanged
- [ ] Empty cells in CSV → NULLs in DB (verifiable via SELECT)
- [ ] CSV with BOM (Excel-saved CSV) → imports correctly
- [ ] CSV with multi-line quoted cells (description with `\n`) → imports correctly
- [ ] Esc / backdrop click during import → blocked
- [ ] CSV with no rows → Import button disabled, banner explains
- [ ] CSV where no column matches the table → Import button disabled
- [ ] Verify connection switch during dialog open: import still goes to the original connection captured at open time

- [ ] **Step 2: Pause for any final polish commits (rare)**

If you made tiny tweaks during verification (spacing, copy), group them into one commit: `polish(csv): verification pass`.

---

## Self-review

**Spec coverage cross-check:**

- ✅ `papaparse` dependency → Task 1
- ✅ `importRows(id, schema, table, columns, rows)` backend method with BEGIN/COMMIT/ROLLBACK + chunked params + `_validateIdent` + `_friendlyError` → Task 2
- ✅ IPC `dialog:open-csv` with native dialog + fs.readFile → Task 3
- ✅ IPC `db:import-rows` → Task 3
- ✅ Preload bindings `openCsv` and `importRows` → Task 3
- ✅ Store fields `importCsvDialogOpen`, `importCsvContext` + setters → Task 4
- ✅ `partialize` exclusion check → Task 4 Step 3
- ✅ `ImportCsvDialog` component with parse + auto-map + preview + transaction warning + Import button → Task 5
- ✅ Mount in App.jsx → Task 6 Step 1
- ✅ Import button in TableBrowser toolbar with Upload icon + handler → Task 6 Steps 2-5
- ✅ Manual verification checklist → Task 7
- ✅ Empty cell → null transform → Task 5 (Papa.parse `transform`)
- ✅ Auto-map case-insensitive → Task 5 (Map of lowercase names)
- ✅ Block close during import → Task 5 (`onOpenChange` guard)
- ✅ Refresh TableBrowser after success → Task 5 (`bumpTablesRefresh`)

**Type / signature consistency check:**

- `importRows(id, schema, table, columns, rows)` — defined in Task 2, called identically from Task 3 (IPC) and Task 5 (renderer)
- `dialog.openCsv(options)` returns `{ canceled, content?, filename?, sizeBytes?, error? }` — defined in Task 3, consumed in Task 6 Step 4 (`handleImportCsv`)
- `setImportCsvContext(ctx)` accepts shape `{ schema, table, content, filename, sizeBytes }` — defined in Task 4, set in Task 6 (`handleImportCsv`), read in Task 5 (`ctx.schema`, `ctx.content`, etc.)
- Mapping shape `{ csvHeader, tableColumn, dropped }` — defined and used identically throughout Task 5

**Placeholder scan:** No "TBD" / "TODO" / vague "implement later" markers. Each step has either complete code or precise instructions. The optional smoke test in Task 6 Step 7 is explicitly marked optional.

**Order of tasks safety:**
- Task 1 (npm install) is a no-op for the running app.
- Task 2 (add backend method) doesn't break anything; method is unused until Task 6.
- Task 3 (IPC) doesn't break anything; handlers are unused until Task 5/6.
- Task 4 (store) is purely additive.
- Task 5 (component file) — created but not mounted yet, so app behavior unchanged.
- Task 6 (mount + button) — first user-visible change. End-to-end import works after this task.
- Task 7 — verification only.

App stays functional between every task.
