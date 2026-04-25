# Saved Queries / Snippets — Design

**Status:** Design approved, pending implementation
**Date:** 2026-04-25
**Author:** Matheo (via brainstorming session)

## Summary

Add a snippets system to GamaLab so users can name, save, and re-insert frequently used SQL queries (e.g. "Top users last 7d", "Cleanup soft-deleted"). Snippets live in a JSON file on disk under `userData/snippets.json` (same pattern as `connections`), are listed in a new sidebar tab, are saved from the editor toolbar, and can be inserted via the sidebar list or via a `Ctrl+Shift+P` command palette. Insertion is "smart": if the active tab is empty, the snippet replaces its content; otherwise, a new tab is created. The active tab is auto-renamed to the snippet name with `titleManual: true` so the SQL identity sticks.

## Goals

- Let users curate a personal library of recurring SQL queries with names and optional descriptions
- Surface that library in two complementary UIs: a sidebar tab (for browsing/management) and a `Ctrl+Shift+P` palette (for fast insertion)
- Persist snippets on disk so they survive Electron version upgrades, localStorage clears, and are easy to back up / sync manually
- Smart-route insertions to avoid clobbering work-in-progress SQL
- Match existing GamaLab patterns: same hook + store + IPC + Electron-store-style JSON file as `connections`

## Non-goals (v1)

- Per-connection scoping (snippets are global; tags can be added later if needed)
- Variables / placeholder substitution (e.g. `{{user_id}}` prompts) — explicit YAGNI for v1, future work
- Folders or hierarchical organization (flat list with search)
- Import/export of snippet bundles (manual file copy is acceptable for v1)
- Sharing snippets across machines via cloud sync
- Editing the SQL inside the save/edit dialog — edit happens in Monaco, then re-save
- Right-click "Save as snippet" on a History item (separate effort: needs a generic context-menu pattern first)
- Color coding, pinning, last-used tracking, use-count
- Realtime sync between two app windows editing the same `snippets.json` (last write wins; documented limitation)

## Architecture

### Data model

A snippet:

```js
{
  id: string,         // crypto.randomUUID().slice(0, 8)
  name: string,       // required, trimmed, 1..80 chars
  sql: string,        // required, raw SQL text (multi-statement OK)
  description: string,// optional, 0..500 chars (default "")
  createdAt: number,  // Date.now() at first save (preserved across edits)
  updatedAt: number,  // Date.now() at every save
}
```

No uniqueness constraint on `name` — duplicates are allowed (cohérent with History, which routinely has the same SQL).

### Storage

JSON file at `app.getPath('userData') + '/snippets.json'`, atomic writes (write to `.tmp` then rename). The same persistence model used by `connections`.

```json
[
  {
    "id": "a1b2c3d4",
    "name": "Top users last 7d",
    "sql": "SELECT user_id, COUNT(*) FROM events ...",
    "description": "Daily active users summary",
    "createdAt": 1745596800000,
    "updatedAt": 1745596800000
  }
]
```

If the file is missing → return `[]`. If it's corrupt JSON → `load()` re-throws; the renderer catches via `useSnippets.refresh` and toasts the error. Not auto-recoverable in v1; user must repair the file (or delete it).

### IPC layer

Three new handlers in `electron/main.js`:

```js
ipcMain.handle('snippets:list',   async ()         => snippetsService.list())
ipcMain.handle('snippets:save',   async (_e, snip) => snippetsService.save(snip))
ipcMain.handle('snippets:delete', async (_e, id)   => snippetsService.remove(id))
```

`snippets:save` performs an upsert by id. The service preserves `createdAt` from the existing record on update so the renderer doesn't have to re-fetch it.

### Preload exposure

```js
// electron/preload.js — added under window.gamalab
snippets: {
  list:   ()        => ipcRenderer.invoke('snippets:list'),
  save:   (snippet) => ipcRenderer.invoke('snippets:save', snippet),
  delete: (id)      => ipcRenderer.invoke('snippets:delete', id),
}
```

### Service module

