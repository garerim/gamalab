# AI SQL Assistant (BYOK) — Design

**Status:** Design approved, pending implementation
**Date:** 2026-05-22
**Author:** Matheo (via brainstorming session)

## Summary

Add a Bring-Your-Own-Key (BYOK) AI SQL assistant to GamaLab. Users paste their own Anthropic and/or OpenAI API key in a new Settings dialog, then trigger an inline AI bar (`Ctrl+I` or ✨ button in QueryEditor toolbar) above Monaco to describe what SQL they want in natural language. The generated SQL streams into the active query tab (or a new tab on demand). The full database schema is automatically sent as context, with Anthropic prompt caching to keep cost negligible on repeat usage. The assistant is intentionally single-shot (NL → SQL) for v1 — no chat history, no inline edit-on-selection, no backend / no subscription.

## Goals

- Ship the AI SQL feature standalone (Phase 1 of a larger AI platform, per the earlier decomposition discussion) — validates the feature before investing in marketing site, auth, billing
- Honest BYOK : user pays their own provider, no proxy, no quota
- Support both Anthropic and OpenAI so user friction (account creation) is minimized
- Streaming UX comparable to Cursor / Copilot Chat / Raycast AI — feels modern, not jank
- Maximum reuse of existing GamaLab infrastructure: `credentialStore.service.js` (OS keyring), `listSchemaInfo` IPC (schema fetch), shadcn `Dialog` primitive, store/persist patterns
- Keep cost transparent : after each generation, display token usage + USD cost estimate

## Non-goals (v1)

