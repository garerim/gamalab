# CSV Import — Design

**Status:** Design approved, pending implementation
**Date:** 2026-04-25
**Author:** Matheo (via brainstorming session)

## Summary

Add CSV import to GamaLab as the natural pendant of the existing CSV export. User clicks "Import" in the `TableBrowser` toolbar → native file picker → renderer parses the CSV via `papaparse` → `ImportCsvDialog` shows the filename, auto-mapped columns (case-insensitive name match against the target table's columns), and a preview of the first 10 rows → user clicks "Import N rows" → backend inserts all rows in a single transaction (all-or-nothing) and the table refreshes. Scope is intentionally minimal (no manual mapping UI, no ON CONFLICT options, no skip-on-error mode) — those are explicit v2 candidates.

## Goals

- Provide round-trip parity with the existing CSV export
- Keep the UX honest: show the user EXACTLY what will be inserted before they commit (preview)
- Use industry-standard CSV parsing (`papaparse`) to handle real-world CSVs (BOM, quoted multi-line cells, escapes)
- All-or-nothing semantics: the import either fully succeeds or leaves the table untouched
- Match existing GamaLab patterns: native dialog (like `saveExport`), renderer-side format handling (like `exportFormatters`), shadcn `Dialog` primitive (like all other dialogs)
- Anti-injection: parametrized `INSERT` with placeholders + `_validateIdent` guards on table/schema/column names

## Non-goals (v1)

- Manual column mapping UI (auto-map only; non-matching CSV columns are dropped silently with visual indicator)
- ON CONFLICT options (DO NOTHING / DO UPDATE) — plain INSERT, fails on PK/UNIQUE conflict
- Skip-on-error mode (per-row commit) — single transaction, full rollback on any error
- Drag-and-drop a file onto the table to trigger import — button-only
- CSV without header row
- Auto-detection of delimiter (always comma)
- Auto-detection / selection of file encoding (UTF-8 only)
- Importing into a NEW table that doesn't exist (extend with create-table flow)
- Streaming / chunked progress for very large files (acceptable for ≤ 100 MB CSVs in v1)
- Right-click on a table to import (button is in the open table's toolbar)
- Saving import config / mapping presets

## Architecture

### Data flow

1. User clicks "Import" button in `TableBrowser` toolbar
2. Renderer calls `window.gamalab.dialog.openCsv()` → IPC `dialog:open-csv`
3. Main: `dialog.showOpenDialog` (native, `.csv` filter) → user picks file → `fs.promises.readFile(path, 'utf8')` → returns `{ canceled, content, filename, sizeBytes }`
4. Renderer parses with `papaparse`: `Papa.parse(content, { header: true, skipEmptyLines: true, transform: (v) => v === '' ? null : v })`
5. Renderer fetches the target table's columns via existing `window.gamalab.db.listColumns(connId, schema, table)`
6. Renderer builds the auto-mapping: for each CSV header, look up case-insensitive in table column names → if match, map; else mark dropped
7. `ImportCsvDialog` opens with header section, auto-mapping list, preview of first 10 rows, transaction warning, and `[Cancel] [Import N rows]` footer
8. User clicks "Import N rows" → renderer calls `window.gamalab.db.importRows(connId, schema, table, columns, rowsAsArrays)` → IPC `db:import-rows`
9. Main: `dbService.importRows(...)` → `BEGIN` → batched `INSERT INTO schema.table (cols) VALUES (...), (...)` → `COMMIT` (or `ROLLBACK` on error). Returns `{ ok: true, inserted: N }` or `{ ok: false, error, inserted: 0 }`. Never throws.
10. Renderer toasts result, calls `bumpTablesRefresh()` to refresh `TableBrowser`, closes dialog

### Choices made (Q1-Q3 brainstorm decisions)

- **Q1 = A (MVP minimal scope)**: no manual mapping, no ON CONFLICT, no skip-on-error
- **Q2 = A (preview dialog)**: full preview before commit, not a simple confirm
- **Q3 = B (papaparse)**: ~13 KB gzipped industry-standard parser, handles RFC 4180 edge cases out-of-the-box

### Choices made implicitly (defaults)

- **File picker**: native (Electron `dialog.showOpenDialog`) for consistency with `saveExport` / `savePng`
- **Parse location**: renderer (mirrors `exportFormatters.js` pattern; main does FS only)
- **NULL handling**: empty CSV cell → `null` (via papaparse `transform`)
- **Header row**: assumed present (papaparse `header: true`)
- **Delimiter**: comma only (papaparse default)
- **Encoding**: UTF-8 only (`fs.readFile` with encoding hint, papaparse handles BOM stripping)
- **Auto-map matching**: case-insensitive name match
- **Dropped columns**: silently skipped, shown with ⊘ icon in the mapping section
- **All-or-nothing**: single transaction; any row error → ROLLBACK whole import
- **Conflict on PK**: plain INSERT fails → rollback (per Q1=A scope)

## Backend

### Service method (`electron/services/db.service.js`)

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
    const CHUNK = 500  // bounded to stay well under pg's ~65k parameter limit
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

**Key contracts**:
- **Never throws** on connection-level errors after the initial pool check; returns `{ ok: false, error }` (consistent with `testConnection`)
- **`_validateIdent` on every identifier** (schema, table, every column) — anti-injection
- **Parametrized values** via `$1, $2, …` — anti-injection on data
- **Transaction**: BEGIN before first chunk, COMMIT after last; ROLLBACK on any error
- **Chunking**: 500 rows per `INSERT VALUES (...), (...), ...` — prevents hitting pg's ~65k parameter cap on tables with many columns
- **Friendly errors**: pg errors routed through `_friendlyError` for parity with `connect`/`testConnection`

### IPC handlers (`electron/main.js`)

In the existing Database / Dialog sections:

```js
// In dialog section
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

// In database section (after db:export-rows)
ipcMain.handle('db:import-rows', async (_evt, id, schema, table, columns, rows) => {
  return await dbService.importRows(id, schema, table, columns, rows)
})
```

`fs` and `path` are likely already required at the top of `main.js` (used by other handlers); if not, add them.

### Preload bindings (`electron/preload.js`)

```js
// In dialog: namespace
openCsv: (options) => ipcRenderer.invoke('dialog:open-csv', options),
// In db: namespace, near exportRows
importRows: (id, schema, table, columns, rows) =>
  ipcRenderer.invoke('db:import-rows', id, schema, table, columns, rows),
```

## Renderer-side state

`appStore.js` gets two new fields and two setters:

```js
// State
importCsvDialogOpen: false,
importCsvContext: null,
// importCsvContext shape (when open):
//   { schema, table, content, filename, sizeBytes }

// Actions
setImportCsvDialogOpen: (open) => set({ importCsvDialogOpen: open }),
setImportCsvContext: (ctx) => set({ importCsvContext: ctx }),
```

`importCsvContext` is **NOT** persisted (transient UI state, contains potentially-large CSV string).

## UI components

### `TableBrowser.jsx` toolbar — new "Import" button

Add next to the existing Export menu (which is the natural pendant). Use `Upload` icon from `lucide-react`.

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

Handler:

```jsx
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

### `ImportCsvDialog.jsx` — new component (~200 LOC)

Mounted at App root (next to `SaveSnippetDialog`, `ConfirmDialog`, etc.).

Props: none. Reads `importCsvDialogOpen` and `importCsvContext` from the store.

Local state:

```js
const [parseResult, setParseResult] = useState(null)
// { headers, rows, errors, mapping }
//   mapping: [{ csvHeader, tableColumn: string|null, dropped: boolean }, ...]
const [tableColumns, setTableColumns] = useState([])
// from listColumns: [{ name, type, nullable, ... }]
const [importing, setImporting] = useState(false)
```

On dialog open (effect on `[open, ctx]`):

1. Fetch `tableColumns` via `window.gamalab.db.listColumns(connId, ctx.schema, ctx.table)`
2. Parse CSV with papaparse: `Papa.parse(ctx.content, { header: true, skipEmptyLines: true, transform: (v) => v === '' ? null : v })`
3. Build `mapping`: for each CSV header, case-insensitive match against `tableColumns`. If match → `{ csvHeader, tableColumn: matchedName, dropped: false }`. Else → `{ csvHeader, tableColumn: null, dropped: true }`.
4. Set `parseResult`

On close: reset `parseResult`, `tableColumns`, `importing`.

`handleImport`:

```js
const handleImport = async () => {
  if (!parseResult || !ctx || !activeConnection) return
  setImporting(true)
  const validMapping = parseResult.mapping.filter((m) => !m.dropped)
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
      showToast(`Imported ${result.inserted} row${result.inserted === 1 ? '' : 's'}`, 'success')
      bumpTablesRefresh()
      setImportCsvDialogOpen(false)
      setImportCsvContext(null)
    } else {
      showToast(`Import failed: ${result.error}`, 'error')
    }
  } finally {
    setImporting(false)
  }
}
```

Dialog open guard: `onOpenChange={(o) => !importing && setImportCsvDialogOpen(o)}` — block close while inserting.

JSX layout (sections, top to bottom):

1. **DialogHeader** — `Import CSV into "<schema>.<table>"`
2. **File summary** — filename, formatted row count, formatted file size (e.g. `124 KB`)
3. **Auto-mapping list** — one row per CSV header:
   - ✅ green icon + `csvHeader → tableColumn (type)` if mapped
   - ⊘ muted icon + `csvHeader → (not in table — will be dropped)` if dropped
   - Summary line: `Auto-mapped (X / Y columns)`
4. **Parse warnings** (if `parseResult.errors.length > 0`) — `<div class="border border-yellow ...">⚠ N rows had parse errors and will be skipped`
5. **Preview** — `<table>` with first 10 mapped rows, scroll horizontal if needed
6. **Transaction warning** — `⚠ All rows imported in a single transaction. Any error rolls back the whole import.`
7. **DialogFooter** — `[Cancel] [Import N rows]` (Import button shows spinner + "Importing…" while `importing`; disabled if no valid mapped columns OR `parseResult.rows.length === 0`)

`Import` button disabled conditions:
- `importing === true`
- `parseResult === null` (still loading)
- `parseResult.rows.length === 0` (empty CSV)
- `parseResult.mapping.every((m) => m.dropped)` (no column matched the table)

### App.jsx wiring

```jsx
import { ImportCsvDialog } from '@/components/ImportCsvDialog'
// ...
<ImportCsvDialog />
```

Mount alongside `SaveSnippetDialog` / `ConfirmDialog` / `SnippetPalette`.

## Dependency

Add `papaparse` to `dependencies` in `package.json`:

```json
"papaparse": "^5.4.1"
```

(Major version 5, latest stable as of 2025; ~13 KB gzipped.)

## Edge cases

- **CSV vide** — `parseResult.rows.length === 0` → "Import 0 rows" disabled, banner explains "no rows in this CSV"
- **CSV with only header, no data rows** — same as above
- **No column matches** — banner explains "No CSV columns match this table — review the file or rename headers"; Import disabled
- **Papaparse errors** (malformed CSV) — `parsed.errors` non-empty → warning banner shows count; rows-with-errors are excluded from `parsed.data` already by papaparse (skip mode)
- **Empty cell** → `null` (via `transform`); falls to PG default if column has one, or NULL if nullable, or rollback if NOT NULL with no default
- **Type mismatch** (e.g. `"abc"` in an `integer` column) → SQL error → ROLLBACK → friendly toast
- **PK/UNIQUE conflict** → SQL error → ROLLBACK → friendly toast
- **Very large CSV (> 100 MB)** — `fs.readFile` loads everything; acceptable for v1, future iteration could stream
- **Non-UTF8 file** (e.g. Excel Windows-1252) — bytes get mojibake-decoded as UTF-8 → cells contain replacement chars or wrong text → likely a constraint violation or visible weirdness in preview. Document as known limitation.
- **BOM** (`﻿`) — papaparse strips automatically
- **Multi-line cells** (quoted with `\n` inside) — papaparse handles correctly
- **Backdrop click / Esc during import** — blocked via `!importing` guard on `onOpenChange`
- **Connection switch during import** — handler captured `activeConnection.id` at click; insert continues against original connection; if pool was disconnected meanwhile, `pool.connect()` throws → ROLLBACK → friendly error toast
- **Active table change during dialog open** — context (`schema`, `table`) was captured at the file-pick moment in `handleImportCsv`; the dialog imports into the original table even if the user navigates elsewhere
- **CSV column name with special chars** — papaparse passes the header through; `_validateIdent` on the mapped table column (which we control via `listColumns`) is what matters for SQL safety

## Testing

No test framework — manual verification (will be replicated in the implementation plan):

- [ ] Import button visible in `TableBrowser` toolbar next to Export menu
- [ ] Import button disabled when no connection or no active table
- [ ] Click → native file picker opens with `.csv` filter
- [ ] Cancel file picker → no dialog opens, no error
- [ ] Pick a valid CSV → `ImportCsvDialog` opens with header / mapping / preview
- [ ] Auto-mapping shows ✅ for matched columns and ⊘ for dropped CSV columns
- [ ] Preview displays first 10 rows in a scrollable table
- [ ] Click Cancel → dialog closes, no DB mutation
- [ ] Click "Import N rows" with valid CSV → spinner, then toast `Imported N rows`, dialog closes, table refreshes with new rows
- [ ] Round-trip: Export the table as CSV → wipe rows → Import the CSV back → row count and contents match
- [ ] CSV with one header in DIFFERENT case (e.g. `Email` for column `email`) → matched (case-insensitive)
- [ ] CSV with extra column not in table → `⊘` icon, still importable, that column ignored
- [ ] CSV with type mismatch (e.g. text in integer column) → toast friendly error, table unchanged
- [ ] CSV with PK conflict (e.g. id 1 already exists) → toast friendly error, table unchanged
- [ ] Empty cells in CSV → NULLs in DB (verifiable via SELECT)
- [ ] CSV with BOM (Excel-saved CSV) → imports correctly
- [ ] CSV with multi-line quoted cells (description with `\n`) → imports correctly
- [ ] Esc / backdrop click during import → blocked
- [ ] No connection or pool drop during import → friendly toast, no partial insert
- [ ] CSV with no rows → Import button disabled, banner explains
- [ ] CSV where no column matches the table → Import button disabled, banner explains

## Files touched (summary)

**Created:**
- `src/components/ImportCsvDialog.jsx` — preview + auto-mapping + Import button (~200 LOC)

**Modified:**
- `package.json` — add `"papaparse": "^5.4.1"` to `dependencies`
- `electron/services/db.service.js` — add `importRows(id, schema, table, columns, rows)` method (~35 LOC)
- `electron/main.js` — add `ipcMain.handle('dialog:open-csv', ...)` and `ipcMain.handle('db:import-rows', ...)` (~25 LOC)
- `electron/preload.js` — add `openCsv` to `dialog:` namespace and `importRows` to `db:` namespace (2 lines)
- `src/store/appStore.js` — add `importCsvDialogOpen`, `importCsvContext`, `setImportCsvDialogOpen`, `setImportCsvContext` (~5 LOC)
- `src/components/TableBrowser.jsx` — add `Upload` icon import, `handleImportCsv` callback, Import button in toolbar (~25 LOC)
- `src/App.jsx` — import + mount `<ImportCsvDialog />` (2 lines)

## Out of scope / future work

- Manual column mapping UI (override auto-map per CSV column with a dropdown of table columns)
- ON CONFLICT options (DO NOTHING / DO UPDATE) — upsert mode
- Skip-on-error mode (per-row commit, partial-success summary)
- Drag-and-drop a CSV file onto the table
- CSV without header row
- Auto-detect delimiter (`;`, `\t`, etc.)
- Auto-detect / select encoding (Windows-1252, etc.)
- Type coercion preview (warn before commit if "abc" is in an integer column)
- Streaming progress bar for very large files
- Importing into a NEW table (combine with create-table)
- Saving import config (mapping presets, last-used directory)
- Right-click on a sidebar table to import