`electron/services/snippets.service.js` (~70 LOC) — pure Node, no Electron besides `app.getPath('userData')`. Handles atomic read/write of the JSON file. Uses `fs.promises` and a `tmp + rename` write pattern.

```js
// Skeleton (full code in implementation plan)
async function list()        { /* read JSON or [] on ENOENT */ }
async function save(snippet) { /* upsert by id, preserve createdAt, atomic write */ }
async function remove(id)    { /* filter out, atomic write */ }
```

### Renderer-side state

The list of snippets is mirrored in Zustand (`appStore.js`) for read-side sharing between the sidebar tab and the palette. The hook `useSnippets()` is the writer that synchronizes the store with the disk.

```js
// New appStore fields
snippets: [],
saveSnippetDialogOpen: false,
saveSnippetDialogPrefilledSql: '',
editingSnippet: null,    // null = create mode; Snippet object = edit mode
snippetPaletteOpen: false,

// New actions
setSnippets(list),
addSnippet(snippet),
updateSnippet(id, patch),
removeSnippet(id),
openSaveSnippetDialog({ sql, editing }),
closeSaveSnippetDialog(),
setSnippetPaletteOpen(open),
```

`snippets` is **NOT** persisted via the `persist` middleware — the JSON file on disk is the source of truth. The hook hydrates the array on mount.

### Hook `useSnippets()`

`src/hooks/useSnippets.js`:

```js
export function useSnippets() {
  // Reads from store, writes to store + disk via window.gamalab.snippets.*
  return {
    snippets,       // Snippet[]
    loading,        // boolean
    refresh,        // () => Promise<void>     — re-load from disk
    saveSnippet,    // (partial) => Promise<Snippet>  — upsert (id optional)
    deleteSnippet,  // (id) => Promise<void>          — with confirm dialog
  }
}
```

`saveSnippet` generates an id if none provided, sets `updatedAt` to now, and lets the service preserve `createdAt`. Toasts on success/failure.

`deleteSnippet` shows `window.gamalab.dialog.confirm` ("Delete 'name'?", "This snippet will be permanently removed."). Toasts on success.

### Insertion helper

A pure function (or small store action) used by both `SnippetsList` and `SnippetPalette`:

```js
function insertSnippet(snippet) {
  const state = useAppStore.getState()
  const activeTab = state.queryTabs.find(t => t.id === state.activeTabId)
  const tabIsAvailable = activeTab && !activeTab.running && (activeTab.content || '').trim().length === 0

  if (tabIsAvailable) {
    state.updateTabContent(activeTab.id, snippet.sql)
    state.renameTab(activeTab.id, snippet.name)
  } else {
    const newId = state.createTab({ content: snippet.sql })
    state.renameTab(newId, snippet.name)
  }

  // If invoked from non-SQL viewMode, switch back to SQL so the result is visible
  if (state.viewMode !== 'sql') state.setViewMode('sql')

  // Auto-close the palette if open
  if (state.snippetPaletteOpen) state.setSnippetPaletteOpen(false)
}
```

`renameTab` sets `titleManual: true` (existing behavior), so the tab keeps the snippet name even if the user edits the SQL after insertion.

## UI components

### `SnippetsList.jsx` — sidebar tab (~150 LOC)

Layout (mirrors `HistoryList.jsx`):

```
┌──────────────────────────────────┐
│ [+] New snippet     12 entries   │  ← toolbar
├──────────────────────────────────┤
│ 🔍 Search snippets...            │  ← live filter input
├──────────────────────────────────┤
│ ┌────────────────────────────┐   │
│ │ Top users last 7d   ✏️ 🗑️ │   │  ← icons appear on hover
│ │ Daily active users summary │   │  ← description (truncated)
│ │ SELECT user_id, COUNT(*) … │   │  ← SQL preview (1 line, monospace)
│ └────────────────────────────┘   │
│ ┌────────────────────────────┐   │
│ │ Cleanup soft deleted       │   │
│ │ DELETE FROM users WHERE …  │   │
│ └────────────────────────────┘   │
└──────────────────────────────────┘
```

Behaviors:

