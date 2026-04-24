# Query Tabs — Design

**Status:** Design approved, pending implementation
**Date:** 2026-04-24
**Author:** Matheo (via brainstorming session)

## Summary

Replace GamaLab's single-query SQL editor with a VS Code-style multi-tab model. Each tab owns its own SQL content, result, error, running state, and duration, and persists across app restarts via `localStorage`. Tabs are visible only when `viewMode === 'sql'`; browse and schema modes remain unchanged. Scope is intentionally limited to SQL tabs — a future iteration may unify browse/schema into the same tab bar (tracked as a separate effort).

## Goals

- Let the user keep multiple query drafts open simultaneously ("top users last 7d", "cleanup soft-deleted", an ad-hoc exploration) without copy/paste juggling
- Preserve each tab's undo/redo history, cursor and scroll position when switching tabs
- Survive app restarts — tabs and active tab are restored exactly as the user left them
- Allow a query to keep executing on one tab while the user edits another
- Auto-name tabs from their content (first comment or SQL verb+table) so the tab bar stays self-documenting

## Non-goals (v1)

- Drag-and-drop reordering of tabs
- Mixing browse/schema views into the tab bar (explicit future phase)
- Per-tab run history (the global `queryHistory` stays shared)
- Saving tabs as named snippets / bookmarks (separate feature on the roadmap)
- Result snapshot persistence (results are re-fetched on demand; only SQL content survives restarts)
- Split-pane / side-by-side tab viewing
- Limits on the number of open tabs

## Architecture

### Data model — new shape in `appStore.js`

A single tab is:

```js
{
  id: string,          // crypto.randomUUID().slice(0, 8), stable across restarts
  title: string,       // auto-derived from content OR set manually
  titleManual: boolean,// if true, title is never auto-recomputed
  content: string,     // the SQL text
  result: object|null, // { rows, fields, rowCount } as today's queryResult
  error: string|null,
  running: boolean,
  duration: number|null, // ms, populated after each run
}
```

New store fields:

```js
queryTabs: Tab[],
activeTabId: string | null,
nextTabNumber: number, // monotonic counter for the "Query N" fallback; never decremented
```

**Removed** (replaced by per-tab equivalents):

- `currentQuery`
- `queryResult`
- `queryError`
- `queryRunning`

**Conserved as-is**: `queryHistory` (shared across tabs), `viewMode`, `activeTable`, `pendingTableFilters`, and everything else.

### New store actions

```js
createTab({ content = '' } = {})   // append + activate; returns new id
closeTab(id)                        // no-op if last tab OR tab is running
setActiveTabId(id)
updateTabContent(id, content)       // writes content; if !titleManual, recomputes title
renameTab(id, title)                // title = trimmed, titleManual = true
setTabResult(id, { result, error, duration })
setTabRunning(id, running)
clearAllTabResults()                // used on activeConnection switch
```

### Refactor of `useDatabase.runQuery`

Today, `runQuery(sql)` reads/writes the global `queryRunning / queryResult / queryError`. It becomes:

```js
runQuery(sql, { tabId = get().activeTabId } = {})
```

The `tabId` is captured at call time and used for all state writes (including the final `setTabResult` when the promise resolves). This ensures that if the user switches tabs mid-query, the result lands on the originating tab, not on whatever is active at resolution time. `queryHistory.push(...)` continues to append globally.

### Single-store choice

The tabs live inside `appStore.js`, not a new store file. Rationale: tab actions need `activeConnection`, `showToast`, and `queryHistory`, all of which are already in `appStore`. A second store would either duplicate those or force cross-store reads, both worse than 50 extra lines in one file.

## Persistence & migration

Wrap `useAppStore` with `zustand/middleware/persist`:

```js
persist(
  (set, get) => ({ /* existing store */ }),
  {
    name: 'gamalab-app',
    version: 1,
    partialize: (state) => ({
      queryTabs: state.queryTabs.map(t => ({
        id: t.id,
        title: t.title,
        titleManual: t.titleManual,
        content: t.content,
      })),
      activeTabId: state.activeTabId,
    }),
    migrate: (persisted, version) => {
      if (!persisted) return persisted
      // v0 → v1: promote legacy currentQuery into a single Tab
      if (version < 1 && typeof persisted.currentQuery === 'string') {
        const id = crypto.randomUUID().slice(0, 8)
        return {
          ...persisted,
          queryTabs: [{
            id,
            title: deriveTitle(persisted.currentQuery) || 'Query 1',
            titleManual: false,
            content: persisted.currentQuery,
          }],
          activeTabId: id,
        }
      }
      return persisted
    },
  }
)
```

**Volatile fields rehydration** — via `onRehydrateStorage`, after persist restores `queryTabs`, the callback maps every restored tab to include `result: null, error: null, running: false, duration: null`. The partialized shape doesn't carry these fields, so every launch starts with a clean runtime state per tab.

**First-ever launch** (no persisted state): the store's default initial state contains one tab with the current welcome query (`'-- Welcome to GamaLab 🧪\n-- Your Database Laboratory\n\nSELECT version();'`), auto-titled "Welcome to GamaLab", `nextTabNumber: 2`.

