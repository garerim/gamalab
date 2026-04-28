# Rename Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Git convention for this project:** The user handles all `git commit` and `git push` operations manually. Each commit step is a pause point with a suggested message — do NOT run `git commit` yourself. Wait for the user to commit (or explicitly ask them to) before proceeding to the next task.

**Goal:** Let users rename existing connections inline by double-clicking the connection name in the sidebar, mirroring the rename UX already used by `QueryTabBar`.

**Architecture:** Add a `renameConnection(id, name)` action to the Zustand store that uses `.map()` to preserve the connection's position in the list (unlike the existing `addConnection` which uses `filter+push` and reorders). Persist via the existing `window.gamalab.store.set('connections', ...)` channel. Update `ConnectionList.jsx` with local state for the in-progress rename, an `<input>` swapped in for the name `<span>` when editing, and a click guard on the parent card so single-click during edit doesn't switch the active connection.

**Tech Stack:** React 18, Zustand 4.5, Electron-store JSON persistence (existing).

**Reference spec:** `docs/superpowers/specs/2026-04-25-rename-connection-design.md`

---

## File Structure

**Modified:**
- `src/store/appStore.js` — add `renameConnection(id, name)` action (~10 LOC)
- `src/components/ConnectionList.jsx` — add useState/useRef/useEffect imports, local state, handlers, conditional input/span render, card click guard (~40 LOC additions)

**Created:** none.

---

## Task 1: Add `renameConnection` action to the store

**Files:**
- Modify: `src/store/appStore.js`

- [ ] **Step 1: Add the action**

Open `src/store/appStore.js`. Locate the existing `removeConnection` action (around line 93-100). Add the new `renameConnection` action immediately after it:

```js
  renameConnection: (id, name) => {
    const trimmed = (name || '').trim()
    const connections = get().connections.map((c) =>
      c.id === id
        ? { ...c, name: trimmed || undefined }
        : c
    )
    set({ connections })
    window.gamalab.store.set('connections', connections)
  },
```

Match the surrounding style (no semicolons, 2-space indent, arrow function).

Key design points (already verified in the spec):
- `.map()` preserves the connection's position (unlike `addConnection` which uses `filter+push` and reorders).
- `name: trimmed || undefined` → empty submit clears the custom name; `undefined` is omitted from the JSON, so on reload `conn.name` is `undefined` and the display fallback `{conn.name || conn.database}` kicks in.
- Persistence pattern matches the sibling actions (`addConnection`, `removeConnection`).

- [ ] **Step 2: Verify build**

```bash
npx vite build
```

Expected: success.

- [ ] **Step 3: DO NOT commit**

Suggested commit message: `feat(connections): add renameConnection store action`

---

## Task 2: Wire inline rename UI in `ConnectionList.jsx`

**Files:**
- Modify: `src/components/ConnectionList.jsx`

This task touches one file with five small changes: imports, state, handlers, the name span/input swap, and the card click guard.

- [ ] **Step 1: Update React imports**

The current top of the file does NOT import React hooks (the component uses no local state today). Add at the very top of the file:

```js
import { useEffect, useRef, useState } from 'react'
```

Place this BEFORE the existing `import { Database, Plug, ... } from 'lucide-react'` line (alphabetical and standard order: react first, then libraries, then local).

- [ ] **Step 2: Pull `renameConnection` from the store and add local state**

Inside the `ConnectionList` function body, after the existing two destructure lines:

```js
  const { connections, activeConnectionId, activeConnection, setActiveConnectionId, connect, disconnect } = useDatabase()
  const { setCreateDialogOpen, setNewLogicalDbDialogOpen, setConnectRemoteDialogOpen, connectionHealth } = useAppStore()
```

Add:

```js
  const renameConnection = useAppStore((s) => s.renameConnection)

  const [renamingId, setRenamingId] = useState(null)
  const [draftName, setDraftName] = useState('')
  const renameInputRef = useRef(null)

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  const beginRename = (conn) => {
    setRenamingId(conn.id)
    setDraftName(conn.name || conn.database || '')
  }

  const commitRename = () => {
    if (!renamingId) return
    renameConnection(renamingId, draftName)
    setRenamingId(null)
    setDraftName('')
  }

  const cancelRename = () => {
    setRenamingId(null)
    setDraftName('')
  }
```

`renameConnection` is pulled via individual selector for consistency with newer code patterns (`SnippetsList`, `QueryTabBar`) — even though the rest of this file uses a destructured `useAppStore()`. This is a deliberate small migration (no need to touch the existing destructure).

- [ ] **Step 3: Add card click guard**

Locate the connection card's `onClick` handler (around line 89):

```jsx
              onClick={() => setActiveConnectionId(conn.id)}
```

Replace with:

```jsx
              onClick={() => {
                if (renamingId === conn.id) return
                setActiveConnectionId(conn.id)
              }}
```

Defensive: prevents single-click on the card from switching active connection while the user is editing this card's name.

- [ ] **Step 4: Swap the name span for conditional input/span**