- Click the item body → calls `insertSnippet(snippet)`
- Hover → reveals `✏️` (edit) and `🗑️` (delete) icons (same `opacity-0 group-hover:opacity-100` pattern as `HistoryList`)
- `+` toolbar button → opens `SaveSnippetDialog` in create mode, prefilled with the active tab's SQL. If the active tab content is empty/whitespace → toast `"Write some SQL first, then save as snippet"` and don't open.
- Search input → live filter on `name + description + sql.slice(0, 100)` (case-insensitive substring)
- Empty state when 0 snippets → centered icon + "No snippets yet" + "Save SQL queries you reuse often" + CTA `+ New snippet` button (same behavior as toolbar `+`)
- Empty state when search returns nothing → "No snippets match \"<query>\""
- Sort order: `updatedAt DESC` (most recently edited first)

### `SaveSnippetDialog.jsx` — modal (~120 LOC)

Used for both CREATE and EDIT, with the mode derived from `editingSnippet` in the store (`null` = create, `Snippet` = edit).

```
┌── Save snippet ──────────────────────┐
│                                      │
│ Name *                               │
│ [_______________________] (1..80)    │
│                                      │
│ Description                          │
│ [                                  ] │
│ [                                  ] │
│ (0..500 chars, optional)             │
│                                      │
│ SQL (read-only)                      │
│ ┌──────────────────────────────┐    │
│ │ SELECT user_id, COUNT(*)     │    │  ← <pre> styled, no syntax
│ │ FROM events                  │    │     highlighting in v1
│ │ WHERE created_at > ...       │    │
│ └──────────────────────────────┘    │
│                                      │
│           [Cancel]  [Save]           │
└──────────────────────────────────────┘
```

- The SQL is displayed read-only via `<pre>` with `whitespace-pre-wrap`, `max-h-64 overflow-auto`, monospace font. No Monaco embed in v1.
- The displayed SQL comes from `editingSnippet?.sql ?? saveSnippetDialogPrefilledSql` — edit mode shows the existing SQL, create mode shows the active tab's content captured at open time.
- In **edit mode**: pre-filled `name`, `description` from `editingSnippet`. `Save` calls `saveSnippet({ id: editing.id, name, sql: editing.sql, description })` — note SQL stays unchanged; only metadata updates.
- In **create mode**: empty `name` and `description`, SQL = `saveSnippetDialogPrefilledSql`. `Save` calls `saveSnippet({ name, sql: saveSnippetDialogPrefilledSql, description })`.
- Validation: `Save` button disabled while `name.trim() === ''`. `name` `maxLength={80}`, `description` `maxLength={500}`.
- Enter in the name input → submit. Escape → cancel. Backdrop click → cancel.
- Pattern follows existing `CreateTableDialog`, `NewLogicalDbDialog`, etc. — uses `useAppStore` for the open/close state and the `editingSnippet` selector.

### `SnippetPalette.jsx` — floating modal (~140 LOC)

Invoked by `Ctrl+Shift+P`. Centered-top, fuzzy-search style.

```
┌── Insert snippet ─────────────────────────────┐
│ 🔍 [____________________________________]      │  ← input, autofocus
├───────────────────────────────────────────────┤
│ → Top users last 7d                           │  ← highlighted (current)
│   Daily active users summary                  │
├───────────────────────────────────────────────┤
│   Cleanup soft deleted                        │
│   DELETE FROM users WHERE deleted_at < ...    │
├───────────────────────────────────────────────┤
│   DB health check                             │
│   SELECT pg_size_pretty(...)                  │
└───────────────────────────────────────────────┘
   ↑↓ navigate · Enter insert · Esc close
```

- Search input with autofocus on open. Live filter on `name + description + sql.slice(0, 100)` (substring, case-insensitive).
- Items navigable via `↑` `↓`. Selected item is highlighted; `Enter` calls `insertSnippet(item)`. `Escape` closes.
- Click on an item = same as Enter.
- Backdrop click → close (no state mutation).
- If `snippets.length === 0` → "No snippets yet. Save your first one from the editor toolbar."
- If search returns 0 → "No snippets match \"<query>\""
- After insertion: palette closes; if `viewMode !== 'sql'` it switches to `'sql'` so the user sees the inserted SQL.

