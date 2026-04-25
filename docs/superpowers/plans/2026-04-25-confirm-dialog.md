# In-App Confirm Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Git convention for this project:** The user handles all `git commit` and `git push` operations manually. Each commit step is a pause point with a suggested message — do NOT run `git commit` yourself. Wait for the user to commit (or explicitly ask them to) before proceeding to the next task.

**Goal:** Replace the OS-native Electron confirm dialog (with its system "ding" sound and Windows chrome) with an in-app React modal styled with shadcn/Tailwind, supporting `default` and `destructive` variants and per-call-site button labels.

**Architecture:** A renderer-side `confirm()` async helper drives a Zustand-backed payload that a React `ConfirmDialog` component (mounted at App root) reads and renders via the existing shadcn `Dialog` primitive. The Electron `dialog:confirm` IPC handler and its preload binding are removed as dead code. The 8 existing call sites migrate to import the new helper — same `Promise<boolean>` shape.

**Tech Stack:** React 18, Zustand 4.5, shadcn-style Radix `Dialog`, `lucide-react` icons, Tailwind.

**Reference spec:** `docs/superpowers/specs/2026-04-25-confirm-dialog-design.md`

**Pre-verified:** `Button` component (`src/components/ui/button.jsx`) already exposes a `destructive` variant (line 12). No `cva` extension required.

---

## File Structure

**Created:**
- `src/lib/confirm.js` — async helper exporting `confirm(options): Promise<boolean>`, with module-level one-at-a-time concurrency gate (~40 LOC)
- `src/components/ConfirmDialog.jsx` — store-driven modal component using shadcn `Dialog`, with variant-aware icon, button color, and default focus (~80 LOC)

**Modified:**
- `src/store/appStore.js` — add `confirmDialog: null` state field + `setConfirmDialog(payload)` setter; verify NOT in `partialize`
- `src/App.jsx` — import + mount `<ConfirmDialog />` next to other dialogs
- `src/components/QueryTabBar.jsx` — migrate close-tab confirm
- `src/components/SchemaDiagram.jsx` — migrate reset-layout confirm
- `src/components/TableBrowser.jsx` — migrate 2 confirms (delete rows, drop table)
- `src/hooks/useDatabase.js` — migrate dangerous-query confirm
- `src/hooks/useDocker.js` — migrate delete-container confirm
- `src/hooks/useSnippets.js` — migrate delete-snippet confirm
- `src/hooks/useTables.js` — migrate drop-table confirm
- `electron/main.js` — remove `ipcMain.handle('dialog:confirm', ...)` block (keep `dialog` import — still used by `dialog:save-export` / `dialog:save-png`)
- `electron/preload.js` — remove `confirm` line from `dialog` namespace (keep `saveExport` / `savePng`)

---

## Task 1: Extend store with `confirmDialog` state and setter

**Files:**
- Modify: `src/store/appStore.js`

- [ ] **Step 1: Add the new state field**

Open `src/store/appStore.js`. Locate a logical spot for transient UI dialog state (e.g. near `saveSnippetDialogOpen` and `snippetPaletteOpen` from the Snippets feature). Add:

```js
  // --- Confirm dialog (transient; payload is null when closed) ---
  confirmDialog: null,
```

- [ ] **Step 2: Add the setter action**

Add the setter alongside the other dialog setters (e.g. near `setSnippetPaletteOpen`):

```js
  // --- Confirm dialog actions ---
  setConfirmDialog: (payload) => set({ confirmDialog: payload }),
```

- [ ] **Step 3: Confirm `partialize` does NOT include `confirmDialog`**

Locate the `persist` options block. The `partialize` function should still only return `{ queryTabs, activeTabId, nextTabNumber }` (and whatever it already returned). Verify `confirmDialog` is NOT added to it. The payload contains a `Promise.resolve` reference function which would be unserializable anyway — so this is critical.

If you accidentally added it, remove.

- [ ] **Step 4: Verify build**

```bash
npx vite build
```

Expected: success.

- [ ] **Step 5: Pause for manual commit**

Suggested message: `feat(confirm): add confirmDialog state and setter to appStore`

---

## Task 2: Create `src/lib/confirm.js` helper

**Files:**
- Create: `src/lib/confirm.js`

- [ ] **Step 1: Write the helper**

Create `src/lib/confirm.js` with EXACTLY this content:

```js
// src/lib/confirm.js
// Async confirm() helper that drives the React ConfirmDialog via the Zustand store.
// One-at-a-time concurrency: a second call while a dialog is open resolves false.

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
      title,
      message,
      detail,
      variant,
      confirmLabel,
      cancelLabel,
      onResolve: (result) => {
        pending = null
        useAppStore.getState().setConfirmDialog(null)
        resolve(result)
      },
    })
  })
}
```