Locate the existing line (around line 99):

```jsx
                  <span className="truncate font-medium">{conn.name || conn.database}</span>
```

Replace it with:

```jsx
                  {renamingId === conn.id ? (
                    <input
                      ref={renameInputRef}
                      aria-label="Rename connection"
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
                      onDoubleClick={(e) => e.stopPropagation()}
                      className="min-w-0 flex-1 rounded-sm bg-transparent px-1 text-xs font-medium outline-none ring-1 ring-lab-blue/50"
                      maxLength={80}
                    />
                  ) : (
                    <span
                      className="truncate font-medium"
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        beginRename(conn)
                      }}
                      title="Double-click to rename"
                    >
                      {conn.name || conn.database}
                    </span>
                  )}
```

Key behaviors recap:
- `onClick={(e) => e.stopPropagation()}` on the input — prevents the card's `onClick` from firing on input click.
- `onDoubleClick={(e) => e.stopPropagation()}` on the input — prevents bubbling that could re-trigger `beginRename` if the user double-clicks inside the input.
- `onDoubleClick` on the span — `stopPropagation` first (so the card's click listener doesn't see it), then call `beginRename(conn)`.
- `title="Double-click to rename"` — discoverability via tooltip.
- `maxLength={80}` consistent with snippet name limit.

- [ ] **Step 5: Verify build**

```bash
npx vite build
```

Expected: success.

- [ ] **Step 6: Smoke test (optional, interactive)**

Start the app via `npm run dev`. In the sidebar Connections tab:
- Double-click a connection name → input appears, text auto-selected
- Type new name + Enter → name updates immediately
- Esc during edit → reverts to original
- Clear input + Enter → name removed, falls back to DB name
- Click the card body during edit → does NOT change active connection

If interactive testing isn't available, the build verification of Step 5 is sufficient — Task 3 covers the full manual checklist.

- [ ] **Step 7: DO NOT commit**

Suggested commit message: `feat(connections): inline rename via double-click`

---

## Task 3: Final manual verification checklist

**Files:** none — verification only.

- [ ] **Step 1: Walk the spec's manual verification checklist end-to-end**

From `docs/superpowers/specs/2026-04-25-rename-connection-design.md` (Testing section):

- [ ] Double-click on a connection's name → input appears, pre-filled with current displayed name (`conn.name || conn.database`), text auto-selected
- [ ] Type a new name + Enter → name updates immediately in the list
- [ ] Esc during editing → reverts to the original name (no mutation)
- [ ] Click outside the input but inside the card → commits via blur (the field auto-saves)
- [ ] Clear input + Enter → custom name removed, display falls back to `conn.database`
- [ ] Click on the card body (single click) during editing → does NOT change active connection
- [ ] Double-click on a different connection's name while editing one → first commits via blur, second enters edit mode
- [ ] Single click on the card OUTSIDE editing mode → still sets active connection (existing behavior preserved)
- [ ] Reload the app (close + open) → renamed connection persists with new name
- [ ] Order of connections in the list is unchanged after a rename (the renamed entry stays at its original position)
- [ ] Renaming the currently-active connection works without disconnecting

- [ ] **Step 2: Pause for any final polish commits (rare)**

If you made tiny tweaks during verification (spacing, copy), group them into one commit: `polish(connections): rename verification pass`.

---

## Self-review

**Spec coverage cross-check:**

- ✅ `renameConnection(id, name)` action with `.map()` preservation + persistence → Task 1
- ✅ Empty submit clears custom name (`name: trimmed || undefined`) → Task 1 (semantics in the action)
- ✅ Local state (`renamingId`, `draftName`, `renameInputRef`) → Task 2 Step 2
- ✅ Auto-focus + select on enter edit → Task 2 Step 2 (useEffect)
- ✅ `beginRename`, `commitRename`, `cancelRename` handlers → Task 2 Step 2
- ✅ Card click guard against active-switch during rename → Task 2 Step 3
- ✅ Conditional input/span render with all event handlers → Task 2 Step 4
- ✅ `aria-label="Rename connection"` for accessibility → Task 2 Step 4
- ✅ Manual verification checklist → Task 3

**Type / signature consistency check:**

- `renameConnection(id, name)` — defined in Task 1, called in Task 2 Step 2 (`commitRename`)
- `renamingId` (string|null), `draftName` (string), `renameInputRef` — declared and used consistently across handlers and JSX in Task 2
- `beginRename(conn)`, `commitRename()`, `cancelRename()` — same names everywhere
- `conn.name || conn.database` fallback — used identically in display and pre-fill

**Placeholder scan:** No "TBD" / "TODO" markers. Each step has either complete code or a precise instruction. The optional smoke test in Task 2 Step 6 is explicitly marked optional.

**Code organization note:** Task 2 deliberately uses individual `useAppStore((s) => s.renameConnection)` for the new action while leaving the existing destructured `useAppStore()` call alone. Migrating the rest of the destructure to individual selectors is acknowledged but out of scope — it's a project-wide pattern question, not a rename-specific one.