### `Sidebar.jsx` — add the new tab

Append to `ALL_TABS`:

```js
{ id: 'snippets', label: 'Snippets', icon: Bookmark }, // Bookmark or FileCode2 or Sparkles
```

Position: between `tables` and `schema` (group SQL utilities together). Add the matching `{sidebarTab === 'snippets' && <SnippetsList />}` in the render switch.

### `QueryEditor.jsx` — add toolbar button

A new icon in the QueryEditor toolbar (alongside Format/Copy/Clear):

- Icon: `Bookmark` from `lucide-react`
- Title: `"Save as snippet"`
- Click: if `activeTab.content.trim() === ''` → toast `"Write some SQL first, then save as snippet"`. Otherwise → `openSaveSnippetDialog({ sql: activeTab.content })`.
- No keyboard shortcut in v1 (Ctrl+S deferred — risky given universal "save document" convention).

### `App.jsx` — mount modals + keybindings

Near the existing dialogs:

```jsx
<SaveSnippetDialog />
<SnippetPalette />
```

Add `useSnippetKeybindings()` next to `useTabKeybindings()` in the App body.

## Keyboard shortcuts

`Ctrl/Cmd + Shift + P` — open the snippet palette. Active in any `viewMode`. Detected via `e.code === 'KeyP'` (layout-independent, AZERTY-safe) plus `e.shiftKey` plus `e.ctrlKey || e.metaKey`.

Implemented in `src/hooks/useSnippetKeybindings.js` — same pattern as `useTabKeybindings.js` (window-level keydown with `{ capture: true }`, fresh state via `getState()`).

When the palette is open, tab keybindings (`Ctrl+T/W/Tab/1..9`) become no-ops to avoid surprising background mutations. Implementation: add a guard at the top of `useTabKeybindings`'s handler: `if (useAppStore.getState().snippetPaletteOpen) return`.

## Edge cases

- **Empty SQL on save** — toolbar `+` button check, sidebar `+` check; both early-return with toast `"Write some SQL first, then save as snippet"`.
- **Active tab is running** — the smart-route forces the "new tab" path (no replace) so we don't fight Monaco's `readOnly` state.
- **Active tab is non-empty AND running** — same: new tab.
- **Palette open while user presses Ctrl+T/W** — handled via the `snippetPaletteOpen` guard in `useTabKeybindings`.
- **`snippets.json` missing** — service returns `[]`. UI shows empty state. No error.
- **`snippets.json` corrupt** — `load()` throws; `useSnippets.refresh` catches and toasts the error message. The user can manually repair or delete the file.
- **Two windows editing simultaneously** — last write wins (no file locking). Documented limitation; acceptable since this is single-user desktop tooling.
- **Duplicate names** — allowed; the user sees both in the list.
- **Very long name** — input `maxLength={80}`. Display in list uses `truncate` + native `title` tooltip.
- **Very long description** — textarea `maxLength={500}`. Display in list = 2 lines max + ellipsis.
- **Very long SQL preview** — `<pre>` in dialog uses `max-h-64 overflow-auto whitespace-pre-wrap`. List preview is one line: first non-blank line, collapsed via `replace(/\s+/g, ' ')`, truncated to ~140 chars (same pattern as `HistoryList.jsx`).
- **Snippet inserted from non-SQL viewMode** — `insertSnippet` switches `viewMode` back to `'sql'` after insertion so the result is visible.
- **Edit mode preserves `createdAt`** — guaranteed by the service (`existing.createdAt ?? snippet.createdAt`).

## Testing

No test framework in this project (consistent with prior features). Verification is manual; the checklist below is captured here and will be replicated in the implementation plan:

