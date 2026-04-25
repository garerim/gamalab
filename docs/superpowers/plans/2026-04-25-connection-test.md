# Connection Test in Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Git convention for this project:** The user handles all `git commit` and `git push` operations manually. Each commit step is a pause point with a suggested message — do NOT run `git commit` yourself. Wait for the user to commit (or explicitly ask them to) before proceeding to the next task.

**Goal:** Add a "Test connection" button to GamaLab's `ConnectRemoteDialog` that performs a dry-run PostgreSQL connection and displays a persistent inline result banner with version, user, database, and latency on success — or the error message on failure — without committing the connection.

**Architecture:** Add a stateless `testConnection(config)` method to `db.service.js` that opens a temporary `Pool`, runs `SELECT version()`, and closes the pool — never touching `dbService.pools`. Expose via a new `db:test` IPC handler and `window.gamalab.db.test()` preload binding. Update `ConnectRemoteDialog` to add a Test button in the footer, a result banner above it, and a smart-invalidation `useEffect` that clears the banner when test-relevant fields change.

**Tech Stack:** React 18, Electron IPC, `pg` Pool, shadcn `Dialog`/`Button`, `lucide-react` icons.

**Reference spec:** `docs/superpowers/specs/2026-04-25-connection-test-design.md`

---

## File Structure

**Modified:**
- `electron/services/db.service.js` — extract `_buildSslConfig(sslMode)` private helper (refactor of existing `connect()` ssl block), then add `testConnection(config)` method (~40 LOC total)
- `electron/main.js` — add `ipcMain.handle('db:test', ...)` (~3 LOC) in the existing Database section
- `electron/preload.js` — add `test: (config) => ipcRenderer.invoke('db:test', config)` (1 line) in the `db` namespace
- `src/components/ConnectRemoteDialog.jsx` — add `testing` + `testResult` state, `handleTest` callback, smart-invalidation `useEffect`, extend reset effect, footer button, result banner (~50 LOC additions)

**Created:** none.

---

## Task 1: Extract `_buildSslConfig` helper in `db.service.js` (pure refactor)

**Files:**
- Modify: `electron/services/db.service.js`

This is a no-behavior-change refactor that DRYs the SSL-config logic before Task 2 reuses it.

- [ ] **Step 1: Add the helper method**

Open `electron/services/db.service.js`. Find a good place for a private method (typically after the constructor or after `_connectionId`, before `connect`). Add:

```js
  _buildSslConfig(sslMode) {
    const mode = sslMode || 'disable'
    if (mode === 'require') return { rejectUnauthorized: false }
    if (mode === 'verify-full') return { rejectUnauthorized: true }
    // pg lib falls back to non-SSL if SSL fails
    if (mode === 'prefer') return { rejectUnauthorized: false }
    return false
  }
```

- [ ] **Step 2: Replace the inline ssl block in `connect()`**

In `connect(config)` (around lines 36-47), the current ssl block looks like:

```js
    const sslMode = config.sslMode || 'disable'
    let sslConfig
    if (sslMode === 'require') {
      sslConfig = { rejectUnauthorized: false }
    } else if (sslMode === 'verify-full') {
      sslConfig = { rejectUnauthorized: true }
    } else if (sslMode === 'prefer') {
      // pg lib falls back to non-SSL if SSL fails
      sslConfig = { rejectUnauthorized: false }
    } else {
      sslConfig = false
    }
```

Replace those 12 lines with a single line:

```js
    const sslConfig = this._buildSslConfig(config.sslMode)
```

The rest of `connect()` stays unchanged — `sslConfig` is still used the same way at the `ssl: sslConfig` line.

- [ ] **Step 3: Verify both files parse**

```bash
node -c electron/services/db.service.js
```

Expected: no output. If errors, fix and re-run.

- [ ] **Step 4: Build verification**

```bash
npx vite build
```

