# Connection Test in Dialog — Design

**Status:** Design approved, pending implementation
**Date:** 2026-04-25
**Author:** Matheo (via brainstorming session)

## Summary

Add a "Test connection" button to GamaLab's `ConnectRemoteDialog` (the form used to connect to remote PostgreSQL servers). The button performs a dry-run connection — opens a temporary pool, runs `SELECT version()`, closes the pool — and displays a persistent inline result banner above the footer with success info (PostgreSQL version, user, database, latency in ms) or the failure error. The user can iterate on credentials with immediate visual feedback before committing the connection via the existing "Connect" button. The test is purely additive; the "Connect" button continues to work as today.

## Goals

- Eliminate the "save → fail → re-edit → retry" loop when adding a remote DB with mistyped credentials
- Provide persistent inline feedback (not a 4s toast) so users can read both the form and the result side by side
- Surface server-side info (version, current_user, current_database) on success so users can confirm "yes I'm hitting the right server, not a similarly-named staging instance"
- Keep the dry-run isolated — no side effects on `dbService.pools`, no impact on other flows
- Match the existing dialog/UX patterns (shadcn Dialog, lab-green/destructive color tokens, lucide icons)

## Non-goals (v1)

- Adding "Test connection" to `CreateDbDialog` (Docker local — credentials auto-generated, test would be redundant)
- Adding "Test connection" to `NewLogicalDbDialog` (parent connection already established)
- Auto-test on field change (would spam servers; explicit click only)
- Disabling the Connect button until a test passes (test is a help, not a gate)
- Saving the test result with the connection record (transient UI state only)
- Server fingerprint warning (e.g. "you tested DB X but you're connecting to DB Y") — out of scope, no current cause to suspect mismatch
- Multiple sequential tests in a queue
- Persistent connection-test cache (re-test on each click)
- Showing all server columns (server time, encoding, max_connections, etc.) — minimal info per Q3 = B

## Architecture

### Backend service method

The current `connect(config)` builds the SSL option inline (lines ~36–47 of `db.service.js`). To avoid duplicating those 12 lines in the new `testConnection`, extract the SSL builder into a private helper first, then both methods share it.

**Step A: extract `_buildSslConfig(sslMode)`** — small private method returning the `ssl` option value:

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

Replace the inline ssl-building block in `connect(config)` with `const sslConfig = this._buildSslConfig(config.sslMode)`. No behavior change — pure refactor that DRYs the logic.

**Step B: add `testConnection(config)`** (~30 LOC):

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
      version: rows[0].version.split(' on ')[0],  // "PostgreSQL 16.2"
      user: rows[0].user,
      database: rows[0].database,
      latencyMs: Date.now() - start,
    }
  } catch (err) {
    return { ok: false, error: err.message, latencyMs: Date.now() - start }
  } finally {
    await pool.end().catch(() => {})  // always release; suppress double-close errors
  }
}
```

**Key contract: never throws on connection failure.** Returns `{ ok: false, error }` instead. This simplifies the renderer — single result-shape branch, no try/catch noise.

**No state retention:** the temporary pool is created locally and `pool.end()` runs in `finally`. `dbService.pools` Map is never touched. Repeat tests don't accumulate state.

### IPC handler

`electron/main.js`, in the existing Database section:

```js
ipcMain.handle('db:test', async (_evt, config) => {
  return await dbService.testConnection(config)
})
```

### Preload binding

`electron/preload.js`, in the existing `db:` namespace next to `connect`/`disconnect`/`ping`:

```js
test: (config) => ipcRenderer.invoke('db:test', config),
```

### Renderer integration

The whole feature lives inside `src/components/ConnectRemoteDialog.jsx` — no new components, no store changes (test result is local component state, transient).

## Renderer-side state

Add to the existing `ConnectRemoteDialog` component:

```js
const [testing, setTesting] = useState(false)
const [testResult, setTestResult] = useState(null)
// testResult shapes:
//   null
//   { ok: true,  version, user, database, latencyMs }
//   { ok: false, error,   latencyMs }
```

`testing` mirrors the existing `submitting` flag pattern in this component.

## `handleTest` callback

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

Validation logic mirrors the existing `handleSubmit` (host required, port range). Both validators short-circuit identically.

## Smart invalidation (Q4c = iii)

Add a `useEffect` that clears the result when any "test-relevant" field changes:

```js
useEffect(() => {
  setTestResult(null)
}, [host, port, user, password, database, sslMode])
```

**Excluded from deps**: `name` (display-only label), `connStr` (input field for the optional parser — Parse re-fills the test-relevant fields, which then triggers the effect transitively).

## Reset on dialog open/close

The component already has a `useEffect` that watches `connectRemoteDialogOpen` and resets all form fields. Extend it:

```js
useEffect(() => {
  if (!connectRemoteDialogOpen) return
  // ... existing field resets ...
  setTestResult(null)
  setTesting(false)
}, [connectRemoteDialogOpen])
```

## UI changes

### Footer button (Q4a = i)

Insert a new "Test connection" button between Cancel and Connect:

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

The `Cable` icon is already imported in this file (used in the dialog title — re-use is free).

The Cancel and Connect buttons get `testing` added to their `disabled` props for mutual exclusion.

### Result banner (Q4b = i)

Render between the form fields (the existing `<div className="flex flex-col gap-3">` block) and `<DialogFooter>`:

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

**Imports to add to ConnectRemoteDialog.jsx**:
- `CheckCircle2`, `XCircle` from `lucide-react` (already used by other components like HistoryList — pattern consistent)
- `cn` from `@/lib/utils` (verify if not already imported)

### Block close during test

Update the existing `onOpenChange` guard to also block closure during a test:

```jsx
<Dialog
  open={connectRemoteDialogOpen}
  onOpenChange={(o) => !submitting && !testing && setConnectRemoteDialogOpen(o)}