**Rollout note** — today's `appStore` has no `persist` middleware, so no v0 persisted state exists in users' `localStorage`. On first launch after this feature ships, every user hits the "first-ever launch" path and gets the welcome tab. The `migrate` function is kept as defensive boilerplate for future schema changes (v1 → v2 etc.).

**`activeConnection` switch** — today the store clears `queryResult/queryError` on connection change. Tomorrow it calls `clearAllTabResults()` (which wipes `result/error/running/duration` across all tabs) and keeps `content` untouched. `activeTabId` also stays the same.

### Auto-derived title logic

Pure helper `deriveTitle(content): string | null`, invoked from `updateTabContent` when `titleManual === false`:

```js
function deriveTitle(content) {
  if (!content || !content.trim()) return null

  // 1. First non-empty line comment wins
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*--\s*(.+?)\s*$/)
    if (m && m[1].length > 0) return truncate(m[1], 32)
  }

  // 2. Verb + table from first recognizable statement
  const flat = content.replace(/\s+/g, ' ')
  const m = flat.match(
    /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE)\b[^;]*?\b(?:FROM|INTO|TABLE|UPDATE)\s+["']?([a-zA-Z_][\w.]*)/i
  )
  if (m) return `${m[1].toUpperCase()} ${m[2]}`

  // 3. Lone verb
  const verb = flat.match(/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|EXPLAIN|SHOW|WITH)\b/i)
  if (verb) return verb[1].toUpperCase()

  return null
}
```

Caller substitutes `"Query N"` (numeric index, never recycled) when `deriveTitle` returns `null`. The numeric counter is tracked in the store (`nextTabNumber: number`, incremented on every `createTab`).

## UI components

### New `QueryTabBar.jsx` (~120–150 LOC)

Placed between `Toolbar` and `QueryEditor` in `App.jsx`, rendered only when `viewMode === 'sql'`.

Layout:

```
┌─────────────────────────────────────────────────────────────┐
│ Query 1 × │ cleanup soft del… × │ Query 3 ⚙ × │ + ← fixed    │
└─────────────────────────────────────────────────────────────┘
```

Behaviours:

- Click on tab → `setActiveTabId(tab.id)`
- Active tab: background `bg-background`, top border `border-t border-lab-blue`, bold title
- Inactive tab: `bg-card`, muted text, `×` hidden until hover
- Middle-click (mousedown `button === 1`) → `closeTab(tab.id)` with guards
- Double-click on title → swap to inline `<input>` (focus + select); Enter or blur commits via `renameTab`, Escape cancels
- Running tab: `<Loader2 className="animate-spin">` to the left of the title; `×` disabled with tooltip "Running…"
- Non-empty tab on close → `window.gamalab.dialog.confirm({ title: 'Close tab?', message: ..., detail: ... })`; empty content skips the confirm
- Overflow: `overflow-x-auto` on the tab list container; `+` button is outside the scrollable area, pinned flush right
- `+` button: `<Plus className="h-4 w-4" />` → `createTab()` then focus Monaco via a ref passed down from `App.jsx`

### `QueryEditor.jsx` changes

Replace `currentQuery / setCurrentQuery / queryRunning` reads with:

```js
const activeTab = useAppStore(s => s.queryTabs.find(t => t.id === s.activeTabId))
const updateTabContent = useAppStore(s => s.updateTabContent)
```

Pass `path={activeTab.id}` to `@monaco-editor/react`'s `<Editor>`. This makes Monaco maintain a separate `ITextModel` per tab, preserving undo/redo, cursor, and scroll for free.

```jsx
<Editor
  path={activeTab?.id ?? 'empty'}
  defaultLanguage="sql"
  value={activeTab?.content ?? ''}
  onChange={(v) => activeTab && updateTabContent(activeTab.id, v ?? '')}
  onMount={handleMount}
  options={{ ...MONACO_OPTIONS, readOnly: activeTab?.running ?? false }}
/>
```

Format / Copy / Clear buttons operate on `editorRef.current` — unchanged semantically.

### `ResultsTable.jsx` changes

```js
const activeTab = useAppStore(s => s.queryTabs.find(t => t.id === s.activeTabId))
const { result, error, running, duration } = activeTab ?? {}
```

No visual change — just the source of data.

### `App.jsx` changes

In the SQL-mode branch, wrap `QueryEditor` with `QueryTabBar` above it:

```jsx
<Panel defaultSize={50} minSize={20}>
  <div className="flex h-full flex-col">
    <QueryTabBar />
    <div className="min-h-0 flex-1">
      <QueryEditor onRun={handleRunQuery} />
    </div>
  </div>
</Panel>
```

## Keyboard shortcuts

Registered in a dedicated hook `useTabKeybindings()` called from `App.jsx`. All detect Ctrl-or-Meta via `e.ctrlKey || e.metaKey` and are gated by `viewMode === 'sql'`.

