# Query Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Git convention for this project:** The user handles all `git commit` and `git push` operations manually. Each commit step is a pause point with a suggested message — do NOT run `git commit` yourself. Wait for the user to commit (or explicitly ask them to) before proceeding to the next task.

**Goal:** Replace GamaLab's single-query SQL editor with a VS Code-style multi-tab model where each tab owns its own SQL content, result, error, running state, and duration; tabs persist across app restarts.

**Architecture:** Extend the single Zustand store with a `queryTabs` array and `activeTabId`, refactor `QueryEditor` / `ResultsTable` / `useDatabase` to consume per-tab state, add `persist` middleware with a dedicated partialize step for SQL content + titles only, and introduce a new `QueryTabBar` component plus a `useTabKeybindings` hook for VS Code-style shortcuts.

**Tech Stack:** React 18, Zustand 4.5, `@monaco-editor/react`, `zustand/middleware/persist`, `lucide-react` icons, Tailwind.

**Reference spec:** `docs/superpowers/specs/2026-04-24-query-tabs-design.md`

---

## File Structure

**Created:**
- `src/lib/deriveTitle.js` — pure helper that turns SQL content into a human title
- `src/components/QueryTabBar.jsx` — tab bar UI (list + `+` button + inline rename + close)
- `src/hooks/useTabKeybindings.js` — global Ctrl/Cmd shortcuts for tab navigation and lifecycle

**Modified:**
- `src/store/appStore.js` — add `queryTabs`, `activeTabId`, `nextTabNumber`, all new actions, `persist` middleware with `partialize` + `onRehydrateStorage`, update `setActiveConnectionId`, remove legacy `currentQuery / queryResult / queryError / queryRunning` and their setters
- `src/hooks/useDatabase.js` — refactor `runQuery` to accept `{ tabId }` and write per-tab via `setTabRunning` / `setTabResult`
- `src/components/QueryEditor.jsx` — read `activeTab`, pass `path={activeTab.id}` to Monaco, dispatch `updateTabContent`
- `src/components/ResultsTable.jsx` — read `result / error / running / duration` from active tab
- `src/App.jsx` — mount `<QueryTabBar />` above `QueryEditor` in SQL mode, call `useTabKeybindings()`

**Possibly modified (conditional, Task 11):**
- `electron/main.js` — intercept `Ctrl+W` via `before-input-event` if the default window-close fires on the BrowserWindow during normal use

---

## Task 1: Create `deriveTitle` pure helper

**Files:**
- Create: `src/lib/deriveTitle.js`

- [ ] **Step 1: Write the helper**

```js
// src/lib/deriveTitle.js
// Pure function — turns SQL content into a short human-readable title.
// Returns null when no meaningful title can be derived (caller falls back to "Query N").

const SQL_VERBS =
  /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|EXPLAIN|SHOW|WITH)\b/i

const VERB_WITH_TABLE =
  /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE)\b[^;]*?\b(?:FROM|INTO|TABLE|UPDATE)\s+["']?([a-zA-Z_][\w.]*)/i

function truncate(str, max) {
  if (str.length <= max) return str
  return str.slice(0, max - 1) + '…'
}

export function deriveTitle(content) {
  if (!content || !content.trim()) return null

  // 1. First non-empty -- line comment wins
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*--\s*(.+?)\s*$/)
    if (m && m[1].length > 0) return truncate(m[1], 32)
  }

  // 2. Verb + table from first recognizable statement
  const flat = content.replace(/\s+/g, ' ')
  const m = flat.match(VERB_WITH_TABLE)
  if (m) {
    const verb = m[1].toUpperCase()
    const table = m[2]
    return truncate(`${verb} ${table}`, 32)
  }

  // 3. Lone verb fallback
  const verb = flat.match(SQL_VERBS)
  if (verb) return verb[1].toUpperCase()

  return null
}
```

- [ ] **Step 2: Manual verification in DevTools**

Start the app (`npm run dev`), open DevTools in Electron, and in the console:

```js
const { deriveTitle } = await import('/src/lib/deriveTitle.js')
deriveTitle('-- cleanup soft deleted\nDELETE FROM users')      // → "cleanup soft deleted"
deriveTitle('SELECT id FROM users WHERE deleted_at IS NULL')   // → "SELECT users"
deriveTitle('SELECT now()')                                    // → "SELECT"
deriveTitle('')                                                // → null
deriveTitle('-- \nSELECT 1')                                   // → "SELECT" (empty comment skipped)
deriveTitle('INSERT INTO orders (id) VALUES (1)')              // → "INSERT orders"
```

Expected: each call returns the value noted in the comment. If any differs, fix and re-run.

- [ ] **Step 3: Pause for manual commit**

Suggested message: `feat(tabs): add deriveTitle helper`

---

## Task 2: Extend Zustand store with tabs state and actions

**Files:**
- Modify: `src/store/appStore.js`

- [ ] **Step 1: Add imports and new state fields**

At the top of the file, add the import for the helper:

```js
import { deriveTitle } from '@/lib/deriveTitle'
```