- [ ] **Step 2: Verify build**

```bash
npx vite build
```

Expected: success. Helper has no consumers yet — Task 5+ wires the modal, Task 6 migrates call sites.

- [ ] **Step 3: Pause for manual commit**

Suggested message: `feat(confirm): add renderer-side confirm helper`

---

## Task 3: Create `ConfirmDialog` React component

**Files:**
- Create: `src/components/ConfirmDialog.jsx`

- [ ] **Step 1: Verify dialog primitives match the project**

Existing dialog components (e.g. `src/components/SaveSnippetDialog.jsx`, `src/components/NewLogicalDbDialog.jsx`) import:
- `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter` from `@/components/ui/dialog`
- `Button` from `@/components/ui/button` (verified — `destructive` variant exists at line 12)
- `cn` from `@/lib/utils`

Use the same imports for consistency.

- [ ] **Step 2: Write the component**

Create `src/components/ConfirmDialog.jsx` with this content:

```jsx
// src/components/ConfirmDialog.jsx
// Renders a modal driven by the store's confirmDialog payload.
// Variant-aware: 'destructive' shows a red trash icon and red Confirm button + focuses Cancel by default.
// 'default' shows a yellow warning icon and a default Confirm button + focuses Confirm by default.

import { useEffect, useRef } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
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

export function ConfirmDialog() {
  const dialog = useAppStore((s) => s.confirmDialog)

  const cancelRef = useRef(null)
  const confirmRef = useRef(null)

  const isDestructive = dialog?.variant === 'destructive'

  useEffect(() => {
    if (!dialog) return
    // Variant-aware default focus: destructive -> cancel; default -> confirm.
    const target = isDestructive ? cancelRef.current : confirmRef.current
    target?.focus()
  }, [dialog, isDestructive])

  if (!dialog) return null

  const { title, message, detail, confirmLabel, cancelLabel, onResolve } = dialog
  const Icon = isDestructive ? Trash2 : AlertTriangle
  const iconClass = isDestructive ? 'text-destructive' : 'text-yellow-500'
  const confirmVariant = isDestructive ? 'destructive' : 'default'

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onResolve(false)
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', iconClass)} />
            <DialogTitle>{title}</DialogTitle>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-2 pl-8 text-sm">
          {message && <p>{message}</p>}
          {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
        </div>

        <DialogFooter>
          <Button
            ref={cancelRef}
            variant="ghost"
            onClick={() => onResolve(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={confirmVariant}
            onClick={() => onResolve(true)}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Verify build**

```bash
npx vite build
```

Expected: success.

- [ ] **Step 4: Pause for manual commit**

Suggested message: `feat(confirm): add ConfirmDialog component with default/destructive variants`

---

## Task 4: Mount `ConfirmDialog` in `App.jsx`

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add the import**

Near the other component imports (e.g. next to `SaveSnippetDialog`), add:

```js
import { ConfirmDialog } from '@/components/ConfirmDialog'
```

- [ ] **Step 2: Mount the component**

In the JSX, near where other dialogs are mounted (e.g. next to `<SaveSnippetDialog />` and `<SnippetPalette />`), add:

```jsx
        <ConfirmDialog />