Expected: success (Vite doesn't lint Electron main, but a green build means nothing else broke).

- [ ] **Step 5: Smoke test (optional, interactive)**

If you can run `npm run dev`, briefly verify that connecting to an existing remote DB still works end-to-end (no SSL regression).

- [ ] **Step 6: Pause for manual commit**

Suggested message: `refactor(db): extract _buildSslConfig helper from connect`

---

## Task 2: Add `testConnection(config)` method to `db.service.js`

**Files:**
- Modify: `electron/services/db.service.js`

- [ ] **Step 1: Add the method**

Add `testConnection(config)` as a new async method on the same class. Place it logically near `connect`/`disconnect`/`ping` (e.g. right after `ping`):

```js
  async testConnection(config) {
    const start = Date.now()
    // Same shape as connect(), but never stored in this.pools.
    const pool = new Pool({
      host: config.host,
      port: Number(config.port),
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: this._buildSslConfig(config.sslMode),
      connectionTimeoutMillis: 10000,
      max: 1,
      idleTimeoutMillis: 1,
    })
    try {
      const { rows } = await pool.query(
        'SELECT version() AS version, current_user AS "user", current_database() AS database'
      )
      return {
        ok: true,
        version: rows[0].version.split(' on ')[0],
        user: rows[0].user,
        database: rows[0].database,
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      return { ok: false, error: err.message, latencyMs: Date.now() - start }
    } finally {
      await pool.end().catch(() => {})
    }
  }
```

Key contract: **never throws** on connection failure — always returns the result object. The renderer trusts this.

- [ ] **Step 2: Verify parse**

```bash
node -c electron/services/db.service.js
```

Expected: no output.

- [ ] **Step 3: Build verification**

```bash
npx vite build
```

Expected: success.

- [ ] **Step 4: Pause for manual commit**

Suggested message: `feat(db): add testConnection dry-run method`

---

## Task 3: Wire IPC handler + preload binding

**Files:**
- Modify: `electron/main.js`
- Modify: `electron/preload.js`

- [ ] **Step 1: Add the IPC handler in main.js**

Open `electron/main.js`. Locate the Database section (look for `// ============ IPC: Database ============` near `db:connect`, `db:ping`, etc., around line 208). Add the new handler near the others (e.g. immediately after the existing `db:ping` handler):

```js
ipcMain.handle('db:test', async (_evt, config) => {
  return await dbService.testConnection(config)
})
```

Match the existing style of surrounding handlers (no semicolons, async/await, 2-space indent).

- [ ] **Step 2: Add the preload binding**

Open `electron/preload.js`. Locate the `db:` namespace block (around line 16-30). Add a new line for `test`, alongside `connect` / `disconnect` / `ping`:

```js
    test: (config) => ipcRenderer.invoke('db:test', config),
```

A natural placement is right after `ping` (since both are read-only diagnostics) or right after `connect` (since it's the dry-run sibling). Either works.

- [ ] **Step 3: Verify both files parse**

```bash
node -c electron/main.js && node -c electron/preload.js
```

Expected: no output.

- [ ] **Step 4: Build verification**

```bash
npx vite build
```

Expected: success.

- [ ] **Step 5: Smoke test via DevTools (optional)**

If you can run `npm run dev`, open DevTools console:

```js
await window.gamalab.db.test({
  host: '127.0.0.1', port: 5432, user: 'postgres',
  password: 'wrong', database: 'postgres', sslMode: 'disable'
})
// → { ok: false, error: 'password authentication failed for user "postgres"', latencyMs: ... }
```

Try with valid creds for a server you have running:
```js
await window.gamalab.db.test({
  host: '127.0.0.1', port: 5432, user: 'postgres',
  password: 'YOUR_PASSWORD', database: 'postgres', sslMode: 'disable'
})
// → { ok: true, version: 'PostgreSQL 16.x', user: 'postgres', database: 'postgres', latencyMs: ... }
```

If interactive testing isn't available, the build verification of Step 4 is sufficient.

- [ ] **Step 6: Pause for manual commit**

Suggested message: `feat(db): wire db:test IPC handler and preload binding`

---

## Task 4: Update `ConnectRemoteDialog.jsx` (state + handler + UI)

**Files:**
- Modify: `src/components/ConnectRemoteDialog.jsx`

This is the bulk of the renderer-side work. All edits land in one file.

- [ ] **Step 1: Add icon imports**

Open `src/components/ConnectRemoteDialog.jsx`. The current lucide import (line 2) is:

```js
import { Loader2, Plug, Eye, EyeOff, Cable } from 'lucide-react'
```

Replace with:

```js
import { Loader2, Plug, Eye, EyeOff, Cable, CheckCircle2, XCircle } from 'lucide-react'
```

- [ ] **Step 2: Verify `cn` import**

Check the imports for `import { cn } from '@/lib/utils'`. If absent, add it after the lucide import:

```js
import { cn } from '@/lib/utils'
```

- [ ] **Step 3: Add state for testing + result**

Inside the component body (next to the existing `const [submitting, setSubmitting] = useState(false)` and similar states), add:

```js
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
```

- [ ] **Step 4: Extend the reset effect**

The component has a `useEffect(() => { ... }, [connectRemoteDialogOpen])` that resets fields when the dialog closes. Inside that effect's body (next to the other `setX('')` calls), add:

```js
      setTestResult(null)
      setTesting(false)
```

- [ ] **Step 5: Add smart-invalidation effect**

Add a NEW `useEffect` that clears the test result whenever a "test-relevant" field changes. Place it after the existing reset effect:

```js
  // Clear test banner when test-relevant fields change.
  // `name` and `connStr` are intentionally excluded — name is display-only,
  // connStr's parser re-fills the relevant fields below (transitively triggering this effect).
  useEffect(() => {
    setTestResult(null)
  }, [host, port, user, password, database, sslMode])
```

- [ ] **Step 6: Add the `handleTest` callback**

Place it after the existing `tryParseConnStr` and before `handleSubmit`:

```js
  const handleTest = async () => {
    if (!host.trim()) {
      showToast('Host is required', 'warning')
      return
    }
    const portNum = Number(port)
    if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
      showToast('Port must be between 1 and 65535', 'warning')
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.gamalab.db.test({
        host: host.trim(),
        port: portNum,
        user: user.trim() || 'postgres',
        password,
        database: database.trim() || 'postgres',
        sslMode,
      })
      setTestResult(result)
    } catch (err) {
      // Defensive — backend is contracted not to throw, but guard anyway
      setTestResult({ ok: false, error: err.message })
    } finally {
      setTesting(false)
    }
  }
```

- [ ] **Step 7: Block dialog closure during test**

Find the `<Dialog open={connectRemoteDialogOpen} onOpenChange={...}>` line. The current `onOpenChange` is:

```jsx
      onOpenChange={(o) => !submitting && setConnectRemoteDialogOpen(o)}
```

Change to also block during testing:

```jsx
      onOpenChange={(o) => !submitting && !testing && setConnectRemoteDialogOpen(o)}
```

- [ ] **Step 8: Add the result banner**

Locate the closing `</div>` of the form fields container (the `<div className="flex flex-col gap-3">` wrapping all the fields). The closing `</div>` for that container sits right before `<DialogFooter>`. Insert the banner BETWEEN the form's closing `</div>` and `<DialogFooter>`:

```jsx
        {testResult && (
          <div
            className={cn(
              'flex flex-col gap-1 rounded-md border p-3 text-sm',
              testResult.ok
                ? 'border-lab-green/30 bg-lab-green/10'
                : 'border-destructive/30 bg-destructive/10'
            )}
          >
            <div className="flex items-center gap-2 font-medium">
              {testResult.ok ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-lab-green" />
                  Connected in {testResult.latencyMs} ms
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 text-destructive" />
                  Connection failed
                </>
              )}
            </div>
            {testResult.ok ? (
              <div className="text-xs text-muted-foreground">
                {testResult.version} · user "{testResult.user}" · database "{testResult.database}"
              </div>
            ) : (
              <div className="whitespace-pre-wrap break-words text-xs text-destructive">
                {testResult.error}
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 9: Add the Test button + update Cancel/Connect disabled props**

Locate `<DialogFooter>`. The current Cancel + Connect buttons need updating, and a new Test button goes between them.

Current footer:
```jsx
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setConnectRemoteDialogOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button variant="lab" onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Connecting…
              </>
            ) : (
              <>
                <Plug className="h-4 w-4" />
                Connect
              </>
            )}
          </Button>
        </DialogFooter>