Inside the store factory, locate the "Query state" block (currently `currentQuery`, `queryResult`, `queryError`, `queryRunning`, `queryHistory`). **Leave the legacy fields as-is for now** — they'll be removed in Task 11 once all consumers migrate. Add, right after `queryHistory`:

```js
  // --- Query tabs (new) ---
  queryTabs: [
    {
      id: (globalThis.crypto?.randomUUID?.() || Math.random().toString(36)).slice(0, 8),
      title: 'Welcome to GamaLab',
      titleManual: false,
      content: '-- Welcome to GamaLab 🧪\n-- Your Database Laboratory\n\nSELECT version();',
      result: null,
      error: null,
      running: false,
      duration: null,
    },
  ],
  activeTabId: null, // set lazily in initialize() if unset
  nextTabNumber: 2,  // "Query 1" is implicitly the first tab's fallback; next new tab = "Query 2"
```

- [ ] **Step 2: Add tab actions**

Add these actions alongside the existing setters (anywhere after `setQueryRunning` is fine; group them under a `// --- Tab actions ---` comment):

```js
  // --- Tab actions ---
  createTab: ({ content = '' } = {}) => {
    const id = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36)).slice(0, 8)
    const n = get().nextTabNumber
    const tab = {
      id,
      title: deriveTitle(content) || `Query ${n}`,
      titleManual: false,
      content,
      result: null,
      error: null,
      running: false,
      duration: null,
    }
    set({
      queryTabs: [...get().queryTabs, tab],
      activeTabId: id,
      nextTabNumber: n + 1,
    })
    return id
  },

  closeTab: (id) => {
    const tabs = get().queryTabs
    if (tabs.length <= 1) return                 // guard: last tab can't close
    const target = tabs.find((t) => t.id === id)
    if (!target || target.running) return        // guard: don't close running
    const idx = tabs.indexOf(target)
    const nextTabs = tabs.filter((t) => t.id !== id)
    // pick neighbour: previous if exists, else next
    const neighbour = nextTabs[idx - 1] || nextTabs[idx] || nextTabs[0]
    set({
      queryTabs: nextTabs,
      activeTabId:
        get().activeTabId === id ? neighbour?.id ?? null : get().activeTabId,
    })
  },

  setActiveTabId: (id) => {
    if (get().queryTabs.some((t) => t.id === id)) set({ activeTabId: id })
  },

  updateTabContent: (id, content) => {
    set({
      queryTabs: get().queryTabs.map((t) => {
        if (t.id !== id) return t
        const nextTitle = t.titleManual
          ? t.title
          : (deriveTitle(content) || t.title.match(/^Query \d+$/)
              ? t.title
              : `Query ${get().nextTabNumber - 1}`)
        return { ...t, content, title: nextTitle }
      }),
    })
  },

  renameTab: (id, title) => {
    const trimmed = (title || '').trim()
    if (!trimmed) return
    set({
      queryTabs: get().queryTabs.map((t) =>
        t.id === id ? { ...t, title: trimmed, titleManual: true } : t
      ),
    })
  },

  setTabResult: (id, { result = null, error = null, duration = null } = {}) => {
    set({
      queryTabs: get().queryTabs.map((t) =>
        t.id === id ? { ...t, result, error, duration } : t
      ),
    })
  },

  setTabRunning: (id, running) => {
    set({
      queryTabs: get().queryTabs.map((t) =>
        t.id === id ? { ...t, running } : t
      ),
    })
  },

  clearAllTabResults: () => {
    set({
      queryTabs: get().queryTabs.map((t) => ({
        ...t,
        result: null,
        error: null,
        running: false,
        duration: null,
      })),
    })
  },
```

> **Note on `updateTabContent` title logic:** If the user has manually renamed, we keep the manual title forever. Otherwise, we recompute from content; if derivation returns `null` (e.g. user cleared the content), we fall back to the existing title if it already looks like `Query N`, else regenerate from nextTabNumber - 1 to keep stable "Query N" naming on the first tab. This is intentionally conservative — re-read it once before moving on.

- [ ] **Step 3: Modify `setActiveConnectionId` to clear per-tab results**

Locate `setActiveConnectionId` (currently around line 76). Replace the `queryResult: null, queryError: null,` lines inside the `set({...})` call with a follow-up call to `clearAllTabResults`:

```js
  setActiveConnectionId: (id) => {
    if (id !== get().activeConnectionId) {
      set({
        activeConnectionId: id,
        activeTable: null,
        viewMode: 'sql',
        schemaFilter: 'all',
        selectedEdgeId: null,
      })
      get().clearAllTabResults()
    } else {
      set({ activeConnectionId: id })
    }
  },
```

- [ ] **Step 4: Initialize `activeTabId` on first mount**

Locate the `initialize()` action. At the end of its body, ensure `activeTabId` is set to the first tab's id if it's still `null`:

```js
  initialize: async () => {
    // ... existing initialization logic ...

    // Ensure an active tab is selected
    if (!get().activeTabId && get().queryTabs.length > 0) {
      set({ activeTabId: get().queryTabs[0].id })
    }
  },
```

- [ ] **Step 5: Verify in DevTools**

Start the app (`npm run dev`). Open DevTools console:

```js
const s = window.__ZUSTAND_STORE__?.getState?.() // if devtools exposed; else use a quick store peek
```

If the store isn't exposed, temporarily add `window.__store = useAppStore` inside `appStore.js` and reload, then:

```js
window.__store.getState().queryTabs
// → [{ id: '...', title: 'Welcome to GamaLab', content: '-- Welcome…', running: false, ... }]
window.__store.getState().activeTabId
// → matches queryTabs[0].id
window.__store.getState().createTab({ content: 'SELECT 1' })
// → returns a new id; queryTabs now has 2 entries; activeTabId moved to the new one
window.__store.getState().closeTab(window.__store.getState().activeTabId)
// → queryTabs back to 1; activeTabId back to welcome tab
```

Expected: all calls succeed. The app visually shows the welcome SQL (because `QueryEditor` still reads the legacy `currentQuery` — this is fine, we fix it in Task 4).

Remove the temporary `window.__store = useAppStore` before committing.

- [ ] **Step 6: Pause for manual commit**

Suggested message: `feat(tabs): add queryTabs state and actions to appStore`

---

## Task 3: Refactor `useDatabase.runQuery` to write per-tab

**Files:**
- Modify: `src/hooks/useDatabase.js`

- [ ] **Step 1: Swap legacy setters for tab setters**

Replace the destructure (currently around line 9-17):

```js
  const {
    addConnection,
    removeConnection,
    setActiveConnectionId,
    setQueryResult,
    setQueryError,
    setQueryRunning,
    addHistoryItem,
    showToast,
  } = useAppStore()
```

With:

```js
  const {
    addConnection,
    removeConnection,
    setActiveConnectionId,
    setTabResult,
    setTabRunning,
    activeTabId,
    addHistoryItem,
    showToast,
  } = useAppStore()
```

- [ ] **Step 2: Rewrite `runQuery` to operate per tab**

Replace the entire `runQuery` definition with:

```js
  const runQuery = useCallback(
    async (sql, { tabId: explicitTabId } = {}) => {
      if (!activeConnection) {
        showToast('Connect to a database first', 'warning')
        return null
      }
      const tabId = explicitTabId ?? useAppStore.getState().activeTabId
      if (!tabId) {
        showToast('No active tab', 'error')
        return null
      }
      const trimmed = (sql || '').trim()
      if (!trimmed) {
        showToast('Nothing to run', 'warning')
        return null
      }

      // Guard: don't double-run on the same tab
      const tabNow = useAppStore
        .getState()
        .queryTabs.find((t) => t.id === tabId)
      if (tabNow?.running) {
        showToast('Already running', 'info')
        return null
      }

      const isDestructive = /\b(DROP|TRUNCATE|DELETE|ALTER)\b/i.test(trimmed)
      if (isDestructive) {
        const ok = await window.gamalab.dialog.confirm({
          title: 'Run destructive query?',
          message: 'This statement can modify or delete data. Proceed?',
          detail: trimmed.slice(0, 500),
        })
        if (!ok) return null
      }

      setTabRunning(tabId, true)
      setTabResult(tabId, { result: null, error: null, duration: null })
      const start = Date.now()
      try {
        const result = await window.gamalab.db.query(activeConnection.id, trimmed)
        const duration = result.duration ?? Date.now() - start
        setTabResult(tabId, { result, error: null, duration })
        addHistoryItem({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          sql: trimmed,
          connectionId: activeConnection.id,
          connectionName: activeConnection.name || activeConnection.database,
          duration,
          rowCount: result.rowCount ?? (result.rows?.length || 0),
          timestamp: Date.now(),
          success: true,
        })
        return result
      } catch (err) {
        const duration = Date.now() - start
        setTabResult(tabId, { result: null, error: err.message, duration })
        addHistoryItem({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          sql: trimmed,
          connectionId: activeConnection.id,
          connectionName: activeConnection.name || activeConnection.database,
          duration,
          rowCount: 0,
          timestamp: Date.now(),
          success: false,
          error: err.message,
        })
        return null
      } finally {
        setTabRunning(tabId, false)
      }
    },
    [activeConnection, addHistoryItem, setTabResult, setTabRunning, showToast]
  )
```

> **Key change:** `tabId` is captured at call time (from `explicitTabId` or `activeTabId` at that instant), then used for all subsequent writes. If the user switches tabs mid-query, the result still lands on the originating tab.

- [ ] **Step 3: Confirm the guard on destructive queries still matches current behavior**

The block starting with `const isDestructive = ...` replicates the existing destructive-query confirmation. If your current `useDatabase.js` version uses a different guard (e.g. different regex or wording), preserve its exact behavior — only change the per-tab wiring. Read the original `runQuery` body once and cross-check.

- [ ] **Step 4: Manual verification**

Start the app, connect to a DB. In the DevTools console:

```js
window.__store = (await import('/src/store/appStore.js')).useAppStore
window.__store.getState().queryTabs[0].running
// → false
// Type a query in the editor, press Ctrl+Enter (or click Run in Toolbar).
window.__store.getState().queryTabs[0]
// → { running: false, result: { rows: [...] }, error: null, duration: <ms> }
```