| Shortcut | Action | Guards |
|---|---|---|
| `Ctrl/Cmd + T` | `createTab()`, then focus Monaco | — |
| `Ctrl/Cmd + W` | `closeTab(activeTabId)` | Ignored if last tab or running |
| `Ctrl/Cmd + Tab` | Cycle to next tab | Ignored if only one tab |
| `Ctrl/Cmd + Shift + Tab` | Cycle to previous tab | Idem |
| `Ctrl/Cmd + 1..9` | Jump to tab N (1-indexed) | Ignored if N > `queryTabs.length` |
| `Ctrl/Cmd + Enter` | Run query (existing) | Ignored if active tab is already running (toast "Already running") |

**`Ctrl+W` on Electron** — this may conflict with the default "close window" binding on some platforms. Implementation step: register a `before-input-event` listener on the Electron `BrowserWindow` (in `electron/main.js`) that suppresses the default when the renderer is focused and the tab bar is active. If that proves fragile, fall back to `Ctrl+F4` (standard Windows close-child). Decision deferred to implementation; default plan = Ctrl+W.

**`Ctrl+Tab` inside Monaco** — Monaco binds it to indentation. We override at the `window` level with `preventDefault` before Monaco sees it; plain `Tab` remains unchanged for indentation.

## Edge cases

- **Last tab close attempt** — `closeTab` returns early silently; the `×` button is already visually disabled with a tooltip.
- **Closing the active tab** — activate `queryTabs[index - 1]` if it exists, otherwise `queryTabs[index + 1]` (after the splice).
- **Closing a non-empty tab** — confirm dialog via `window.gamalab.dialog.confirm`. Threshold: `content.trim().length > 0`.
- **Running tab** — `setActiveTabId` never cancels. `runQuery` captures `tabId` at call time; the result lands on the originating tab regardless of which tab is active at resolution. Closing a running tab is blocked (× disabled, Ctrl+W no-op with toast "Query running — can't close yet").
- **`activeConnection` switch** — clears `result/error/running/duration` on all tabs. `content`, `title`, `titleManual`, `activeTabId` preserved.
- **Query run on null connection** — falls through existing `runQuery` error path (toast).
- **Large tab counts** — no hard limit; horizontal scroll handles it.
- **UUID availability** — `crypto.randomUUID` is native in Electron (Chromium ≥ 92). If ever unavailable, fallback `Math.random().toString(36).slice(2, 10)`.

## Testing

Project has no test framework (confirmed against `package.json`). Verification is manual — captured here as a checklist to run before merging:

- [ ] Create 3 tabs, edit different SQL in each, switch between them: content, undo/redo (Ctrl+Z), cursor and scroll all preserved per tab
- [ ] Run query on Tab A, immediately switch to Tab B, edit SQL there. Result arrives in Tab A, Tab B edits uninterrupted
- [ ] `Ctrl/Cmd + T` opens a new empty tab, focus lands in Monaco
- [ ] `Ctrl/Cmd + W` closes active tab, activates neighbour; last-tab close is no-op
- [ ] `Ctrl/Cmd + 1..9` jumps to tab N; `Ctrl/Cmd + Tab` cycles forward; `Ctrl/Cmd + Shift + Tab` cycles backward
- [ ] Close tab with non-empty content → confirm dialog; Cancel keeps tab; Close tab removes it
- [ ] Close tab with empty content → no confirm dialog
- [ ] Double-click on tab title → inline input; Enter commits, Escape cancels, blur commits
- [ ] Manual rename sticks: after renaming, editing the content doesn't overwrite the title
- [ ] Reload Electron (Ctrl+R or close/reopen) → tabs restored, activeTabId restored, `result/error/running` empty
- [ ] First-launch migration (wipe localStorage, relaunch): single tab with welcome SQL, auto-titled "Welcome to GamaLab"
- [ ] Switch `activeConnection` → tabs and content preserved, all `result/error` cleared
- [ ] Middle-click on inactive tab closes it
- [ ] Tab bar hidden when switching to browse/schema view, restored when back to SQL view
- [ ] `Ctrl+W` does not close the Electron window when a tab exists to close

## Out of scope / future work

- Mixed tabs (SQL + table browser + schema in the same tab bar) — planned follow-up once v1 stabilizes
- Drag-to-reorder — low value for now
- Saved queries / snippets — separate feature on the roadmap
- Tab groups / split views — possible v3 if users ask
- Keyboard navigation to tab bar with arrow keys (accessibility) — not blocking launch, easy follow-up

## Files touched (summary)

- `src/store/appStore.js` — tabs state, actions, `persist` middleware, migration
- `src/hooks/useDatabase.js` — `runQuery` takes `{ tabId }`, writes per-tab
- `src/components/QueryTabBar.jsx` — new
- `src/components/QueryEditor.jsx` — reads active tab, uses `path` prop
- `src/components/ResultsTable.jsx` — reads active tab
- `src/App.jsx` — mounts `QueryTabBar`, calls `useTabKeybindings`
- `src/hooks/useTabKeybindings.js` — new
- `src/lib/deriveTitle.js` — new (pure helper)
- `electron/main.js` — Ctrl+W `before-input-event` guard (if needed)