- Backend / proxy AI service (Phase 3 of the larger plan — needs auth + billing first)
- Marketing site / sign up / Stripe (Phase 2)
- Multi-turn chat panel (deferred to v1.1; spec choice Q1 = A single-shot)
- Inline edit-on-selection à la Cursor `Ctrl+K` (deferred to v1.1; Q1 = A)
- Ollama / self-hosted backend (decided against in earlier brainstorm for economic + quality reasons)
- Providers beyond Claude and OpenAI (Mistral, Gemini, etc.) — v2 candidates
- Model picker per-query with exact model names (tier-based Fast/Smart for clarity; Q8 = E)
- Persistent prompt history (in-memory only, ring buffer 20; Q10d = i)
- Persistent AI session log / "AI History" sidebar tab — YAGNI v1
- Token-level streaming view in a separate panel — SQL streams directly into Monaco
- Server-side schema embedding / RAG — full schema sent as plaintext context
- Auto-run the generated SQL — user reviews and clicks Run themselves
- Type-aware validation of the generated SQL before insertion
- Support for connection strings with multiple databases (works on `activeConnection.id`'s default DB)

## Architecture

### Three layers

1. **Backend AI service** (`electron/services/ai.service.js`) — encapsulates the Anthropic and OpenAI SDKs, runs API calls in the main process, streams chunks to the renderer via IPC events
2. **Persistent storage** — API keys encrypted via existing `credentialStore.service.js` (OS keyring: DPAPI / Keychain / libsecret), stored as base64 strings under JSON keys `ai.claude.key` and `ai.openai.key` in the existing `window.gamalab.store` mechanism. Default provider/tier preferences also persisted under `ai.defaultProvider` and `ai.defaultTier`.
3. **Renderer UI** — new `SettingsDialog` (extensible tabbed modal), new `AiBar` component (inline above Monaco), new `useAiKeybindings` hook for `Ctrl+I`, store extensions in `appStore.js`.

### Data flow — generation

```
1. User opens AI bar (Ctrl+I or ✨ toolbar button)
2. User types prompt, presses Enter (or clicks Generate)
3. Renderer captures `targetTabId` (active tab id, or freshly created tab if "New tab" clicked)
4. Renderer clears the target tab content, sets `aiGenerating: true`
5. Renderer calls IPC `ai:generate` with { prompt, provider, tier, schemaInfo }
6. Main process:
   a. Loads encrypted key for the provider from store
   b. Decrypts via credentialStore.decrypt()
   c. Initializes the SDK (Anthropic or OpenAI)
   d. Constructs system prompt + schema (compact DDL-like format)
   e. For Claude: marks the schema block with cache_control: { type: 'ephemeral' }
   f. Calls SDK streaming API with an AbortController signal
   g. For each chunk, sends webContents.send('ai:chunk', { text, accumulated })
   h. On completion: webContents.send('ai:done', { fullText, usage, costUsd })
   i. On error: webContents.send('ai:error', { message })
7. Renderer:
   a. Listens 'ai:chunk' → accumulates → schedules a RAF flush → writes the
      accumulated text to the target tab via updateTabContent
   b. Listens 'ai:done' → final flush, sets lastResult (tokens, cost), clears aiGenerating
   c. Listens 'ai:error' → toast friendly error, clears aiGenerating
   d. If user clicks Stop: IPC ai:abort → main calls AbortController.abort()
```

### Provider abstraction

The AI service exposes a single `generate({ prompt, provider, tier, schemaInfo, onChunk, onDone, onError })` method. Internally dispatches to `_generateClaude` or `_generateOpenAI` based on `provider`. Both implementations share:
- The same compact schema serializer (DDL-like text format, ~3-5× more token-efficient than JSON)
- The same system prompt (instructs the model to output ONLY SQL, no markdown, no commentary)
- The same error mapping via `_friendlyError` (401 → "Invalid API key", 429 → "Rate limit", 503 → "Overloaded", else verbatim)

### Model mapping (tier-based)

| Provider | Fast | Smart |
|---|---|---|
| Claude | `claude-haiku-4-5` | `claude-sonnet-4-5` |
| OpenAI | `gpt-4o-mini` | `gpt-4o` |

Hard-coded in the AI service. User-selectable exact model names are deferred to v1.1 (extending Settings → AI → Advanced).

**Implementation note:** the exact model identifier strings (`claude-haiku-4-5`, etc.) must match the active values published in the installed SDK's documentation at implementation time. The names above are accurate as of 2026-05; if Anthropic / OpenAI publish a different identifier format (e.g. dated suffixes like `claude-haiku-4-5-20260201`), use the form returned by `client.models.list()` or referenced in the SDK's TypeScript types. The implementer must verify before locking these into the `MODEL_MAP` constant.

### Schema strategy (Q6 = E)

- **Claude (both tiers)**: full schema sent every time, with `cache_control: { type: 'ephemeral' }` on the schema block. First call pays the full input cost; subsequent calls within 5 minutes pay ~10% of input cost for cached tokens (Anthropic's published cache discount).
- **OpenAI**: no native prompt caching → truncate schema to first 50 tables alphabetically (by `schema.name`). Documented limitation; users with large schemas should use Claude.

### Prompt format

System prompt (constant):

> You are a PostgreSQL SQL expert assistant inside GamaLab, a database GUI. The user describes what they want; you respond with ONLY the SQL statement(s) — no markdown fences, no explanations, no comments unless the user explicitly asks for them. Use the provided database schema as the source of truth for table and column names. Prefer readable, well-formatted SQL with appropriate whitespace. If the user's request is ambiguous, make a reasonable choice and produce working SQL — they can edit it.

User message:

```
{user's natural language prompt}
```

Schema (separate system block for Claude with cache, prepended in OpenAI's single system message):

```
Database schema:
public.users (id integer, email text, created_at timestamptz, ...)
public.orders (id integer, user_id integer, total numeric, ...)
public.order_items (id integer, order_id integer, product_id integer, ...)
...
```

### Pricing table (for cost display)

Per 1M tokens, in USD (as of 2026-05; published rates):

| Model | Input | Output | Cached input |
|---|---|---|---|
| `claude-haiku-4-5` | $1.00 | $5.00 | $0.10 |
| `claude-sonnet-4-5` | $3.00 | $15.00 | $0.30 |
| `gpt-4o-mini` | $0.15 | $0.60 | — |
| `gpt-4o` | $2.50 | $10.00 | — |

Cost displayed in the AI bar after each generation: `1234 tokens (520 cached) · $0.0008`.

**Implementation note:** pricing changes occasionally. The implementer should verify current rates at the provider's pricing page when implementing. If a discrepancy is found, update the `PRICING` constant in `ai.service.js`. The cost shown is an estimate — minor drift is acceptable.

### Store extensions (`src/store/appStore.js`)

```js
// Persisted via window.gamalab.store (not Zustand persist) — hydrated on initialize()
aiSettings: {
  defaultProvider: 'claude',     // 'claude' | 'openai'
  defaultTier: 'fast',           // 'fast' | 'smart'
  hasClaudeKey: false,           // mirrors store, updated after save/delete
  hasOpenAIKey: false,
},

// Transient (not persisted)
aiBarOpen: false,
aiCurrentPrompt: '',
aiGenerating: false,
aiLastResult: null,              // { tokensIn, cachedTokens, tokensOut, costUsd } | null
aiPromptHistory: [],             // ring buffer max 20, in-memory only

settingsDialogOpen: false,
settingsActiveTab: 'general',    // 'general' | 'ai'

// Actions
setAiSettings: (patch) => set((s) => ({ aiSettings: { ...s.aiSettings, ...patch } })),
setAiBarOpen: (open) => set({ aiBarOpen: open }),
setAiCurrentPrompt: (p) => set({ aiCurrentPrompt: p }),
setAiGenerating: (g) => set({ aiGenerating: g }),
setAiLastResult: (r) => set({ aiLastResult: r }),
pushAiPromptHistory: (p) => set((s) => {
  const filtered = s.aiPromptHistory.filter((x) => x !== p)
  return { aiPromptHistory: [p, ...filtered].slice(0, 20) }
}),
setSettingsDialogOpen: (open) => set({ settingsDialogOpen: open }),
setSettingsActiveTab: (tab) => set({ settingsActiveTab: tab }),
```

None of these go in the `persist` middleware's `partialize`. The `aiSettings` is hydrated in `initialize()` from `window.gamalab.store` (existing IPC).

## Backend service

`electron/services/ai.service.js` (~250 LOC). Key responsibilities:

- Load and decrypt the API key via `credentialStore.decrypt`
- Build provider-specific request (Claude with schema cache block, OpenAI with single system message)
- Stream chunks back via callbacks (provided by the IPC handler as `onChunk` / `onDone` / `onError`)
- Use a single `AbortController` instance per call; expose `abort()`
- Compute cost from the `usage` field returned by both SDKs

Full skeleton in design Section 2 of the brainstorm transcript; condensed here:

```js
class AiService {
  constructor() {
    this.currentAbortController = null
  }

  async generate({ prompt, provider, tier, schemaInfo, onChunk, onDone, onError }) {
    const model = MODEL_MAP[provider]?.[tier]
    if (!model) return onError({ message: `Unknown ${provider}/${tier}` })

    const apiKey = await this._loadKey(provider)
    if (!apiKey) return onError({ message: `No ${provider} API key configured.` })

    this.currentAbortController = new AbortController()
    try {
      if (provider === 'claude') {
        await this._generateClaude({ apiKey, model, prompt, schemaInfo, onChunk, onDone, onError })
      } else {
        await this._generateOpenAI({ apiKey, model, prompt, schemaInfo, onChunk, onDone, onError })
      }
    } finally {
      this.currentAbortController = null
    }
  }

  abort() {
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }
  }

  // _generateClaude — uses Anthropic SDK with cache_control on schema block
  // _generateOpenAI — uses OpenAI SDK with truncated schema (cap 50 tables)
  // _estimateCost(model, inputTokens, cachedTokens, outputTokens) — from PRICING table
  // _friendlyError(err) — 401 / 429 / 503 / generic
  // _loadKey(provider) — read encrypted base64 from JSON store, decrypt via credentialStore
  // testKey(provider) — small ping with "Reply OK" to verify auth
}
```

### IPC layer (`electron/main.js`)

```js
const aiService = require('./services/ai.service')
const credentialStore = require('./services/credentialStore.service')

ipcMain.handle('ai:generate', async (evt, { prompt, provider, tier, schemaInfo }) => {
  aiService.generate({
    prompt, provider, tier, schemaInfo,
    onChunk: (data) => evt.sender.send('ai:chunk', data),
    onDone:  (data) => evt.sender.send('ai:done', data),
    onError: (data) => evt.sender.send('ai:error', data),
  })
  // Return immediately; chunks/done/error arrive via webContents.send
})

ipcMain.handle('ai:abort', () => {
  aiService.abort()
  return true
})

ipcMain.handle('ai:save-key', async (_evt, { provider, key }) => {
  const encrypted = credentialStore.encrypt(key)
  if (!encrypted) return { ok: false, error: 'OS keychain not available' }
  await store.set(`ai.${provider}.key`, encrypted)
  return { ok: true }
})

ipcMain.handle('ai:has-key', async (_evt, provider) => {
  return !!(await store.get(`ai.${provider}.key`))
})

ipcMain.handle('ai:delete-key', async (_evt, provider) => {
  await store.delete(`ai.${provider}.key`)
  return { ok: true }
})

ipcMain.handle('ai:test-key', async (_evt, provider) => {
  return await aiService.testKey(provider)
})
```

### Preload bindings (`electron/preload.js`)

```js
ai: {
  generate: (opts) => ipcRenderer.invoke('ai:generate', opts),
  abort: () => ipcRenderer.invoke('ai:abort'),
  saveKey: (provider, key) => ipcRenderer.invoke('ai:save-key', { provider, key }),
  hasKey: (provider) => ipcRenderer.invoke('ai:has-key', provider),
  deleteKey: (provider) => ipcRenderer.invoke('ai:delete-key', provider),
  testKey: (provider) => ipcRenderer.invoke('ai:test-key', provider),
  onChunk: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('ai:chunk', handler)
    return () => ipcRenderer.removeListener('ai:chunk', handler)
  },
  onDone: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('ai:done', handler)
    return () => ipcRenderer.removeListener('ai:done', handler)
  },
  onError: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('ai:error', handler)
    return () => ipcRenderer.removeListener('ai:error', handler)
  },
},
```

## UI components

### `SettingsDialog.jsx` (~250 LOC)

Tabbed modal (sidebar tabs on the left, content on the right):

- **Tab "General"** : placeholder for v1, simple empty state "More settings coming soon"
- **Tab "AI"** : radio for default provider (Claude / OpenAI), radio for default tier (Fast / Smart), per-provider input field (set or change key, with eye toggle), per-provider [Test] [Remove] buttons, footer note about OS keyring encryption.

Critical rules:
- Never re-display saved keys. Input is empty on dialog open; status indicator shows `✓ Configured` or `Not configured`.
- Save button only enabled when input non-empty.
- Test button sends a tiny ping (`"Reply OK"`) to the provider to verify auth.
- Remove button calls `confirm()` (our existing confirm dialog) with destructive variant before deletion.
- Banner if `credentialStore.isAvailable()` returns false ("OS keychain unavailable; keys cannot be saved").

Component is mounted at App root. State held locally (input values, eye toggles, testing flags). The store fields `aiSettings.hasClaudeKey` / `hasOpenAIKey` are updated on each successful save / delete to keep the AI bar's dropdown in sync.

### `AiBar.jsx` (~250 LOC)

Renders only when `aiBarOpen === true`. Positioned between `QueryTabBar` and `QueryEditor` in App's SQL-mode branch.

Layout (when ready):

```
✨  [textarea: Describe the SQL you want…]  [✕]
    [Claude · Fast ▼]  [↗ New tab]   ─── flex ─── [Generate]
    ✓ 1234 tokens (520 cached) · $0.0008      (after first generation)
```

Layout (streaming):

```
✨  [show top 10 users by orders last 7d]  [✕]
    [Claude · Fast ▼]  [↗ New tab]   ─── flex ─── [■ Stop]
    ⚡ Generating…
```

Layout (no keys configured):

```
✨  Configure an API key to use the AI assistant   [Open Settings]   [✕]
```

Behaviors:
- Auto-focus textarea on mount
- Enter submits (Q10b = i), Shift+Enter newlines
- Esc: if generating → abort; else → close bar
- ↑ in input: cycle into prompt history (only when cursor at start OR input empty)
- ↓ in input: cycle out, eventually back to current input
- Generate button: target = active tab (replace); "↗ New tab" button: target = newly created tab
- Target tab id captured in a ref at submit time → survives tab switches during streaming
- Streaming uses `requestAnimationFrame` batching: each chunk updates a ref, RAF flushes pending text to the tab via `updateTabContent` at most ~60fps to avoid Monaco jank
- After completion, badge displays usage and cost (Claude shows cached tokens separately)

Provider/tier dropdown options derived from `aiSettings.hasClaudeKey` and `hasOpenAIKey`:
- Both → 4 options (Claude Fast, Claude Smart, OpenAI Fast, OpenAI Smart)
- Only Claude → 2 options (Claude Fast, Claude Smart)
- Only OpenAI → 2 options (OpenAI Fast, OpenAI Smart)
- Neither → no dropdown, CTA layout instead

### `useAiKeybindings.js` (~25 LOC)

Window-level `keydown` listener (capture phase). Handles only `Ctrl/Cmd + I`. Active only when `viewMode === 'sql'`. Toggles `aiBarOpen`.

Mount in App.jsx alongside `useTabKeybindings` and `useSnippetKeybindings`.

### Toolbar additions

- **Main Toolbar** (`Toolbar.jsx`): new `Settings` icon button (lucide `Settings`) → opens `SettingsDialog`.
- **QueryEditor toolbar** (`QueryEditor.jsx`): new ✨ icon (lucide `Sparkles`) → toggles `aiBarOpen`. Active state colored `text-lab-blue`.

### App.jsx wiring

```jsx
import { SettingsDialog } from '@/components/SettingsDialog'
import { AiBar } from '@/components/AiBar'
import { useAiKeybindings } from '@/hooks/useAiKeybindings'

function App() {
  // ... existing hooks
  useAiKeybindings()

  return (
    <>
      <Toolbar />
      <div className="flex h-full">
        <Sidebar />
        {viewMode === 'sql' && (
          <div className="flex h-full flex-col">
            <QueryTabBar />
            <AiBar />
            <div className="min-h-0 flex-1">
              <QueryEditor onRun={handleRunQuery} />
            </div>
          </div>
        )}
        {/* other view modes unchanged */}
      </div>
      {/* mounted dialogs */}
      <ConfirmDialog />
      <SaveSnippetDialog />
      <SnippetPalette />
      <ImportCsvDialog />
      <SettingsDialog />  {/* new */}
    </>
  )
}
```

### Tab keybindings guard (existing file `useTabKeybindings.js`)

Add a top-level guard so Ctrl+T/W/Tab/1..9 are no-ops while the AI bar is focused (similar to the existing guard for `snippetPaletteOpen`):

```js
if (useAppStore.getState().aiBarOpen) return
```

This prevents the AI bar's textarea inputs from being shadowed by tab shortcuts.

## Dependencies

Add to `package.json`:

```json
"@anthropic-ai/sdk": "^0.40.0",
"openai": "^4.80.0"
```

Both are first-party SDKs with TypeScript types out of the box. Together ~150 KB minified (acceptable for an Electron renderer; only the renderer-side `openai` browser-bundle counts; main process Node modules don't ship to renderer).

Actually clarification: both SDKs are used in **main process only** (renderer never touches them). So renderer bundle size is unaffected.

## Edge cases

- **`viewMode !== 'sql'`**: AI bar hidden (rendered only in SQL branch). Ctrl+I no-op (gated by viewMode check in the hook).
- **No connection / empty schema**: `schemaInfo === []`. AI bar still functional; AI gets minimal context. Acceptable.
- **No DB connected + Generate**: AI generates against empty schema; user reviews. No DB call made, so no DB error.
- **Invalid API key**: SDK throws 401 → `_friendlyError` maps to "Invalid API key. Check Settings → AI." → toast.
- **Rate limit (429)**: friendly toast, no retry. User retries manually.
- **Provider overloaded (503)**: friendly toast.
- **Network down**: SDK throws connection error → mapped to verbatim message → toast.
- **Generation in progress + user clicks Generate again**: button disabled by `aiGenerating`, click is a no-op at the DOM level.
- **AbortController already aborted**: cleanup is idempotent (`null` after abort).
- **Tab switch during streaming**: `targetTabIdRef` captured at submit → SQL lands in the originating tab.
- **Tab closed during streaming**: `updateTabContent(closedTabId, text)` is a no-op in the store (no matching tab in `queryTabs.map`). Streaming continues consuming the API quota until done or abort. Acceptable; the cost badge still displays after.
- **OS keyring unavailable** (Linux without libsecret): `credentialStore.encrypt()` returns null → `ai:save-key` returns `{ ok: false, error: 'OS keychain not available' }` → toast in SettingsDialog + warning banner. Keys cannot be saved without keyring in v1 (no fallback to plaintext).
- **Very large schema** (> 200 tables): Claude tolerates up to ~200K tokens of context; ~200 tables × ~80 tokens average = 16K tokens of schema, safe. OpenAI truncation at 50 tables prevents hitting any limit.
- **Restart**: AI bar closed by default (state not persisted). `aiSettings` (provider/tier defaults, hasClaudeKey/hasOpenAIKey) hydrated from disk via `initialize()`. Prompt history empty (in-memory only).
- **Multiple chunks arriving faster than Monaco can paint**: RAF batching coalesces them; at most one flush per animation frame. No jank.
- **AI returns markdown fences** (```sql ... ```) despite system prompt: accepted as-is for v1. Monaco renders the text. User can manually clean. v2 candidate: auto-strip.
- **AI returns multi-statement SQL**: works fine; `runQuery` already supports multi-statement.
- **Abort during early streaming**: partial text stays in Monaco. User can edit or run as-is. Acceptable.
- **Two parallel `ai:generate` calls** (shouldn't happen, but defensive): `currentAbortController` is overwritten by the second call. The first is silently leaked. The button disable should prevent this; if reached via bug, second call wins, first is GC'd.

## Testing

No test framework — manual verification checklist (will be replicated in the implementation plan):

### Settings dialog
- [ ] Settings icon visible in main Toolbar (next to theme toggle)
- [ ] Click → SettingsDialog opens on General tab by default
- [ ] Click AI tab → AI content displayed
- [ ] No keys configured → status "Not configured", input empty, "Set up" button
- [ ] Paste valid Claude key + Save → toast "Saved", status becomes "✓ Configured", input clears
- [ ] Reopen dialog → input remains empty (no re-display), status persists "✓ Configured"
- [ ] Test button with valid key → toast "Claude key valid ✓"
- [ ] Test button with invalid key → toast "Invalid API key"
- [ ] Remove button → confirm dialog → OK → status "Not configured", key file deleted
- [ ] Eye toggle 👁 reveals / hides the input value while typing
- [ ] OS keyring unavailable (Linux without libsecret) → banner shown, Save disabled

### AI bar visibility & shortcuts
- [ ] ✨ icon visible in QueryEditor toolbar between Format and Copy
- [ ] Click ✨ → AI bar opens above Monaco
- [ ] Click ✨ again → AI bar closes
- [ ] `Ctrl+I` in SQL view → toggles AI bar
- [ ] `Ctrl+I` in browse/schema view → ignored
- [ ] Esc when not generating → closes bar
- [ ] ✕ button in bar → closes
- [ ] `Ctrl+T` / `Ctrl+W` / `Ctrl+1..9` while AI bar is focused → no-op (tab keybindings guarded)

### AI bar — no key configured
- [ ] Bar shows "Configure an API key" CTA + "Open Settings" button
- [ ] Click "Open Settings" → SettingsDialog opens on AI tab

### AI bar — with key configured
- [ ] Bar shows textarea + provider/tier dropdown + Generate button
- [ ] Dropdown lists only configured providers (1 or 2 with 2 tiers each)
- [ ] Default provider/tier from Settings is selected
- [ ] Type prompt + Enter → generation starts
- [ ] Shift+Enter → inserts newline in textarea
- [ ] Empty prompt → Generate button disabled

### Streaming generation
- [ ] Click Generate with simple prompt → spinner "Generating…" → SQL streams progressively into Monaco
- [ ] Stop button visible during streaming
- [ ] Click Stop → generation aborts, partial text remains in Monaco, button returns to Generate
- [ ] Esc during streaming → behaves like Stop
- [ ] After completion → badge "✓ X tokens · $Y" displayed
- [ ] With Claude, second prompt within 5 min → badge shows "(N cached)" indicating cache hit

### Tab routing
- [ ] Active tab empty → SQL streams into active tab
- [ ] Active tab non-empty → active tab content is REPLACED by streaming SQL (Q5 = C)
- [ ] Click "↗ New tab" → new tab created, streaming SQL lands there, active tab unchanged
- [ ] During streaming, switch to a different tab → SQL continues streaming into the ORIGINAL target tab

### Prompt history
- [ ] Generate 3 different prompts
- [ ] Click input + ↑ → previous prompt populated
- [ ] ↑ again → 2 prompts back
- [ ] ↓ → forward through history
- [ ] Modify the input → ↑/↓ history navigation reset
- [ ] Restart app → history empty (in-memory only)

### Errors
- [ ] Invalid Claude key + Generate → toast "Invalid API key. Check Settings → AI."
- [ ] No network + Generate → toast with friendly network error
- [ ] Simulated 429 (10 rapid calls) → toast "Rate limit reached…"

### Cost display
- [ ] After Claude generation → badge "X tokens · $Y.YYYY"
- [ ] Second Claude generation within 5 min → badge shows "(N cached)" in parens
- [ ] After OpenAI generation → badge without "cached"
- [ ] Cost values are non-zero (sanity)

### Persistence
- [ ] Restart app after saving Claude key → key persists, status "✓ Configured" in Settings
- [ ] Restart app → AI bar closed by default
- [ ] Restart app → default provider/tier restored from Settings

## Files touched (summary)

**Created:**
- `electron/services/ai.service.js` — provider-agnostic AI service with streaming (~250 LOC)
- `src/components/SettingsDialog.jsx` — tabbed modal for app preferences (~250 LOC)
- `src/components/AiBar.jsx` — inline AI input + streaming output (~250 LOC)
- `src/hooks/useAiKeybindings.js` — `Ctrl+I` global keybinding (~25 LOC)

**Modified:**
- `package.json` — add `@anthropic-ai/sdk` + `openai`
- `electron/main.js` — register 6 new IPC handlers (`ai:generate`, `ai:abort`, `ai:save-key`, `ai:has-key`, `ai:delete-key`, `ai:test-key`)
- `electron/preload.js` — add `ai:` namespace with generate, abort, key management, and `onChunk` / `onDone` / `onError` event subscriptions
- `src/store/appStore.js` — add `aiSettings`, `aiBarOpen`, `aiCurrentPrompt`, `aiGenerating`, `aiLastResult`, `aiPromptHistory`, `settingsDialogOpen`, `settingsActiveTab` state + setters; hydrate `aiSettings` from disk in `initialize()`
- `src/components/Toolbar.jsx` — add Settings icon button next to theme toggle
- `src/components/QueryEditor.jsx` — add ✨ Sparkles icon button to toolbar (toggles AI bar)
- `src/App.jsx` — call `useAiKeybindings()`, mount `<AiBar />` above QueryEditor, mount `<SettingsDialog />` next to other dialogs
- `src/hooks/useTabKeybindings.js` — add guard `if (useAppStore.getState().aiBarOpen) return` at top of handler

## Out of scope / future work

- Multi-turn chat panel (à la Cursor side panel) — v1.1
- Inline edit-on-selection (`Ctrl+K` to rewrite selected SQL) — v1.1
- Advanced model picker (exact model names like `claude-opus-4-5`, `o1`, `gemini-2.5-pro`) — v1.1
- Backend AI proxy (Phase 3 of the larger plan) — requires auth + billing first
- Marketing site / Stripe / quota / premium plans (Phases 2 + 4 of the larger plan)
- Persistent prompt history (in disk) + AI history sidebar tab
- Token counter estimate BEFORE submitting (currently only after)
- Cost cap / spending limits in Settings ("warn if a single query > $0.10")
- Schema RAG / smart subset (currently full schema or top-50)
- Auto-strip markdown fences from AI output
- Auto-run on accept ("Generate and run" button)
- Diff view (current SQL vs AI-generated)
- Right-click on a table to "Describe this table" with AI
- Use AI to format / explain / debug an existing SQL query
- Multi-language support (currently English prompts only — works in any language but quality varies)
- Custom system prompt override per user (currently fixed)
- Support for Ollama / local models (decided against in v1 brainstorm)