Expected: running a query populates `result` on the active tab (still tab 0, since we have no tab bar yet). No errors in console.

Remove the temporary `window.__store` assignment.

- [ ] **Step 5: Pause for manual commit**

Suggested message: `refactor(tabs): runQuery writes per-tab via setTabResult/setTabRunning`

---

## Task 4: Refactor `QueryEditor` to read the active tab

**Files:**
- Modify: `src/components/QueryEditor.jsx`

- [ ] **Step 1: Swap legacy reads for active-tab reads**

At the top of the component body (currently around line 35), replace:

```js
  const { currentQuery, setCurrentQuery, queryRunning, showToast, theme } = useAppStore()
```

With:

```js
  const activeTab = useAppStore((s) =>
    s.queryTabs.find((t) => t.id === s.activeTabId) ?? null
  )
  const updateTabContent = useAppStore((s) => s.updateTabContent)
  const showToast = useAppStore((s) => s.showToast)
  const theme = useAppStore((s) => s.theme)
```

- [ ] **Step 2: Use `path` prop on Monaco `<Editor>`**

Locate the `<Editor>` JSX (around line 266-275). Replace with:

```jsx
        <Editor
          height="100%"
          path={activeTab?.id ?? 'empty'}
          defaultLanguage="sql"
          theme={theme === 'dark' ? 'gamalab-dark' : 'gamalab-light'}
          value={activeTab?.content ?? ''}
          onChange={(v) => {
            if (activeTab) updateTabContent(activeTab.id, v ?? '')
          }}
          onMount={handleMount}
          options={{ ...MONACO_OPTIONS, readOnly: activeTab?.running ?? false }}
        />
```

> **Why `path`:** `@monaco-editor/react` creates a new `ITextModel` per unique `path` prop value and restores cursor/scroll/undo history when the prop changes back to a previously seen value. This gives us per-tab undo stacks for free.

- [ ] **Step 3: Update `formatSql` and `copyQuery` to operate on active tab**

The helpers currently fall back to `currentQuery`. Replace the fallbacks with `activeTab?.content`:

```js
  const formatSql = useCallback(() => {
    try {
      const value = editorRef.current?.getValue() || activeTab?.content || ''
      const formatted = format(value, { language: 'postgresql', keywordCase: 'upper' })
      if (editorRef.current) {
        editorRef.current.setValue(formatted)
      } else if (activeTab) {
        updateTabContent(activeTab.id, formatted)
      }
    } catch (err) {
      showToast(`Format failed: ${err.message}`, 'error')
    }
  }, [activeTab, updateTabContent, showToast])

  const copyQuery = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        editorRef.current?.getValue() || activeTab?.content || ''
      )
      showToast('Query copied', 'info')
    } catch {
      showToast('Copy failed', 'error')
    }
  }, [activeTab, showToast])

  const clearQuery = () => {
    if (editorRef.current) editorRef.current.setValue('')
    if (activeTab) updateTabContent(activeTab.id, '')
  }
```

- [ ] **Step 4: Update global keydown fallback for Ctrl+Enter**

The existing `useEffect` that listens for `Ctrl/Cmd+Enter` on window reads `currentQuery`. Replace with:

```js
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        onRun?.(editorRef.current?.getValue() ?? activeTab?.content ?? '')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeTab, onRun])
```

- [ ] **Step 5: Manual verification**

Start the app. Type some SQL in the editor. Verify:
- Typing updates the tab (in DevTools: `useAppStore.getState().queryTabs[0].content` matches)
- Ctrl+Enter runs the query
- Format (Shift+Alt+F), Copy, Clear buttons all operate on the editor/active tab
- No console errors

- [ ] **Step 6: Pause for manual commit**

Suggested message: `refactor(tabs): QueryEditor reads/writes active tab via path prop`

---

## Task 5: Refactor `ResultsTable` to read the active tab

**Files:**
- Modify: `src/components/ResultsTable.jsx`

- [ ] **Step 1: Swap legacy reads**

Find the line that destructures `queryResult`, `queryError`, `queryRunning` from `useAppStore` (likely near the top of the component). Replace with:

```js
  const activeTab = useAppStore((s) =>
    s.queryTabs.find((t) => t.id === s.activeTabId) ?? null
  )
  const queryResult = activeTab?.result ?? null
  const queryError = activeTab?.error ?? null
  const queryRunning = activeTab?.running ?? false
  const duration = activeTab?.duration ?? null
```

Keep the rest of the component as-is. If the component currently reads `duration` from the result object (`queryResult?.duration`), prefer the per-tab `duration` now — it's authoritative.

> **If the component reads other store fields (showToast, etc.),** keep those reads via separate `useAppStore((s) => s.showToast)` selectors. Don't destructure the whole store.

- [ ] **Step 2: Manual verification**

Start the app, run a query. Verify:
- Result table populates with rows
- Running a bad query shows error
- Loading state shows while running
- Duration is displayed

- [ ] **Step 3: Pause for manual commit**

Suggested message: `refactor(tabs): ResultsTable reads from active tab`

---

## Task 6: Add `persist` middleware with migration and rehydration

