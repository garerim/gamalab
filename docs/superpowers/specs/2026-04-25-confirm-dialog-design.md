# In-App Confirm Dialog — Design

**Status:** Design approved, pending implementation
**Date:** 2026-04-25
**Author:** Matheo (via brainstorming session)

## Summary

Replace the native Electron `dialog.showMessageBox` used for in-app confirmations with a React modal rendered by the renderer. The current implementation triggers the OS native dialog (with the Windows "ding" sound and a Windows-styled chrome inconsistent with the rest of the app). The replacement uses the same shadcn `Dialog` primitive as `SaveSnippetDialog`, supports a `destructive` variant for dangerous actions, allows custom button labels, and remains async-compatible with the 8 existing call sites via a renderer-side `confirm()` helper. The IPC handler `dialog:confirm` and its preload wrapper are removed as dead code.

## Goals

- Eliminate the OS-native confirm dialog (and its system sound) for in-app confirmations
- Provide a visually consistent confirm UI matching the app's shadcn/Tailwind design language (dark + light themes)
- Differentiate dangerous (destructive) vs. routine confirmations via a `variant` prop with appropriate visual cues (icon, button color)
- Allow custom button labels per call site (e.g. "Drop table" instead of generic "Confirm")
- Preserve all 8 existing call sites' behavior (returns `Promise<boolean>`, no behavior change for the user beyond the visual upgrade)
- Variant-aware default focus: destructive → Cancel focused; default → Confirm focused
- Cleanly remove the now-unused IPC handler and preload binding

## Non-goals (v1)

