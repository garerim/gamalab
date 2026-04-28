# Rename Connection — Design

**Status:** Design approved, pending implementation
**Date:** 2026-04-25
**Author:** Matheo (via brainstorming session)

## Summary

Add inline rename to GamaLab's `ConnectionList` cards. Double-clicking the connection name swaps the `<span>` for an `<input>`, pre-filled with the currently displayed name. Enter commits via a new `renameConnection(id, name)` store action that preserves the connection's position in the list (unlike `addConnection`, which currently moves the entry to the end via filter+push). Empty name on submit clears the custom name, falling back to the auto-displayed `conn.database`. Esc cancels. Pattern mirrors `QueryTabBar` rename UX exactly.

## Goals

- Let users give friendly names to existing connections without re-creating them (no current path to edit a saved connection's name)
- Match the inline-rename UX already used by `QueryTabBar` for consistency
- Preserve connection order in the list (the existing `addConnection` upsert reorders — explicitly avoided here)
- Persist the new name to disk via the existing `window.gamalab.store.set('connections', ...)` mechanism
- Allow clearing the custom name (returns display to the DB-name fallback)

## Non-goals (v1)

- Editing other connection fields (host, port, user, password, database, sslMode) — separate feature, much bigger scope (would require re-validation, re-test, possibly disconnect/reconnect)
- Pencil-icon button or right-click context menu (chose double-click per Q1 = A for consistency with QueryTabBar)
- Rename via toast or notification feedback — silent + instant
- Auto-save on each keystroke (commit on Enter or blur)
- Undo of a rename (the user can re-rename if they regret it)
- Renaming the active connection differently (no special case)
- Renaming connections from elsewhere (e.g. Toolbar dropdown) — only the sidebar list

## Architecture

### Store action

Add `renameConnection(id, name)` to `src/store/appStore.js`:

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

**Key design points:**

- `.map()` instead of `addConnection`'s `filter+push` → preserves the connection's position in the array (the entry doesn't move to the end on update).
- `name: trimmed || undefined` → an empty trimmed string assigns `undefined`, which serializes as the field being absent in JSON. On reload, `conn.name` is `undefined`, and the display logic `{conn.name || conn.database}` falls through to the DB name. This implements Q2b = ii (empty submit = clear custom name).
- Persistence pattern matches the existing `addConnection` and `removeConnection` actions: in-memory `set` plus `window.gamalab.store.set('connections', connections)`.
- Idempotent: renaming to the same name produces an equivalent state (no error, no toast).
- No event for unknown id (silent no-op via `.map` returning a new array with no changes).

### Renderer state

Local state added to `ConnectionList`:

```js
const [renamingId, setRenamingId] = useState(null)
const [draftName, setDraftName] = useState('')
const renameInputRef = useRef(null)
const renameConnection = useAppStore((s) => s.renameConnection)
```

`renamingId` is the id of the connection currently being edited (or `null`). Only one card can be in edit mode at a time — entering another card's edit closes the first.

### Auto-focus effect

```js
useEffect(() => {
  if (renamingId && renameInputRef.current) {
    renameInputRef.current.focus()
    renameInputRef.current.select()
  }
}, [renamingId])
```

Same pattern as `QueryTabBar` — focus + select on entry to make the existing text immediately replaceable.

### Handlers

```js
const beginRename = (conn) => {
  setRenamingId(conn.id)
  setDraftName(conn.name || conn.database || '')  // Q2a = i: pre-fill with displayed name
}

const commitRename = () => {
  if (!renamingId) return
  renameConnection(renamingId, draftName)  // Q2b = ii: empty clears custom name
  setRenamingId(null)
  setDraftName('')
}

const cancelRename = () => {
  setRenamingId(null)
  setDraftName('')
}
```

`commitRename` does NOT short-circuit on empty `draftName` — empty is a valid intent (clear the custom name).

## UI changes

### Conditional render of the name span

In `ConnectionList.jsx`, the existing line:

```jsx
<span className="truncate font-medium">{conn.name || conn.database}</span>
```

Becomes:

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

Key behaviors:

- `onClick={(e) => e.stopPropagation()}` on the input prevents click-on-input from being interpreted by the parent card as "set active connection".
- `onDoubleClick={(e) => e.stopPropagation()}` on the input prevents re-triggering `beginRename` if the user double-clicks inside the input.
- `onDoubleClick` on the span calls `e.stopPropagation()` then `beginRename(conn)` — the propagation guard prevents bubbling to the card's `onClick`.
- `title="Double-click to rename"` provides discoverability via tooltip.
- `maxLength={80}` consistent with the snippet `name` cap.

### Card click guard

The card's `onClick` handler currently sets the active connection. Modify to skip when this card is being renamed:

```jsx
onClick={() => {
  if (renamingId === conn.id) return  // don't switch active while renaming
  setActiveConnectionId(conn.id)
}}
```

Defensive: most clicks during rename are caught by `e.stopPropagation()` on the input, but this guard handles any leak (e.g. clicking on the card's padding outside the input).

## Edge cases

- **Empty submit (Enter on empty input)** — clears `conn.name` to `undefined`; display falls back to `conn.database`. Intentional per Q2b = ii.
- **Esc cancel** — leaves the original `conn.name` untouched.
- **Blur commit** — `onBlur={commitRename}` mirrors QueryTabBar.
- **Single-click on the card during rename** — guarded by `renamingId === conn.id` early-return. Active connection unchanged.
- **Single-click outside the input but inside the card** (e.g. on the icon, badge, or padding) — bubbles to the card's `onClick`, which is now guarded → no-op.
- **Double-click on a different card while renaming** — `beginRename` of the other card fires, sets `renamingId` to the new id; the first input loses focus, triggers `onBlur`, commits the first edit, then the second input mounts and focuses. Sane behavior.
- **Renaming the active connection** — no special handling. The connection stays active; only its `name` field updates.
- **Reloading the app** — `connections` persists to disk via existing `window.gamalab.store.set` call inside the action; on reload, `initialize()` reads the JSON and the new name is restored.
- **Order preservation** — `.map()` keeps the connection at the same array index. Cross-check: re-render of the list reflects no reordering.
- **Connection without a `database` field** — extremely unlikely (the connect dialogs always set it) but if so, the displayed fallback after a clear would be empty. Acceptable; the user can re-rename. We could add a third fallback (`conn.host`) but it's YAGNI.

## Testing

No test framework — manual verification (will be replicated in the implementation plan):

- [ ] Double-click on a connection's name → input appears, pre-filled with current displayed name, text auto-selected
- [ ] Type a new name + Enter → name updates immediately in the list
- [ ] Esc during editing → reverts to the original name (no mutation)
- [ ] Click outside the input (still inside the card) → commits via blur
- [ ] Clear input + Enter → custom name removed, display falls back to `conn.database`
- [ ] Click on the card body (single click) during editing → does NOT change active connection
- [ ] Double-click on a different connection's name while editing one → first commits via blur, second enters edit mode
- [ ] Single click on the card OUTSIDE editing mode → still sets active connection (existing behavior preserved)
- [ ] Reload the app (close + open) → renamed connection persists with new name
- [ ] Order of connections in the list is unchanged after a rename (the renamed entry stays at its original position)
- [ ] Renaming the currently-active connection works without disconnecting

## Files touched (summary)

**Modified:**
- `src/store/appStore.js` — add `renameConnection(id, name)` action (~10 LOC)
- `src/components/ConnectionList.jsx` — add useState/useRef/useEffect imports, local state, handlers, conditional input/span render, card click guard (~40 LOC additions)

**Created:** none.

## Out of scope / future work

- Pencil-icon button or right-click context menu for rename
- Inline editing of other connection fields (host/port/user/password/database/sslMode)
- Rename via Toolbar or other surfaces
- Connection reordering (drag-and-drop or up/down arrows) — separate feature
- Bulk rename / connection groups / tags
- Toast feedback on rename success