```

Replace with:

```jsx
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setConnectRemoteDialogOpen(false)}
            disabled={submitting || testing}
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={submitting || testing || !host.trim()}
          >
            {testing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Testing…
              </>
            ) : (
              <>
                <Cable className="h-4 w-4" />
                Test connection
              </>
            )}
          </Button>
          <Button
            variant="lab"
            onClick={handleSubmit}
            disabled={submitting || testing}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Connecting…
              </>
            ) : (
              <>
                <Plug className="h-4 w-4" />
                Connect
              </>
            )}
          </Button>
        </DialogFooter>
```

Three changes vs the original:
- Cancel: added `|| testing` to `disabled`
- New Test button between Cancel and Connect
- Connect: added `|| testing` to `disabled`

- [ ] **Step 10: Build verification**

```bash
npx vite build
```

Expected: success.

- [ ] **Step 11: Smoke test (interactive — recommended)**

Start the app via `npm run dev`. Open the "Connect to existing Postgres" dialog. Verify:
- Test button visible in footer between Cancel and Connect, with `Cable` icon and label "Test connection"
- Click Test with empty host → toast `'Host is required'`
- Fill in any credentials (real or fake) → click Test → spinner "Testing…" → banner appears (green if ok, red if fail)
- Edit `host` → banner disappears
- Edit `name` → banner stays

- [ ] **Step 12: Pause for manual commit**

Suggested message: `feat(connect-remote): add Test connection button with inline result banner`

---

## Task 5: Final verification checklist

**Files:** none — verification only.

- [ ] **Step 1: Walk the spec's manual verification checklist end-to-end**

From `docs/superpowers/specs/2026-04-25-connection-test-design.md` (Testing section):

- [ ] Test button appears in footer between Cancel and Connect
- [ ] Test with empty host → toast `'Host is required'`, no IPC call
- [ ] Test with valid creds + reachable server → spinner "Testing…" → green banner with `Connected in Xms` + `PostgreSQL X.Y · user "..." · database "..."`
- [ ] Test with bad password → red banner `Connection failed` + Postgres error message (multi-line preserved via `whitespace-pre-wrap`)
- [ ] Test with unreachable host → red banner with timeout / DNS error
- [ ] Test with bad port (e.g. `5500` if no server there) → red banner with `ECONNREFUSED`
- [ ] Test with bad SSL config → red banner with SSL error
- [ ] Edit `host` after a test → banner disappears
- [ ] Edit `port` after a test → banner disappears
- [ ] Edit `user` after a test → banner disappears
- [ ] Edit `password` after a test → banner disappears
- [ ] Edit `database` after a test → banner disappears
- [ ] Edit `sslMode` after a test → banner disappears
- [ ] Edit `name` (display) after a test → banner stays
- [ ] Edit connection string + click Parse → fields update → banner disappears (transitively)
- [ ] Click Connect after a green banner → normal flow, dialog closes, connection saved
- [ ] Click Connect after a red banner → existing flow attempted, error toast appears (test was advisory, not a gate)
- [ ] Reopen dialog (close + open) → banner cleared, testing=false, all fields reset (existing reset behavior preserved)
- [ ] Esc pressed during test → ignored (dialog stays open)
- [ ] Backdrop click during test → ignored
- [ ] Two rapid Test clicks → button disabled while first runs
- [ ] After 5+ tests in a row, no leak: no extra entries in `dbService.pools` (visible via DevTools if you expose `useAppStore.getState().connections` or via Network panel — no zombie connections)

- [ ] **Step 2: Pause for any final polish commits**

If you made tiny tweaks during verification (spacing, copy), group them into one commit. Suggested message: `polish(connect-remote): verification pass`.

---

## Self-review

**Spec coverage cross-check:**

- ✅ `testConnection(config)` method (dry-run, no state retention) → Task 2
- ✅ `_buildSslConfig` helper extraction → Task 1
- ✅ IPC handler `db:test` → Task 3
- ✅ Preload binding `window.gamalab.db.test` → Task 3
- ✅ State `testing` + `testResult` → Task 4 Step 3
- ✅ Reset on dialog open/close → Task 4 Step 4
- ✅ Smart-invalidation effect on test-relevant fields → Task 4 Step 5
- ✅ `handleTest` callback with validation + IPC call → Task 4 Step 6
- ✅ Block close during test → Task 4 Step 7
- ✅ Result banner above footer → Task 4 Step 8
- ✅ Footer button between Cancel and Connect, with `testing` mutual exclusion on Cancel/Connect → Task 4 Step 9
- ✅ Final verification → Task 5

**Type / signature consistency check:**

- `testConnection(config) → { ok, version, user, database, latencyMs }` or `{ ok: false, error, latencyMs }` — defined in Task 2, consumed identically in Task 4 Step 6 (handler) and Task 4 Step 8 (banner)
- `_buildSslConfig(sslMode) → object | false` — extracted in Task 1, used by both `connect` (Task 1 Step 2) and `testConnection` (Task 2 Step 1)
- `window.gamalab.db.test(config)` — preload signature matches the renderer call in Task 4 Step 6
- `testResult` shape (3 forms: null / success / failure) — matched in conditional render of Task 4 Step 8

**Placeholder scan:** No "TBD" / "TODO" markers. Each step has either complete code or a precise instruction. The optional smoke tests (Task 1 Step 5, Task 3 Step 5, Task 4 Step 11) are explicitly marked optional — they help debugging but aren't gating.

**Refactor safety:** Task 1 is pure refactor (Step 2 explicitly preserves behavior — same `sslConfig` value gets used in same place). Task 2 only adds a new method. Tasks 3-4 are additive. No regression risk on existing connect flow.