- [ ] Save a snippet from the QueryEditor toolbar → appears in sidebar Snippets tab, persists after app restart
- [ ] Save a snippet from the sidebar `+` button (with non-empty SQL in active tab) → identical
- [ ] Attempt to save with empty SQL → toast `"Write some SQL first, then save as snippet"`
- [ ] Attempt to save with empty/whitespace name → Save button disabled
- [ ] Click a snippet in the sidebar (active tab empty) → SQL inserted into active tab; tab title = snippet name; `titleManual` true
- [ ] Click a snippet in the sidebar (active tab non-empty) → new tab created with SQL + title
- [ ] Click a snippet in the sidebar (active tab running) → forced new tab
- [ ] Edit via ✏️ icon → dialog pre-filled with name + description (SQL read-only); save → `updatedAt` advances; name change reflected in list
- [ ] Delete via 🗑️ icon → confirm dialog; OK → snippet gone from list and from `snippets.json`; Cancel → no change
- [ ] Search input filters live on name + description + first 100 chars of SQL (case-insensitive)
- [ ] List sorted by `updatedAt DESC` (most recently edited first)
- [ ] Empty state when 0 snippets → CTA `+ New snippet` button works
- [ ] Empty state when search returns 0 → "No snippets match \"<query>\""
- [ ] `Ctrl+Shift+P` from SQL mode → palette opens, focus in search input
- [ ] `Ctrl+Shift+P` from browse/schema mode → palette opens; after insertion, `viewMode` switches to `'sql'`
- [ ] `↑` `↓` in palette → navigation; selected item highlighted; auto-scroll if needed
- [ ] `Enter` in palette → insert + close
- [ ] `Esc` in palette → close, focus returns to wherever it was
- [ ] Click on a palette item = `Enter` behavior
- [ ] Backdrop click on palette → close (no insertion)
- [ ] Palette open + `Ctrl+T` → ignored (no new tab created)
- [ ] Palette open + `Ctrl+W` → ignored
- [ ] Palette open + `Ctrl+1..9` → ignored
- [ ] Restart app after save → snippets re-loaded from `snippets.json`
- [ ] Manually delete `snippets.json` → app restarts cleanly with empty list
- [ ] Verify `snippets.json` location: `%APPDATA%/gamalab/snippets.json` on Windows
- [ ] Test on AZERTY: `Ctrl+Shift+P` works (uses `e.code`)

## Files touched (summary)

**Created:**
- `electron/services/snippets.service.js` — JSON file CRUD with atomic writes
- `src/hooks/useSnippets.js` — list/save/delete via store + IPC
- `src/hooks/useSnippetKeybindings.js` — `Ctrl+Shift+P` global listener
- `src/components/SnippetsList.jsx` — sidebar tab UI
- `src/components/SaveSnippetDialog.jsx` — modal for create/edit
- `src/components/SnippetPalette.jsx` — `Ctrl+Shift+P` floating modal

**Modified:**
- `electron/main.js` — three new `ipcMain.handle` registrations, plus `snippetsService` require
- `electron/preload.js` — new `snippets` namespace under `window.gamalab`
- `src/store/appStore.js` — new state fields and actions for snippets and dialogs
- `src/components/Sidebar.jsx` — new `snippets` entry in `ALL_TABS` + render switch
- `src/components/QueryEditor.jsx` — new "Save as snippet" toolbar button
- `src/App.jsx` — mount `<SaveSnippetDialog />`, `<SnippetPalette />`, call `useSnippetKeybindings()`
- `src/hooks/useTabKeybindings.js` — guard against firing while palette is open

## Out of scope / future work

- Right-click "Save as snippet" on a History item — needs a generic context-menu pattern first
- Variable substitution (`{{user_id}}`) — requires a placeholder scan + dynamic form
- Per-connection scoping or tagging — flat global list is sufficient for MVP
- Folder hierarchy
- Color coding, pinning, last-used tracking, use-count
- Auto-recovery from a corrupt `snippets.json` (backup-rename + reset)
- Import/export bundle (.zip of snippets)
- Sharing via cloud sync
- Keyboard shortcut `Ctrl+S` for "Save as snippet" (deferred; convention conflict)
- Aligning History tab insertion behavior with the new smart-route — currently History always replaces active tab