**Files:**
- Modify: `src/store/appStore.js`

- [ ] **Step 1: Import `persist`**

At the top of the file, add:

```js
import { persist } from 'zustand/middleware'
```

- [ ] **Step 2: Wrap the store factory**

Locate the existing `export const useAppStore = create((set, get) => ({ ... }))` and wrap its argument with `persist(...)`:

```js
export const useAppStore = create(
  persist(
    (set, get) => ({
      // ... existing store body unchanged ...
    }),
    {
      name: 'gamalab-app',
      version: 1,
      partialize: (state) => ({
        queryTabs: state.queryTabs.map((t) => ({
          id: t.id,
          title: t.title,
          titleManual: t.titleManual,
          content: t.content,
        })),
        activeTabId: state.activeTabId,
        nextTabNumber: state.nextTabNumber,
      }),
      migrate: (persisted, version) => {
        if (!persisted) return persisted
        // Defensive: future-version migrations hook here.
        // v0 would carry a legacy `currentQuery` string; promote it to a tab.
        if (version < 1 && typeof persisted.currentQuery === 'string') {
          const id = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36)).slice(0, 8)
          return {
            ...persisted,
            queryTabs: [{
              id,
              title: 'Welcome to GamaLab',
              titleManual: false,
              content: persisted.currentQuery,
            }],
            activeTabId: id,
            nextTabNumber: 2,
          }
        }
        return persisted
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return
        // Re-inflate volatile per-tab fields (they were stripped by partialize)
        if (Array.isArray(state.queryTabs)) {
          state.queryTabs = state.queryTabs.map((t) => ({
            ...t,
            result: null,
            error: null,
            running: false,
            duration: null,
          }))
        }
        // Safety: if somehow we persisted 0 tabs, seed one
        if (!state.queryTabs || state.queryTabs.length === 0) {
          const id = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36)).slice(0, 8)
          state.queryTabs = [{
            id,
            title: 'Query 1',
            titleManual: false,
            content: '',
            result: null,
            error: null,
            running: false,
            duration: null,
          }]
          state.activeTabId = id
          state.nextTabNumber = 2
        }
        // Ensure activeTabId points to an existing tab
        if (!state.queryTabs.some((t) => t.id === state.activeTabId)) {
          state.activeTabId = state.queryTabs[0].id
        }
      },
    }
  )
)
```

- [ ] **Step 3: Manual verification — cold start**

Completely quit Electron (Cmd/Ctrl+Q, not just close). In DevTools (before launch), open Application → Local Storage → app origin, and **delete** the `gamalab-app` key if present. Launch the app.

Expected:
- Welcome tab appears (content: `-- Welcome to GamaLab 🧪…`)
- `localStorage` now has `gamalab-app` key with JSON containing `queryTabs: [{ id, title: "Welcome to GamaLab", titleManual: false, content: "..." }]`, `activeTabId`, `nextTabNumber: 2`

- [ ] **Step 4: Manual verification — persistence across restart**

With the welcome tab open, edit the SQL to `SELECT 42;`. Wait ~500ms for persist to flush. Full-quit the app (close the window, then check no Electron process lingers) and reopen.

Expected:
- The editor reopens with `SELECT 42;`
- `result`, `error`, `running`, `duration` are `null` / `false` (volatile fields reset)

- [ ] **Step 5: Manual verification — legacy `currentQuery` migration**

Quit the app, wipe `localStorage`, then manually seed a v0 blob in `localStorage` via DevTools console before launching:

```js
localStorage.setItem('gamalab-app', JSON.stringify({
  state: { currentQuery: '-- legacy\nSELECT 1;' },
  version: 0,
}))
```

Launch the app.

Expected: the welcome/editor shows `-- legacy\nSELECT 1;`, a single tab titled "Welcome to GamaLab". Inspecting `localStorage['gamalab-app']` afterward shows the migrated v1 structure.

- [ ] **Step 6: Pause for manual commit**

Suggested message: `feat(tabs): persist queryTabs across restarts with v1 migration`

---

## Task 7: Create `QueryTabBar` component

**Files:**
- Create: `src/components/QueryTabBar.jsx`

- [ ] **Step 1: Write the component**