```

Match surrounding indentation.

- [ ] **Step 3: Verify build**

```bash
npx vite build
```

Expected: success.

- [ ] **Step 4: Smoke test (interactive — optional)**

Start the app via `npm run dev`. Open DevTools console:

```js
const { confirm } = await import('/src/lib/confirm.js')
const ok = await confirm({
  title: 'Test confirm',
  message: 'Does the modal appear with no system sound?',
  detail: 'Click Cancel or Confirm.',
})
console.log('user chose:', ok)
```

Expected: an in-app modal opens (yellow warning icon, "Cancel | Confirm" buttons), no Windows "ding". Click either button → console logs `true` or `false`.

Try `variant: 'destructive'`:
```js
const { confirm } = await import('/src/lib/confirm.js')
await confirm({
  title: 'Destructive test',
  message: 'Should appear red.',
  variant: 'destructive',
  confirmLabel: 'Delete',
})
```
Expected: red trash icon, red "Delete" button, focus on Cancel.

If interactive testing isn't available, the build verification of Step 3 is sufficient — runtime is fully exercised in Task 6 when call sites migrate.

- [ ] **Step 5: Pause for manual commit**

Suggested message: `feat(confirm): mount ConfirmDialog at App root`

---

## Task 5: Migrate the 8 call sites

**Files:**
- Modify: `src/components/QueryTabBar.jsx`
- Modify: `src/components/SchemaDiagram.jsx`
- Modify: `src/components/TableBrowser.jsx` (2 call sites)
- Modify: `src/hooks/useDatabase.js`
- Modify: `src/hooks/useDocker.js`
- Modify: `src/hooks/useSnippets.js`
- Modify: `src/hooks/useTables.js`

### Migration pattern

Each call site applies the same shape change. For each file:

1. Add `import { confirm } from '@/lib/confirm'` near the top imports
2. Replace `await window.gamalab.dialog.confirm({...})` with `await confirm({...})`
3. Add `variant` (only if `'destructive'`; omit for default) and `confirmLabel`

`cancelLabel` is never overridden — the default `'Cancel'` is correct everywhere.

### Per-call-site instructions

- [ ] **Step 1: `src/components/QueryTabBar.jsx` (line ~48 — close tab with unsaved SQL)**

Add import:
```js
import { confirm } from '@/lib/confirm'
```

Replace the existing block:
```js
const ok = await window.gamalab.dialog.confirm({
  title: `Close "${tab.title}"?`,
  message: 'You have unsaved SQL in this tab. Closing will discard it.',
  detail: 'This cannot be undone.',
})
```
With:
```js
const ok = await confirm({
  title: `Close "${tab.title}"?`,
  message: 'You have unsaved SQL in this tab. Closing will discard it.',
  detail: 'This cannot be undone.',
  confirmLabel: 'Close tab',
})
```

(No `variant` — defaults to `'default'`, which is correct: closing a tab with local content is recoverable in spirit.)

- [ ] **Step 2: `src/components/SchemaDiagram.jsx` (line ~189 — reset layout)**

Add import:
```js
import { confirm } from '@/lib/confirm'
```

Replace:
```js
const ok = await window.gamalab.dialog.confirm({
  title: 'Reset layout?',
  message: 'This will discard your manually arranged positions and re-run auto-layout.',
})
```
With:
```js
const ok = await confirm({
  title: 'Reset layout?',
  message: 'This will discard your manually arranged positions and re-run auto-layout.',
  confirmLabel: 'Reset',
})
```

- [ ] **Step 3: `src/components/TableBrowser.jsx` line ~507 (delete N rows)**

Add the import once at the top:
```js
import { confirm } from '@/lib/confirm'
```

Replace:
```js
const ok = await window.gamalab.dialog.confirm({
  title: `Delete ${selected.size} row${selected.size === 1 ? '' : 's'}?`,
  message: `Permanently delete from ${activeTable.schema}.${activeTable.name}?`,
  detail: 'This cannot be undone.',
})
```
With:
```js
const ok = await confirm({
  title: `Delete ${selected.size} row${selected.size === 1 ? '' : 's'}?`,
  message: `Permanently delete from ${activeTable.schema}.${activeTable.name}?`,
  detail: 'This cannot be undone.',
  variant: 'destructive',
  confirmLabel: 'Delete',
})
```

- [ ] **Step 4: `src/components/TableBrowser.jsx` line ~748 (drop table)**

Replace:
```js
const ok = await window.gamalab.dialog.confirm({
  title: `Drop table "${activeTable.name}"?`,
  message: `Permanently delete ${activeTable.schema}.${activeTable.name} and all its data?`,
  detail: 'This cannot be undone.',
})
```
With:
```js
const ok = await confirm({
  title: `Drop table "${activeTable.name}"?`,
  message: `Permanently delete ${activeTable.schema}.${activeTable.name} and all its data?`,
  detail: 'This cannot be undone.',
  variant: 'destructive',
  confirmLabel: 'Drop table',
})
```

- [ ] **Step 5: `src/hooks/useDatabase.js` line ~75 (dangerous query)**

Add import:
```js
import { confirm } from '@/lib/confirm'
```

Replace:
```js
const ok = await window.gamalab.dialog.confirm({
  title: 'Dangerous operation',
  message: 'This query may destroy data',
  detail: 'Contains DROP, TRUNCATE, or unconditional DELETE. Continue?',
})
```
With:
```js
const ok = await confirm({
  title: 'Dangerous operation',
  message: 'This query may destroy data',
  detail: 'Contains DROP, TRUNCATE, or unconditional DELETE. Continue?',
  variant: 'destructive',
  confirmLabel: 'Run anyway',
})
```

- [ ] **Step 6: `src/hooks/useDocker.js` line ~98 (delete container)**

Add import:
```js
import { confirm } from '@/lib/confirm'
```

Replace the existing call (the body is similar to):
```js
const confirmed = await window.gamalab.dialog.confirm({
  title: 'Delete container',
  message: 'Are you sure you want to delete this container?',
  detail: removeVolume
    ? 'The associated volume will also be removed.'
    : 'The volume will be preserved.',
})
```
With:
```js
const confirmed = await confirm({
  title: 'Delete container',
  message: 'Are you sure you want to delete this container?',
  detail: removeVolume
    ? 'The associated volume will also be removed.'
    : 'The volume will be preserved.',
  variant: 'destructive',
  confirmLabel: 'Delete',
})
```

(Local variable name `confirmed` stays unchanged — only the function source changes.)

- [ ] **Step 7: `src/hooks/useSnippets.js` line ~79 (delete snippet)**

Add import:
```js
import { confirm } from '@/lib/confirm'
```

Replace:
```js
const ok = await window.gamalab.dialog.confirm({
  title: `Delete "${snippet.name}"?`,
  message: 'This snippet will be permanently removed.',
  detail: 'This cannot be undone.',
})
```
With:
```js
const ok = await confirm({
  title: `Delete "${snippet.name}"?`,
  message: 'This snippet will be permanently removed.',
  detail: 'This cannot be undone.',
  variant: 'destructive',
  confirmLabel: 'Delete',
})
```

- [ ] **Step 8: `src/hooks/useTables.js` line ~55 (drop table from sidebar)**

Add import:
```js
import { confirm } from '@/lib/confirm'
```

Replace:
```js
const ok = await window.gamalab.dialog.confirm({
  title: `Drop table "${name}"?`,
  message: `Permanently delete ${schema}.${name} and all its data?`,
  detail: cascade
    ? 'CASCADE: dependent objects (views, FKs) will also be dropped.'
    : 'This cannot be undone.',
})
```
With:
```js
const ok = await confirm({
  title: `Drop table "${name}"?`,
  message: `Permanently delete ${schema}.${name} and all its data?`,
  detail: cascade
    ? 'CASCADE: dependent objects (views, FKs) will also be dropped.'
    : 'This cannot be undone.',
  variant: 'destructive',
  confirmLabel: 'Drop table',
})
```

- [ ] **Step 9: Verify zero residual `window.gamalab.dialog.confirm` references**

```bash
grep -rn "window.gamalab.dialog.confirm" src/
```

Expected: zero results in `src/`. Matches in `docs/` are stale references in old plans/specs — ignore them.

- [ ] **Step 10: Verify build**

```bash
npx vite build
```

Expected: success.

- [ ] **Step 11: Smoke test (interactive — recommended)**

Start the app and trigger one destructive (e.g. drop a snippet) and one default (e.g. close a tab with unsaved SQL) action. Verify:
- No system "ding"
- Variant-correct icon + button color
- Buttons say what was specified (e.g. "Drop table", not "Confirm")

- [ ] **Step 12: Pause for manual commit**

Suggested message: `refactor(confirm): migrate 8 call sites from native dialog to in-app modal`

---

## Task 6: Cleanup Electron `dialog:confirm` IPC handler and preload binding

**Files:**
- Modify: `electron/main.js`
- Modify: `electron/preload.js`

- [ ] **Step 1: Remove the IPC handler in `main.js`**

Open `electron/main.js`. Locate the block (around line 356):

```js
ipcMain.handle('dialog:confirm', async (_evt, options) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Confirm'],
    defaultId: 0,
    // ... other options ...
  })
  return result.response === 1
})
```

Delete the entire block (the full `ipcMain.handle('dialog:confirm', ...)` invocation).

- [ ] **Step 2: Verify `dialog` import is still needed**

The `dialog` import from `require('electron')` is still used by `dialog:save-export` and `dialog:save-png` handlers. To confirm:

```bash
grep -n "dialog\." electron/main.js
```

Expected: matches for `dialog.showSaveDialog` (or similar) for the file-picker handlers. Do NOT remove the import. If grep returns ZERO matches (which would mean those handlers were also removed elsewhere), THEN remove `dialog` from the destructure.

- [ ] **Step 3: Remove the preload binding**

Open `electron/preload.js`. Locate the `dialog` namespace block (around line 65):

```js
  dialog: {
    confirm: (options) => ipcRenderer.invoke('dialog:confirm', options),
    saveExport: (options) => ipcRenderer.invoke('dialog:save-export', options),
    savePng: (options) => ipcRenderer.invoke('dialog:save-png', options),
  },