- Migrating `dialog.saveExport` and `dialog.savePng` to React modals (file pickers MUST stay native — OS file system access)
- Three or more variants (e.g. `info` / `warning` / `destructive`) — `default` + `destructive` covers every current call site
- Localization (i18n) of button labels — English consistent with the rest of the app
- Confirm dialog queue (concurrent calls return `false` silently rather than queuing)
- Markdown/rich content in `message` or `detail`
- Custom icons per call site
- "Don't ask again" persistent opt-out
- Visual progress indicator if the confirm is followed by a long action
- Animations (Radix's default mount/unmount transitions are sufficient)

## Architecture

### Renderer-side `confirm()` helper

`src/lib/confirm.js` exports a single async function. It mediates between caller and the React modal via a Zustand-backed payload + a module-level `pending` ref to enforce one-at-a-time concurrency.

```js
// src/lib/confirm.js
import { useAppStore } from '@/store/appStore'

let pending = null

export function confirm({
  title,
  message,
  detail = '',
  variant = 'default',          // 'default' | 'destructive'
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
} = {}) {
  if (pending) return Promise.resolve(false)

  return new Promise((resolve) => {
    pending = { resolve }
    useAppStore.getState().setConfirmDialog({
      title, message, detail, variant, confirmLabel, cancelLabel,
      onResolve: (result) => {
        pending = null
        useAppStore.getState().setConfirmDialog(null)
        resolve(result)
      },
    })
  })
}
```

**Concurrency model:** one open dialog at a time. A second `confirm()` call while a dialog is open resolves immediately with `false`. Documented as deliberate ("avoid surprising stack-of-modals UX from rapid keyboard input").

### Store extension

`src/store/appStore.js` gets one new field and one setter:

```js
confirmDialog: null,                            // null when closed; payload object when open
setConfirmDialog: (payload) => set({ confirmDialog: payload }),
```

The payload shape:
```js
{
  title: string,
  message: string,
  detail: string,
  variant: 'default' | 'destructive',
  confirmLabel: string,
  cancelLabel: string,
  onResolve: (result: boolean) => void,
}
```

`confirmDialog` is **NOT** persisted by the `persist` middleware (transient UI state, no need to survive restarts). Verify the `partialize` block does not include it.

### React component

`src/components/ConfirmDialog.jsx` is mounted unconditionally at the App root (next to `<SaveSnippetDialog />` / `<SnippetPalette />`). It reads `confirmDialog` from the store; renders the shadcn `Dialog` only when the payload is non-null. On user choice (button click, Esc, or backdrop click), it invokes `payload.onResolve(true|false)`, which the helper unwinds.

```jsx
// Pseudocode shape — full code in implementation plan
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Trash2 } from 'lucide-react'

export function ConfirmDialog() {
  const dialog = useAppStore((s) => s.confirmDialog)
  if (!dialog) return null

  const { title, message, detail, variant, confirmLabel, cancelLabel, onResolve } = dialog
  const isDestructive = variant === 'destructive'
  const Icon = isDestructive ? Trash2 : AlertTriangle
  const iconClass = isDestructive ? 'text-destructive' : 'text-yellow-500'
  const confirmVariant = isDestructive ? 'destructive' : 'default'

  // Variant-aware default focus
  const cancelRef = useRef(null)
  const confirmRef = useRef(null)
  useEffect(() => {
    (isDestructive ? cancelRef : confirmRef).current?.focus()
  }, [isDestructive])

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onResolve(false) }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', iconClass)} />
            <DialogTitle>{title}</DialogTitle>
          </div>
        </DialogHeader>
        <div className="flex flex-col gap-2 pl-8 text-sm">
          <p>{message}</p>
          {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
        </div>
        <DialogFooter>
          <Button ref={cancelRef} variant="ghost" onClick={() => onResolve(false)}>
            {cancelLabel}
          </Button>
          <Button ref={confirmRef} variant={confirmVariant} onClick={() => onResolve(true)}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

`onOpenChange(false)` covers Esc + backdrop click in one handler (Radix-standard).

### Button "destructive" variant

The shadcn `Button` component must support `variant="destructive"` (red background, white text, hover state). This is part of the standard shadcn cva pattern. Implementation step: verify in `src/components/ui/button.jsx`. If absent, add the cva entry (~5 LOC):
```js
destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
```

## Migration of 8 call sites

Uniform diff per file: import the helper, swap the call, add `variant` and `confirmLabel`. Variant + label assignments per call site:

| File | Action | Variant | confirmLabel |
|---|---|---|---|
| `src/components/QueryTabBar.jsx:48` | Close tab with unsaved SQL | `default` | `Close tab` |
| `src/components/SchemaDiagram.jsx:189` | Reset auto-layout | `default` | `Reset` |
| `src/components/TableBrowser.jsx:507` | Delete N rows | `destructive` | `Delete` |
| `src/components/TableBrowser.jsx:748` | Drop table (from browser) | `destructive` | `Drop table` |
| `src/hooks/useDatabase.js:75` | Dangerous query (DROP/TRUNCATE/unconditional DELETE) | `destructive` | `Run anyway` |
| `src/hooks/useDocker.js:98` | Delete container | `destructive` | `Delete` |
| `src/hooks/useSnippets.js:79` | Delete snippet | `destructive` | `Delete` |
| `src/hooks/useTables.js:55` | Drop table (from sidebar list) | `destructive` | `Drop table` |

Per-file pattern (destructive case shown; for `default` rows, omit the `variant` line since `'default'` is the helper's default):
```diff
+ import { confirm } from '@/lib/confirm'
- const ok = await window.gamalab.dialog.confirm({
+ const ok = await confirm({
    title: '...',
    message: '...',
    detail: '...',
+   variant: 'destructive',   // omit for default-variant call sites
+   confirmLabel: 'Drop table',
  })
```

`cancelLabel` is never overridden — the helper's default `'Cancel'` is correct for every call site.

## Cleanup (Electron)

After all call sites are migrated, the IPC handler and preload wrapper for `dialog:confirm` are dead code:

**`electron/main.js`** — Remove the entire block:
```js
ipcMain.handle('dialog:confirm', async (_evt, options) => { ... })
```
Keep `dialog` import from `require('electron')` if it's still used by the file picker handlers (`dialog:save-export`, `dialog:save-png`). Verify before deletion of the import.

**`electron/preload.js`** — Remove only the `confirm` line from the `dialog` namespace:
```diff
  dialog: {
-   confirm: (options) => ipcRenderer.invoke('dialog:confirm', options),
    saveExport: (options) => ipcRenderer.invoke('dialog:save-export', options),
    savePng: (options) => ipcRenderer.invoke('dialog:save-png', options),
  },
```

After cleanup, no code in the renderer references `window.gamalab.dialog.confirm` (verifiable via grep).

## App.jsx wiring

Add the import + mount alongside other dialogs (e.g., next to `<SaveSnippetDialog />`):

```jsx
import { ConfirmDialog } from '@/components/ConfirmDialog'

// In the JSX, near other mounted dialogs:
<ConfirmDialog />
```

No hook call needed — the modal is purely store-driven.

## Edge cases

- **Concurrent confirms** — A second `confirm()` call while a dialog is open returns `Promise.resolve(false)` silently. Documented as deliberate to avoid stack-of-modals UX.
- **Unknown variant** — The component checks `variant === 'destructive'`; any other value (including missing) falls through to `default` styling. Defensive.
- **`onResolve` called twice** — Once a button is clicked, the dialog closes (via `setConfirmDialog(null)`) and unmounts, preventing a second click. The helper's `pending = null` reset is idempotent. Safe.
- **App quit while pending** — The Promise stays pending; garbage-collected with the JS context. No leak.
- **Esc and backdrop click** — Both fire `onOpenChange(false)` from Radix Dialog → resolve `false`. Identical to clicking Cancel.
- **Enter on focused button** — Native browser behavior triggers the focused button's `onClick`. Variant-aware focus means destructive defaults to Cancel-on-Enter (safer), default defaults to Confirm-on-Enter (faster).
- **Variant-aware focus during testing** — The `useEffect` runs once when the dialog mounts because `isDestructive` is stable for the lifetime of the open dialog. No re-focus loop.

## Testing

No test framework in the project. Manual verification checklist (will be replicated in the implementation plan):

- [ ] **No system sound** when any confirm dialog opens (the original goal — verify by ear on Windows)
- [ ] Close tab with unsaved SQL → yellow warning icon, "Cancel | Close tab", focus on Close tab
- [ ] Drop table from sidebar → red trash icon, "Cancel | Drop table", focus on Cancel
- [ ] Drop table from browser toolbar → identical to sidebar
- [ ] Delete N rows from browser → red trash icon, "Cancel | Delete", focus on Cancel
- [ ] Delete snippet (sidebar trash icon) → red trash icon, "Cancel | Delete", focus on Cancel
- [ ] Delete Docker container → red trash icon, "Cancel | Delete", focus on Cancel
- [ ] Run dangerous query (e.g. `DROP TABLE foo`) → red trash icon, "Cancel | Run anyway", focus on Cancel
- [ ] Reset layout (SchemaDiagram toolbar) → yellow warning icon, "Cancel | Reset", focus on Reset
- [ ] **Esc** closes with `false` (no action taken)
- [ ] **Backdrop click** closes with `false`
- [ ] **Enter on destructive variant** → Cancel triggered (safer)
- [ ] **Enter on default variant** → Confirm triggered (faster)
- [ ] Visual: dialog matches dark/light theme tokens (no off-color text or backgrounds)
- [ ] Visual: variant icon + button color clearly differentiate destructive from default
- [ ] Trigger a second confirm while one is open (e.g., via two rapid keyboard shortcuts) → second silently returns `false`, no double-modal
- [ ] After full restart: search the renderer code for `window.gamalab.dialog.confirm` — zero results
- [ ] After full restart: trigger any confirm; works without errors in DevTools console

## Files touched (summary)

**Created:**
- `src/lib/confirm.js` — async helper with one-at-a-time concurrency gate (~40 LOC)
- `src/components/ConfirmDialog.jsx` — store-driven modal component (~80 LOC)

**Modified:**
- `src/store/appStore.js` — add `confirmDialog` state + `setConfirmDialog` setter
- `src/components/ui/button.jsx` — add `destructive` variant if missing (verify first; ~5 LOC if needed)
- `src/App.jsx` — import + mount `<ConfirmDialog />`
- `electron/main.js` — remove `ipcMain.handle('dialog:confirm', ...)` block
- `electron/preload.js` — remove `confirm` from the `dialog` namespace

**Migrated call sites (each ~3-line diff):**
- `src/components/QueryTabBar.jsx`
- `src/components/SchemaDiagram.jsx`
- `src/components/TableBrowser.jsx` (2 call sites)
- `src/hooks/useDatabase.js`
- `src/hooks/useDocker.js`
- `src/hooks/useSnippets.js`
- `src/hooks/useTables.js`

## Out of scope / future work

- `info` and `warning` variants beyond `default` / `destructive` — add when a call site genuinely needs them
- Custom icons per call site
- Dialog queue (currently rejects concurrent confirms with `false`)
- Localization (i18n)
- "Don't ask again" persistent opt-out
- Animations beyond Radix defaults
- Migrating other dialog primitives (`dialog.saveExport`, `dialog.savePng`) — file pickers must stay native OS
- Aligning `useTables.dropTable`'s "drop with cascade" sub-prompt to use the same pattern (currently it's combined into the `detail` field — acceptable for v1)