```jsx
// src/components/QueryTabBar.jsx
import { useEffect, useRef, useState } from 'react'
import { Plus, X, Loader2 } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { cn } from '@/lib/utils'

export function QueryTabBar() {
  const queryTabs = useAppStore((s) => s.queryTabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const createTab = useAppStore((s) => s.createTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const setActiveTabId = useAppStore((s) => s.setActiveTabId)
  const renameTab = useAppStore((s) => s.renameTab)

  const [renamingId, setRenamingId] = useState(null)
  const [draftName, setDraftName] = useState('')
  const renameInputRef = useRef(null)

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  const beginRename = (tab) => {
    setRenamingId(tab.id)
    setDraftName(tab.title)
  }

  const commitRename = () => {
    if (!renamingId) return
    const trimmed = draftName.trim()
    if (trimmed) renameTab(renamingId, trimmed)
    setRenamingId(null)
    setDraftName('')
  }

  const cancelRename = () => {
    setRenamingId(null)
    setDraftName('')
  }

  const handleClose = async (tab) => {
    if (tab.running) return
    const nonEmpty = (tab.content || '').trim().length > 0
    if (nonEmpty && queryTabs.length > 1) {
      const ok = await window.gamalab.dialog.confirm({
        title: `Close "${tab.title}"?`,
        message: 'You have unsaved SQL in this tab. Closing will discard it.',
        detail: 'This cannot be undone.',
      })
      if (!ok) return
    }
    closeTab(tab.id)
  }

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-card">
      {/* Tabs list (horizontally scrollable) */}
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto scrollbar-none">
        {queryTabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const isRenaming = renamingId === tab.id
          const isLast = queryTabs.length === 1

          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => !isRenaming && setActiveTabId(tab.id)}
              onDoubleClick={() => beginRename(tab)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  handleClose(tab)
                }
              }}
              title={tab.title}
              className={cn(
                'group flex max-w-[180px] shrink-0 cursor-pointer select-none items-center gap-1.5 border-r border-border px-2.5 text-[11px] transition-colors',
                isActive
                  ? 'border-t-2 border-t-lab-blue bg-background text-foreground'
                  : 'border-t-2 border-t-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground'
              )}
            >
              {tab.running && (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-lab-blue" />
              )}

              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitRename()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      cancelRename()
                    }
                  }}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  className="min-w-0 flex-1 bg-transparent outline-none ring-1 ring-lab-blue/50 rounded-sm px-1 text-[11px]"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate font-medium">{tab.title}</span>
              )}

              <button
                type="button"
                disabled={tab.running || isLast}
                onClick={(e) => {
                  e.stopPropagation()
                  handleClose(tab)
                }}
                title={
                  isLast
                    ? "Can't close last tab"
                    : tab.running
                      ? 'Running…'
                      : 'Close tab'
                }
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm transition-colors',
                  isActive
                    ? 'opacity-100'
                    : 'opacity-0 group-hover:opacity-100',
                  'disabled:cursor-not-allowed disabled:opacity-30',
                  !isLast && !tab.running && 'hover:bg-muted'
                )}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
        })}
      </div>

      {/* Fixed + button (right) */}
      <button
        type="button"
        onClick={() => createTab()}
        title="New query tab (Ctrl+T)"
        className="flex h-full w-9 shrink-0 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Verify `cn` helper and `scrollbar-none` utility exist**

Check `src/lib/utils.js` — it should export `cn` (the `clsx` + `tailwind-merge` combo). If the project's Tailwind config doesn't have a `scrollbar-none` utility, replace the class with inline style: `style={{ scrollbarWidth: 'none' }}` on the scrollable div and add a global CSS rule `.scrollbar-none::-webkit-scrollbar { display: none }` in `src/styles/globals.css` (or wherever the global stylesheet lives).

To check:

```bash
grep -r "scrollbar-none" src/
```

If no results, apply the inline fallback above.

- [ ] **Step 3: Pause for manual commit**

Suggested message: `feat(tabs): add QueryTabBar component`

---

## Task 8: Create `useTabKeybindings` hook

**Files:**
- Create: `src/hooks/useTabKeybindings.js`

- [ ] **Step 1: Write the hook**

```js
// src/hooks/useTabKeybindings.js
import { useEffect } from 'react'
import { useAppStore } from '@/store/appStore'

export function useTabKeybindings() {
  useEffect(() => {
    const handler = (e) => {
      const viewMode = useAppStore.getState().viewMode
      if (viewMode !== 'sql') return

      const cmd = e.metaKey || e.ctrlKey
      if (!cmd) return

      const state = useAppStore.getState()
      const { queryTabs, activeTabId } = state

      // Ctrl/Cmd + T — new tab
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        state.createTab()
        return
      }

      // Ctrl/Cmd + W — close tab
      if (e.key === 'w' || e.key === 'W') {
        e.preventDefault()
        if (!activeTabId) return
        const tab = queryTabs.find((t) => t.id === activeTabId)
        if (!tab) return
        if (queryTabs.length <= 1 || tab.running) return
        // Empty content → close immediately; non-empty → confirm via same flow as × button
        const nonEmpty = (tab.content || '').trim().length > 0
        if (nonEmpty) {
          window.gamalab.dialog
            .confirm({
              title: `Close "${tab.title}"?`,
              message: 'You have unsaved SQL in this tab. Closing will discard it.',
              detail: 'This cannot be undone.',
            })
            .then((ok) => {
              if (ok) useAppStore.getState().closeTab(tab.id)
            })
        } else {
          state.closeTab(tab.id)
        }
        return
      }

      // Ctrl/Cmd + Tab — next tab
      if (e.key === 'Tab' && !e.shiftKey) {
        if (queryTabs.length <= 1) return
        e.preventDefault()
        const idx = queryTabs.findIndex((t) => t.id === activeTabId)
        const next = queryTabs[(idx + 1) % queryTabs.length]
        state.setActiveTabId(next.id)
        return
      }

      // Ctrl/Cmd + Shift + Tab — previous tab
      if (e.key === 'Tab' && e.shiftKey) {
        if (queryTabs.length <= 1) return
        e.preventDefault()
        const idx = queryTabs.findIndex((t) => t.id === activeTabId)
        const prev = queryTabs[(idx - 1 + queryTabs.length) % queryTabs.length]
        state.setActiveTabId(prev.id)
        return
      }

      // Ctrl/Cmd + 1..9 — jump to tab N
      if (/^[1-9]$/.test(e.key)) {
        const n = parseInt(e.key, 10)
        if (n > queryTabs.length) return
        e.preventDefault()
        state.setActiveTabId(queryTabs[n - 1].id)
        return
      }
    }

    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [])
}
```

> **Why `capture: true`:** ensures the listener sees Ctrl+Tab before Monaco. Monaco binds Ctrl+Tab internally; capturing at the window level with `preventDefault` blocks it.

- [ ] **Step 2: Pause for manual commit**

Suggested message: `feat(tabs): add useTabKeybindings hook`

---

## Task 9: Wire `QueryTabBar` and `useTabKeybindings` into `App.jsx`

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add imports**

Near the other component imports, add:

```js
import { QueryTabBar } from '@/components/QueryTabBar'
import { useTabKeybindings } from '@/hooks/useTabKeybindings'
```

- [ ] **Step 2: Call the hook**

Inside the `App` component body, after the existing hook calls (`useHealthCheck()`, etc.), add:

```js
  useTabKeybindings()