```

Remove ONLY the `confirm` line:

```js
  dialog: {
    saveExport: (options) => ipcRenderer.invoke('dialog:save-export', options),
    savePng: (options) => ipcRenderer.invoke('dialog:save-png', options),
  },
```

Keep the `dialog` namespace itself and the other two methods.

- [ ] **Step 4: Verify both files parse**

```bash
node -c electron/main.js && node -c electron/preload.js
```

Expected: no output.

- [ ] **Step 5: Verify Vite still builds**

```bash
npx vite build
```

Expected: success.

- [ ] **Step 6: Verify no renderer code references the removed binding**

```bash
grep -rn "gamalab.dialog.confirm" src/ electron/
```

Expected: zero results. The binding is fully gone.

- [ ] **Step 7: Pause for manual commit**

Suggested message: `chore(confirm): remove dead dialog:confirm IPC handler and preload binding`

---

## Task 7: Final verification checklist

**Files:** none — verification only.

- [ ] **Step 1: Walk the spec's manual verification checklist end-to-end**

From `docs/superpowers/specs/2026-04-25-confirm-dialog-design.md` (Testing section), verify each:

- [ ] **No system sound** when any confirm dialog opens (the original goal — listen on Windows)
- [ ] Close tab with unsaved SQL → yellow warning icon, "Cancel | Close tab", focus on Close tab (default variant)
- [ ] Drop table from sidebar → red trash icon, "Cancel | Drop table", focus on Cancel (destructive)
- [ ] Drop table from browser toolbar → identical to sidebar
- [ ] Delete N rows from browser → red trash icon, "Cancel | Delete", focus on Cancel
- [ ] Delete snippet (sidebar trash icon) → red trash icon, "Cancel | Delete", focus on Cancel
- [ ] Delete Docker container → red trash icon, "Cancel | Delete", focus on Cancel
- [ ] Run dangerous query (e.g. `DROP TABLE foo`) → red trash icon, "Cancel | Run anyway", focus on Cancel
- [ ] Reset layout (SchemaDiagram toolbar) → yellow warning icon, "Cancel | Reset", focus on Reset
- [ ] **Esc** closes with `false` (no action taken)
- [ ] **Backdrop click** closes with `false`
- [ ] **Enter on destructive** → Cancel triggered (safer)
- [ ] **Enter on default** → Confirm triggered (faster)
- [ ] Visual: dialog matches dark/light theme tokens
- [ ] Visual: variant icon + button color clearly differentiate destructive from default
- [ ] Trigger a second confirm while one is open (e.g., two rapid keyboard shortcuts) → second silently returns `false`, no double-modal
- [ ] After full restart: `grep -rn "window.gamalab.dialog.confirm" src/ electron/` returns zero
- [ ] After full restart: trigger any confirm → works without errors in DevTools console

- [ ] **Step 2: Pause for any final polish commits**

If you made tiny tweaks during verification (spacing, copy), group them into one commit. Suggested message: `polish(confirm): verification pass`.

---

## Self-review

**Spec coverage cross-check:**

- ✅ Renderer-side `confirm()` helper with one-at-a-time gate → Task 2
- ✅ Store extension (`confirmDialog` + `setConfirmDialog`, NOT in `partialize`) → Task 1
- ✅ React `ConfirmDialog` component with variant-aware icon, button, focus → Task 3
- ✅ App.jsx mounting → Task 4
- ✅ All 8 call sites migrated with correct `variant` + `confirmLabel` → Task 5
- ✅ Cleanup of dead IPC handler + preload binding → Task 6
- ✅ Verification of zero residual `window.gamalab.dialog.confirm` references → Task 5 Step 9 + Task 6 Step 6
- ✅ `Button destructive` variant pre-verified to exist → noted in plan header
- ✅ Manual checklist (no test framework) → Task 7
- ✅ Edge cases (concurrent, Esc, backdrop, double resolve) → handled in Task 2 (helper) and Task 3 (component)

**Type / signature consistency check:**

- Helper signature `confirm({ title, message, detail, variant, confirmLabel, cancelLabel })` — used identically across all 8 call sites in Task 5
- Store action `setConfirmDialog(payload)` — defined in Task 1, called by helper in Task 2, read by component in Task 3
- `variant` values consistently `'default'` / `'destructive'` (no other values introduced)
- `Button` `variant` values (`'ghost'`, `'default'`, `'destructive'`) match the existing `cva` definitions

**Placeholder scan:** No "TBD" / "TODO" / vague "implement later" markers. Each step has either complete code or a precise instruction. The optional smoke tests (Task 4 Step 4, Task 5 Step 11) are explicitly marked optional — they help debugging but aren't gating.

**Files-touched count consistency:** Plan header lists 11 modified files + 2 new files. Tasks 1, 4, 5 (×7 files), 6 (×2 files) = 11 modified ✓. Tasks 2, 3 = 2 created ✓.