>
```

## Edge cases

- **Empty host on Test click** — toast `'Host is required'`, no IPC call
- **Invalid port on Test click** — toast `'Port must be between 1 and 65535'`, no IPC call
- **Test in flight + Connect clicked** — Connect button disabled (`testing || submitting`)
- **Connect in flight + Test clicked** — Test button disabled (`submitting || testing`)
- **Long Postgres error message** (multi-line) — banner uses `whitespace-pre-wrap break-words` to avoid overflow
- **Connection timeout (10s)** — pool's `connectionTimeoutMillis: 10000`, `pool.end()` in `finally` cleans up, `{ ok: false, error: 'Connection timeout' }` (or whatever pg returns) shown in banner
- **User edits a critical field after test** — `useEffect([host, port, ...])` clears `testResult` immediately
- **User edits `name`** — banner stays (intentional — name is display-only)
- **User pastes into connection string + clicks Parse** — Parse fills critical fields → effect fires → banner clears (correct: connStr might describe a different server)
- **Reopen dialog** — `useEffect([connectRemoteDialogOpen])` resets all state including `testResult` and `testing`
- **Test succeeds but user clicks Cancel** — no side effect; the temporary pool was already ended in `finally`. Nothing in `dbService.pools` to clean.
- **Test ✅ then Connect** — normal flow; Connect re-establishes the connection (the test pool is gone). User pays the cost twice but that's correct semantics (the test is a dry-run, not the real connection).
- **Test ❌ then Connect** — user is allowed to try Connect anyway (test is not a gate); they'll likely see the same error via the existing toast path.
- **Backdrop click / Esc during test or submit** — `onOpenChange` guard ignores both states.

## Testing

No test framework in the project — manual verification (will be replicated in the implementation plan):

- [ ] Test button appears in footer between Cancel and Connect
- [ ] Test with empty host → toast `'Host is required'`, button stays enabled (since host changed back to non-empty unblocks it)
- [ ] Test with valid creds + reachable server → spinner "Testing…" → green banner with `Connected in Xms` + `PostgreSQL X.Y · user "..." · database "..."`
- [ ] Test with bad password → red banner `Connection failed` + Postgres error message (multi-line preserved)
- [ ] Test with unreachable host → red banner with timeout / DNS error
- [ ] Test with bad port → red banner with `ECONNREFUSED` or similar
- [ ] Test with bad SSL config → red banner with SSL error
- [ ] Edit host/port/user/password/database/sslMode after a test → banner disappears immediately
- [ ] Edit `name` after a test → banner stays
- [ ] Click Parse on a connection string → fields update → banner disappears (because critical fields changed)
- [ ] Click Connect after green banner → normal flow, dialog closes
- [ ] Click Connect after red banner → normal flow attempted, error toast appears (existing path)
- [ ] Reopen dialog (close + open) → banner cleared, testing=false, all fields reset (existing behavior preserved)
- [ ] Esc pressed during test → ignored
- [ ] Backdrop click during test → ignored
- [ ] Two rapid Test clicks → button disabled while first runs (visual proof: no double request in DevTools Network)
- [ ] Verify nothing leaks: after 5+ tests, `dbService.pools` Map size is unchanged (smoke check via DevTools console: `await window.__store?.getState?.().connections`)

## Files touched (summary)

**Modified:**
- `electron/services/db.service.js` — extract `_buildSslConfig(sslMode)` helper (refactor of existing `connect()` body, no behavior change), then add `testConnection(config)` method (~40 LOC total)
- `electron/main.js` — add `ipcMain.handle('db:test', ...)` (~3 LOC)
- `electron/preload.js` — add `test: (config) => ipcRenderer.invoke('db:test', config)` to the `db` namespace (1 line)
- `src/components/ConnectRemoteDialog.jsx` — add state + handler + smart invalidation effect + footer button + result banner; extend reset effect (~50 LOC of additions)

**Created:** none.

## Out of scope / future work

- "Test connection" in other dialogs (`CreateDbDialog`, `NewLogicalDbDialog`)
- Auto-test on field blur or debounced change
- Server fingerprint mismatch detection ("you tested X, you're connecting to Y")
- Caching test results across dialog reopens
- Custom timeout (currently fixed 10s — same as `connect()`)
- "Last tested" timestamp in connection list
- Test triggered from a saved connection's context menu (right-click → Test)
- Connection pooling stats (e.g. "tested at 14:32, server reports max_connections=100")