```

- [ ] **Step 3: Mount `QueryTabBar` in the SQL branch**

Locate the SQL-mode branch in the JSX (currently the fallback `<PanelGroup direction="vertical" autoSaveId="gamalab-editor">...`). Wrap `QueryEditor` with a column flex container and prepend `QueryTabBar`:

```jsx
                <PanelGroup direction="vertical" autoSaveId="gamalab-editor">
                  <Panel defaultSize={50} minSize={20}>
                    <div className="flex h-full flex-col">
                      <QueryTabBar />
                      <div className="min-h-0 flex-1">
                        <QueryEditor onRun={handleRunQuery} />
                      </div>
                    </div>
                  </Panel>
                  <PanelResizeHandle className="h-1 bg-border transition-colors hover:bg-ring data-[resize-handle-active]:bg-ring" />
                  <Panel defaultSize={50} minSize={20}>
                    <ResultsTable />
                  </Panel>
                </PanelGroup>
```

- [ ] **Step 4: Manual verification — full UX walkthrough**

Start the app. Verify:
1. Tab bar appears above the SQL editor with one tab "Welcome to GamaLab"
2. Click `+` → new empty tab named "Query 2", becomes active, editor empty
3. Type `SELECT 1;` → title auto-updates to "SELECT" (or "Query 2" if derivation returns null)
4. Type `-- my little test` on line 1 → title updates to "my little test"
5. Double-click the title → input appears, type "custom name", Enter → title is "custom name", stays put even when you edit the SQL
6. Ctrl+T → new tab, Ctrl+W → closes it
7. Ctrl+1 / Ctrl+2 jump between tabs
8. Ctrl+Tab cycles forward, Ctrl+Shift+Tab cycles backward
9. Middle-click an inactive tab → closes it (confirm dialog if content non-empty)
10. Hover × on inactive tab → appears; on last-only tab → disabled with "Can't close last tab" tooltip
11. Run a long-ish query (e.g. `SELECT pg_sleep(3); SELECT 1;`) on tab A, switch to tab B while running, type SQL, switch back to tab A → result appears on A when done, B's edits preserved
12. Attempt Ctrl+Enter twice quickly on tab A → second shows toast "Already running"
13. Switch to a table via sidebar → tab bar disappears (viewMode = browse), switch back to SQL → tab bar reappears with the same tabs

- [ ] **Step 5: Pause for manual commit**

Suggested message: `feat(tabs): wire QueryTabBar and useTabKeybindings into App`

---

## Task 10: Verify and (if needed) handle Ctrl+W in Electron main

**Files:**
- Possibly modify: `electron/main.js`

- [ ] **Step 1: Observe default behavior**

On your platform, with the app running and in SQL mode, press Ctrl+W. Note what happens:
- **Case A:** The tab closes correctly and the Electron window stays open → no change needed, **skip to Step 3**.
- **Case B:** The Electron window closes (or dispatches a close intent) → apply Step 2.

- [ ] **Step 2 (conditional): Intercept Ctrl+W before the window sees it**

Locate the `createWindow()` function in `electron/main.js` where `mainWindow = new BrowserWindow({...})` is created (around line 98). Immediately after the `BrowserWindow` assignment, add:

```js
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (
      input.type === 'keyDown' &&
      (input.control || input.meta) &&
      !input.alt &&
      !input.shift &&
      input.key.toLowerCase() === 'w'
    ) {
      // Let the renderer handle Ctrl/Cmd+W (tab close)
      event.preventDefault()
    }
  })
```

Reload the app (fully quit + relaunch). Retest Ctrl+W — tab should close, window should stay.

- [ ] **Step 3: Pause for manual commit (skip if no changes)**

If Step 2 was applied, suggested message: `fix(tabs): prevent Ctrl+W from closing Electron window`

---

## Task 11: Remove legacy store fields and setters

**Files:**
- Modify: `src/store/appStore.js`

- [ ] **Step 1: Confirm no consumers remain**

Run a project-wide search to ensure nothing still reads the legacy fields:

```bash
grep -rn "currentQuery\|queryResult\|queryError\|queryRunning\|setCurrentQuery\|setQueryResult\|setQueryError\|setQueryRunning" src/ electron/
```

Expected output: zero matches in any `.js`/`.jsx` file outside `src/store/appStore.js`. If any remain, migrate them to the active-tab equivalent before continuing.

- [ ] **Step 2: Delete legacy fields**

In `src/store/appStore.js`, remove:

- State fields: `currentQuery`, `queryResult`, `queryError`, `queryRunning`
- Actions: `setCurrentQuery`, `setQueryResult`, `setQueryError`, `setQueryRunning`

Keep `queryHistory` and `addHistoryItem` — those remain global.

- [ ] **Step 3: Manual verification**

Start the app. Everything that worked in Task 9's walkthrough still works. DevTools console:

```js
// (temporarily re-expose store)
useAppStore.getState().currentQuery // → undefined ✓
useAppStore.getState().queryTabs[0].content // → current content ✓
```

- [ ] **Step 4: Pause for manual commit**

Suggested message: `chore(tabs): remove legacy currentQuery/queryResult/queryError/queryRunning`

---

## Task 12: Final verification checklist

**Files:** none — verification only.

- [ ] **Step 1: Run the spec's manual verification checklist end-to-end**

From `docs/superpowers/specs/2026-04-24-query-tabs-design.md`, walk every item:

- [ ] Create 3 tabs, edit different SQL in each, switch: content + undo/redo (Ctrl+Z per tab) + cursor + scroll preserved
- [ ] Run query on Tab A, switch to Tab B immediately, edit Tab B. Result lands on Tab A; Tab B edits uninterrupted
- [ ] `Ctrl/Cmd + T` opens new empty tab; focus lands in Monaco (type immediately without extra click)
- [ ] `Ctrl/Cmd + W` closes active tab and activates neighbour; last-tab close is no-op
- [ ] `Ctrl/Cmd + 1..9` jumps to tab N; `Ctrl/Cmd + Tab` forward; `Ctrl/Cmd + Shift + Tab` backward
- [ ] Close tab with non-empty content → confirm dialog (Cancel keeps tab / OK removes it)
- [ ] Close tab with empty content → no confirm dialog
- [ ] Double-click tab title → inline input; Enter commits; Escape cancels; blur commits
- [ ] Manual rename sticks — editing SQL doesn't overwrite a manually renamed tab
- [ ] Reload Electron (Ctrl+R in DevTools or full relaunch): tabs, activeTabId, titles, content restored; `result/error/running` empty
- [ ] First-launch migration: wipe `localStorage['gamalab-app']`, relaunch → single welcome tab
- [ ] Switch `activeConnection` → tabs and content preserved, all `result/error` cleared
- [ ] Middle-click on inactive tab closes it
- [ ] Tab bar hidden in browse/schema mode; restored in SQL mode with same tabs
- [ ] `Ctrl+W` does not close the Electron window when a tab exists to close (per Task 10)

- [ ] **Step 2: Screenshot the final state**

Take one screenshot of the tab bar with ≥ 3 tabs open (at least one with manual rename, one with a running query if possible). Add it to the session notes for your own reference.

- [ ] **Step 3: Pause for manual commit (if any final polish)**

If you made tiny polish changes during verification (spacing, a tooltip wording, etc.), group them into a single commit: `polish(tabs): verification pass`.

---

## Self-review

Spec coverage cross-check:

- ✅ Data model & store shape → Task 2 (fields, actions)
- ✅ `setActiveConnection` → `clearAllTabResults` → Task 2 Step 3
- ✅ `useDatabase.runQuery` per-tab refactor → Task 3
- ✅ Persistence + partialize + migration + `onRehydrateStorage` → Task 6
- ✅ Volatile fields reset at hydration → Task 6 Step 2 (`onRehydrateStorage`)
- ✅ `deriveTitle` helper → Task 1
- ✅ QueryTabBar component (layout, close, rename, running indicator, `+` fixed right) → Task 7
- ✅ QueryEditor per-tab with `path` prop → Task 4
- ✅ ResultsTable per-tab read → Task 5
- ✅ App.jsx wiring → Task 9
- ✅ Keyboard shortcuts (T/W/Tab/1-9) → Task 8
- ✅ Electron Ctrl+W handling → Task 10
- ✅ Legacy cleanup → Task 11
- ✅ Full verification checklist → Task 12

No placeholders: all tasks have full code blocks or specific commands, no "TBD" / "implement later". Type consistency: action names (`createTab`, `closeTab`, `setActiveTabId`, `updateTabContent`, `renameTab`, `setTabResult`, `setTabRunning`, `clearAllTabResults`) and tab field names (`id`, `title`, `titleManual`, `content`, `result`, `error`, `running`, `duration`) are used identically across every task.
