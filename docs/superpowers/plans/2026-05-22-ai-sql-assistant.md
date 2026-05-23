# AI SQL Assistant (BYOK) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Git convention for this project:** The user handles all `git commit` and `git push` operations manually. Each commit step is a pause point with a suggested message — do NOT run `git commit` yourself. Wait for the user to commit (or explicitly ask them to) before proceeding to the next task.

**Goal:** Add a Bring-Your-Own-Key (BYOK) AI SQL assistant — user pastes their Anthropic and/or OpenAI key in a new Settings dialog, then uses an inline AI bar (`Ctrl+I` or ✨ button) above Monaco to describe SQL in natural language and stream the result directly into the active query tab.

**Architecture:** Streaming requests run in the main process via `@anthropic-ai/sdk` / `openai`. API keys are encrypted via the existing `credentialStore.service.js` (OS keyring: DPAPI / Keychain / libsecret) and persisted under JSON keys `ai.claude.key` / `ai.openai.key`. The renderer drives a new `AiBar` component (toggle, prompt textarea, provider/tier dropdown, RAF-batched streaming target) and a new `SettingsDialog` (tabbed modal). Schema context is the full `listSchemaInfo` result, sent as a compact DDL-like string; Claude requests mark the schema block with `cache_control: ephemeral` for cheap repeat-calls.

**Tech Stack:** Electron IPC + `webContents.send` for streaming, React 18, Zustand 4.5, `@anthropic-ai/sdk` ^0.40, `openai` ^4.80, `lucide-react`, shadcn `Dialog` primitive, Tailwind.

**Reference spec:** `docs/superpowers/specs/2026-05-22-ai-sql-assistant-design.md`

---

## File Structure

**Created:**
- `electron/services/ai.service.js` — provider-agnostic AI service: Claude/OpenAI streaming, AbortController, key load/decrypt, cost estimation (~250 LOC)
- `src/components/SettingsDialog.jsx` — tabbed modal (General + AI) for app preferences; AI tab manages provider keys and default provider/tier (~250 LOC)
- `src/components/AiBar.jsx` — inline AI input + streaming output bar; renders above Monaco when `aiBarOpen === true` (~250 LOC)
- `src/hooks/useAiKeybindings.js` — global `Ctrl/Cmd+I` listener that toggles `aiBarOpen` in SQL view (~25 LOC)

**Modified:**
- `package.json` — add `@anthropic-ai/sdk` ^0.40 and `openai` ^4.80
- `electron/main.js` — add 6 IPC handlers under `// ============ IPC: AI ============` section
- `electron/preload.js` — add `ai:` namespace with generate, abort, key management, and event subscriptions
- `src/store/appStore.js` — add `aiSettings`, `aiBarOpen`, `aiCurrentPrompt`, `aiGenerating`, `aiLastResult`, `aiPromptHistory`, `settingsDialogOpen`, `settingsActiveTab` state + setters; hydrate `aiSettings` from disk in `initialize()`
- `src/components/Toolbar.jsx` — add `Settings` icon button next to the theme toggle
- `src/components/QueryEditor.jsx` — add `Sparkles` icon button to toolbar (between Format and Copy)
- `src/App.jsx` — call `useAiKeybindings()`, mount `<AiBar />` above QueryEditor, mount `<SettingsDialog />` next to other dialogs
- `src/hooks/useTabKeybindings.js` — add guard `if (useAppStore.getState().aiBarOpen) return` at top of the handler

---

## Task 1: Install AI SDK dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the packages**

Run from the project root:

```bash
npm install @anthropic-ai/sdk@^0.40 openai@^4.80
```

Expected: `package.json` and `package-lock.json` updated. Some advisory deprecation warnings in the dependency tree are acceptable as long as install completes.

- [ ] **Step 2: Verify the dependencies were added**

Inspect `package.json` `dependencies` and confirm both packages are listed. Note: npm may resolve to a slightly newer minor (e.g. `^0.40` → `^0.42`) — semver-compatible and expected.

- [ ] **Step 3: Verify the build**

```bash
npx vite build
```

Expected: success. Neither SDK is imported anywhere yet (Task 2 will import them in the main process, so the renderer bundle is unaffected).

- [ ] **Step 4: Pause for manual commit**

Suggested message: `chore(deps): add @anthropic-ai/sdk and openai for AI assistant`

---

## Task 2: Create `ai.service.js` (backend)

**Files:**
- Create: `electron/services/ai.service.js`

This task creates the provider-agnostic AI service. It has no callers yet — Task 3 wires the IPC.

- [ ] **Step 1: Write the service**

Create `electron/services/ai.service.js` with this content:

```js
// electron/services/ai.service.js
// Provider-agnostic AI service. Handles Claude + OpenAI streaming generation,
// AbortController lifecycle, key load/decrypt via credentialStore, and cost
// estimation. Never throws after the initial validation — all errors flow
// through the onError callback.

const Anthropic = require('@anthropic-ai/sdk')
const { OpenAI } = require('openai')
const credentialStore = require('./credentialStore.service')

// Implementation note: verify these model identifiers against the active SDK
// docs at implementation time. If the SDK uses dated suffixes (e.g.
// `claude-haiku-4-5-20260201`), use the form returned by client.models.list().
const MODEL_MAP = {
  claude: {
    fast: 'claude-haiku-4-5',
    smart: 'claude-sonnet-4-5',
  },
  openai: {
    fast: 'gpt-4o-mini',
    smart: 'gpt-4o',
  },
}

// Per 1M tokens, USD (as of 2026-05). Verify at implementation time;
// the cost display is an estimate, so minor drift is acceptable.
const PRICING = {
  'claude-haiku-4-5': { in: 1.00, out: 5.00, cachedIn: 0.10 },
  'claude-sonnet-4-5': { in: 3.00, out: 15.00, cachedIn: 0.30 },
  'gpt-4o-mini': { in: 0.15, out: 0.60 },
  'gpt-4o': { in: 2.50, out: 10.00 },
}

const SYSTEM_PROMPT = `You are a PostgreSQL SQL expert assistant inside GamaLab, a database GUI.
The user describes what they want; you respond with ONLY the SQL statement(s) — no markdown fences, no explanations, no comments unless the user explicitly asks for them.
Use the provided database schema as the source of truth for table and column names.
Prefer readable, well-formatted SQL with appropriate whitespace.
If the user's request is ambiguous, make a reasonable choice and produce working SQL — they can edit it.`

// Compact DDL-like serializer: ~3-5x more token-efficient than JSON.
function serializeSchema(schemaInfo) {
  if (!Array.isArray(schemaInfo)) return ''
  return schemaInfo
    .map((t) => {
      const cols = (t.columns || [])
        .map((c) => `${c.name} ${c.udt_name || c.type || ''}`.trim())
        .join(', ')
      return `${t.schema}.${t.name} (${cols})`
    })
    .join('\n')
}

// For OpenAI (no native cache): bound schema size to keep cost predictable.
function truncateSchema(schemaInfo, maxTables) {
  if (!Array.isArray(schemaInfo) || schemaInfo.length <= maxTables) return schemaInfo
  return schemaInfo
    .slice()
    .sort((a, b) => `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`))
    .slice(0, maxTables)
}

class AiService {
  constructor() {
    this.currentAbortController = null
    // Late-bind the JSON store helper so service module can be required
    // in any order at startup.
    this._store = null
  }

  _getStore() {
    if (!this._store) {
      // The JSON store is the one backing window.gamalab.store; in main.js it's
      // accessed via a small helper module. If your project mounts it differently,
      // swap the require below for the actual module path.
      this._store = require('./store.service')
    }
    return this._store
  }

  async generate({ prompt, provider, tier, schemaInfo, onChunk, onDone, onError }) {
    const model = MODEL_MAP[provider]?.[tier]
    if (!model) {
      onError({ message: `Unknown provider/tier combination: ${provider}/${tier}` })
      return
    }

    const apiKey = await this._loadKey(provider)
    if (!apiKey) {
      onError({ message: `No ${provider === 'claude' ? 'Claude' : 'OpenAI'} API key configured. Open Settings → AI.` })
      return
    }

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

  async _generateClaude({ apiKey, model, prompt, schemaInfo, onChunk, onDone, onError }) {
    const client = new Anthropic({ apiKey })
    const schemaText = serializeSchema(schemaInfo)
    let accumulated = ''
    let inputTokens = 0
    let cachedTokens = 0
    let outputTokens = 0

    try {
      const stream = client.messages.stream({
        model,
        max_tokens: 2048,
        system: [
          { type: 'text', text: SYSTEM_PROMPT },
          { type: 'text', text: `Database schema:\n${schemaText}`, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: prompt }],
      }, { signal: this.currentAbortController.signal })

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          const chunk = event.delta.text
          accumulated += chunk
          onChunk({ text: chunk, accumulated })
        }
      }
      const finalMessage = await stream.finalMessage()
      inputTokens = finalMessage.usage?.input_tokens || 0
      cachedTokens = finalMessage.usage?.cache_read_input_tokens || 0
      outputTokens = finalMessage.usage?.output_tokens || 0

      onDone({
        fullText: accumulated,
        usage: { inputTokens, cachedTokens, outputTokens },
        costUsd: this._estimateCost(model, inputTokens, cachedTokens, outputTokens),
      })
    } catch (err) {
      if (err?.name === 'AbortError' || err?.message?.includes('aborted')) return
      onError({ message: this._friendlyError(err) })
    }
  }

  async _generateOpenAI({ apiKey, model, prompt, schemaInfo, onChunk, onDone, onError }) {
    const client = new OpenAI({ apiKey })
    const truncated = truncateSchema(schemaInfo, 50)
    const schemaText = serializeSchema(truncated)
    let accumulated = ''
    let inputTokens = 0
    let outputTokens = 0

    try {
      const stream = await client.chat.completions.create({
        model,
        max_tokens: 2048,
        messages: [
          { role: 'system', content: `${SYSTEM_PROMPT}\n\nDatabase schema:\n${schemaText}` },
          { role: 'user', content: prompt },
        ],
        stream: true,
        stream_options: { include_usage: true },
      }, { signal: this.currentAbortController.signal })

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content
        if (delta) {
          accumulated += delta
          onChunk({ text: delta, accumulated })
        }
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens || 0
          outputTokens = chunk.usage.completion_tokens || 0
        }
      }

      onDone({
        fullText: accumulated,
        usage: { inputTokens, cachedTokens: 0, outputTokens },
        costUsd: this._estimateCost(model, inputTokens, 0, outputTokens),
      })
    } catch (err) {
      if (err?.name === 'AbortError' || err?.message?.includes('aborted')) return
      onError({ message: this._friendlyError(err) })
    }
  }

  _estimateCost(model, inputTokens, cachedTokens, outputTokens) {
    const p = PRICING[model]
    if (!p) return 0
    const freshIn = Math.max(0, inputTokens - cachedTokens)
    const inCost = (freshIn * p.in + cachedTokens * (p.cachedIn || p.in)) / 1_000_000
    const outCost = (outputTokens * p.out) / 1_000_000
    return inCost + outCost
  }

  _friendlyError(err) {
    const msg = err?.message || String(err)
    if (msg.includes('401') || /api[_ ]?key/i.test(msg) || /authentication/i.test(msg)) {
      return 'Invalid API key. Check Settings → AI.'
    }
    if (msg.includes('429') || /rate[_ ]?limit/i.test(msg)) {
      return 'Rate limit reached. Try again in a minute, or switch to the other provider.'
    }
    if (msg.includes('503') || /overloaded/i.test(msg)) {
      return 'Provider is overloaded. Try again in a moment.'
    }
    if (/ECONNREFUSED|ENOTFOUND|fetch failed/i.test(msg)) {
      return 'Network error reaching the AI provider.'
    }
    return msg
  }

  async _loadKey(provider) {
    const store = this._getStore()
    const encryptedB64 = await store.get(`ai.${provider}.key`)
    if (!encryptedB64) return null
    return credentialStore.decrypt(encryptedB64)
  }

  async testKey(provider) {
    const apiKey = await this._loadKey(provider)
    if (!apiKey) return { ok: false, error: 'No key configured' }
    try {
      const model = MODEL_MAP[provider].fast
      if (provider === 'claude') {
        const client = new Anthropic({ apiKey })
        await client.messages.create({
          model,
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
        })
      } else {
        const client = new OpenAI({ apiKey })
        await client.chat.completions.create({
          model,
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
        })
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: this._friendlyError(err) }
    }
  }
}

module.exports = new AiService()
```

- [ ] **Step 2: Resolve the JSON store helper path**

The service references `require('./store.service')` for the persistent key/value store. Open `electron/main.js` and inspect the existing `ipcMain.handle('store:get', ...)` handler. Identify which module / file actually backs that store — typical patterns in this project:
- A direct `require('electron-store')` instance
- A custom module like `./services/store.service.js`
- An inline JSON file wrapper

Once you've identified the actual helper, update the `_getStore()` method's `require()` path to match. If the store is constructed inline in `main.js` (no separate module), extract it into a new `electron/services/store.service.js` exporting `{ get(key), set(key, value), delete(key) }` — and update both main.js and ai.service.js to require that new module.

If you take the extract route, the new helper should be a thin wrapper. Example shape:

```js
// electron/services/store.service.js (only if main.js doesn't already have a separate module)
const Store = require('electron-store')
const store = new Store({ name: 'gamalab' })
module.exports = {
  get: async (key) => store.get(key),
  set: async (key, value) => store.set(key, value),
  delete: async (key) => store.delete(key),
}
```

- [ ] **Step 3: Verify the file parses**

```bash
node -c electron/services/ai.service.js
```

Expected: no output. If errors, fix and re-run.

- [ ] **Step 4: Verify Vite build**

```bash
npx vite build
```

Expected: success. The service is not imported by the renderer; the build is unaffected.

- [ ] **Step 5: Verify exact model identifiers (manual check)**

Before considering this task done, briefly cross-check the four model identifiers in `MODEL_MAP` against the installed SDK's documentation:

```bash
node -e "const A = require('@anthropic-ai/sdk'); console.log(Object.keys(A))"
```

If the SDK exposes a `client.models.list()` method or a constants file with the active model IDs, verify the identifiers in `MODEL_MAP` match. If a discrepancy is found (e.g. the SDK uses `claude-4-5-haiku` instead of `claude-haiku-4-5`), update the constant and document the change in the commit message.

- [ ] **Step 6: Pause for manual commit**

Suggested message: `feat(ai): add streaming AI service with Claude + OpenAI providers`

---

## Task 3: Wire IPC handlers + preload bindings

**Files:**
- Modify: `electron/main.js`
- Modify: `electron/preload.js`

- [ ] **Step 1: Require the service in main.js**

Open `electron/main.js`. Near the top with other service requires (e.g. `dbService`, `credentialStore`), add:

```js
const aiService = require('./services/ai.service')
```

- [ ] **Step 2: Add the IPC handlers**

In `electron/main.js`, find a logical place for a new section (after the existing AI-adjacent or last service handlers). Add a new section header and the six handlers:

```js
// ============ IPC: AI ============
ipcMain.handle('ai:generate', async (evt, { prompt, provider, tier, schemaInfo }) => {
  aiService.generate({
    prompt,
    provider,
    tier,
    schemaInfo,
    onChunk: (data) => {
      if (!evt.sender.isDestroyed()) evt.sender.send('ai:chunk', data)
    },
    onDone: (data) => {
      if (!evt.sender.isDestroyed()) evt.sender.send('ai:done', data)
    },
    onError: (data) => {
      if (!evt.sender.isDestroyed()) evt.sender.send('ai:error', data)
    },
  })
  return true
})

ipcMain.handle('ai:abort', () => {
  aiService.abort()
  return true
})

ipcMain.handle('ai:save-key', async (_evt, { provider, key }) => {
  const encrypted = credentialStore.encrypt(key)
  if (!encrypted) return { ok: false, error: 'OS keychain not available' }
  const store = require('./services/store.service')
  await store.set(`ai.${provider}.key`, encrypted)
  return { ok: true }
})

ipcMain.handle('ai:has-key', async (_evt, provider) => {
  const store = require('./services/store.service')
  return !!(await store.get(`ai.${provider}.key`))
})

ipcMain.handle('ai:delete-key', async (_evt, provider) => {
  const store = require('./services/store.service')
  await store.delete(`ai.${provider}.key`)
  return { ok: true }
})

ipcMain.handle('ai:test-key', async (_evt, provider) => {
  return await aiService.testKey(provider)
})
```

If the project uses a different store-access pattern in `main.js` (e.g. an existing `store` variable in scope), use that instead of `require('./services/store.service')`. The contract is: read/write/delete a key in the same JSON store that already backs `window.gamalab.store.{get,set,delete}`.

The `isDestroyed()` check on `evt.sender` defends against the renderer window being closed mid-stream (the IPC fire-and-forget pattern means handlers must guard).

- [ ] **Step 3: Add preload bindings**

Open `electron/preload.js`. Add a new `ai:` namespace inside the `contextBridge.exposeInMainWorld('gamalab', { ... })` block. A natural place is after `dialog:` and before `app:` (or wherever the existing structure puts new namespaces):

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

Match the indentation style of surrounding namespaces (typically 4 spaces for the key, 6 for nested properties).

- [ ] **Step 4: Verify both files parse**

```bash
node -c electron/main.js && node -c electron/preload.js
```

Expected: no output.

- [ ] **Step 5: Verify Vite build**

```bash
npx vite build
```

Expected: success.

- [ ] **Step 6: Smoke test via DevTools (optional)**

If you can run `npm run dev`, open Electron DevTools and try:

```js
await window.gamalab.ai.hasKey('claude')
// → false (no key configured)

const off = window.gamalab.ai.onError((data) => console.log('error:', data))
await window.gamalab.ai.generate({
  prompt: 'SELECT 1',
  provider: 'claude',
  tier: 'fast',
  schemaInfo: []
})
// → expect 'ai:error' event: 'No Claude API key configured. Open Settings → AI.'
off()
```

- [ ] **Step 7: Pause for manual commit**

Suggested message: `feat(ai): wire AI IPC handlers and preload bindings`

---

## Task 4: Extend store with AI state + setters

**Files:**
- Modify: `src/store/appStore.js`

- [ ] **Step 1: Add the new state fields**

Open `src/store/appStore.js`. Add these fields in a logical group (e.g. near other transient dialog state like `confirmDialog`, `importCsvDialogOpen`, etc.):

```js
  // --- AI assistant state ---
  aiSettings: {
    defaultProvider: 'claude',     // 'claude' | 'openai'
    defaultTier: 'fast',           // 'fast' | 'smart'
    hasClaudeKey: false,           // mirrors disk state, updated on save/delete
    hasOpenAIKey: false,
  },
  aiBarOpen: false,
  aiCurrentPrompt: '',
  aiGenerating: false,
  aiLastResult: null,              // { tokensIn, cachedTokens, tokensOut, costUsd } | null
  aiPromptHistory: [],             // ring buffer max 20 — in-memory only

  // --- Settings dialog state ---
  settingsDialogOpen: false,
  settingsActiveTab: 'general',    // 'general' | 'ai'
```

- [ ] **Step 2: Add the setters**

Add these actions next to other dialog setters in the store:

```js
  // --- AI / Settings actions ---
  setAiSettings: (patch) =>
    set((s) => ({ aiSettings: { ...s.aiSettings, ...patch } })),
  setAiBarOpen: (open) => set({ aiBarOpen: open }),
  setAiCurrentPrompt: (prompt) => set({ aiCurrentPrompt: prompt }),
  setAiGenerating: (g) => set({ aiGenerating: g }),
  setAiLastResult: (r) => set({ aiLastResult: r }),
  pushAiPromptHistory: (p) =>
    set((s) => {
      const trimmed = (p || '').trim()
      if (!trimmed) return s
      const filtered = s.aiPromptHistory.filter((x) => x !== trimmed)
      return { aiPromptHistory: [trimmed, ...filtered].slice(0, 20) }
    }),
  setSettingsDialogOpen: (open) => set({ settingsDialogOpen: open }),
  setSettingsActiveTab: (tab) => set({ settingsActiveTab: tab }),
```

- [ ] **Step 3: Hydrate `aiSettings` from disk in `initialize()`**

Locate the existing `initialize: async () => { ... }` action. At the end of its body (after all existing hydration logic), add:

```js
    // Hydrate AI settings from disk
    try {
      const [defaultProvider, defaultTier, hasClaudeKey, hasOpenAIKey] = await Promise.all([
        window.gamalab.store.get('ai.defaultProvider'),
        window.gamalab.store.get('ai.defaultTier'),
        window.gamalab.ai.hasKey('claude'),
        window.gamalab.ai.hasKey('openai'),
      ])
      set({
        aiSettings: {
          defaultProvider: defaultProvider || 'claude',
          defaultTier: defaultTier || 'fast',
          hasClaudeKey,
          hasOpenAIKey,
        },
      })
    } catch (err) {
      // Defaults remain; AI features will surface "no key" CTA naturally
    }
```

- [ ] **Step 4: Confirm `partialize` does NOT include the new fields**

Locate the `persist` options block in `appStore.js`. Verify the `partialize` function returns only its existing fields (likely `queryTabs`, `activeTabId`, `nextTabNumber`). The new AI fields must NOT be in `partialize` — `aiSettings` is hydrated from disk via the JSON store (not from localStorage), and the transient state is intentionally session-only.

If any new field accidentally appears in `partialize`, remove it.

- [ ] **Step 5: Verify build**

```bash
npx vite build
```

Expected: success.

- [ ] **Step 6: Pause for manual commit**

Suggested message: `feat(ai): add AI state, setters, and initialize() hydration to appStore`

---

## Task 5: Create `SettingsDialog` component

**Files:**
- Create: `src/components/SettingsDialog.jsx`

This task creates the dialog. It's not mounted yet — Task 6 wires it.

- [ ] **Step 1: Write the component**

Create `src/components/SettingsDialog.jsx` with this content:

```jsx
// src/components/SettingsDialog.jsx
// Tabbed Settings modal. Tab "General" is a placeholder; tab "AI" manages
// provider API keys (encrypted via the OS keyring) and default provider/tier.

import { useEffect, useState } from 'react'
import { Eye, EyeOff, Key, Loader2, Settings as SettingsIcon, Sparkles, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { confirm } from '@/lib/confirm'

const TABS = [
  { id: 'general', label: 'General', icon: SettingsIcon },
  { id: 'ai', label: 'AI', icon: Sparkles },
]

export function SettingsDialog() {
  const open = useAppStore((s) => s.settingsDialogOpen)
  const activeTab = useAppStore((s) => s.settingsActiveTab)
  const setOpen = useAppStore((s) => s.setSettingsDialogOpen)
  const setActiveTab = useAppStore((s) => s.setSettingsActiveTab)
  const aiSettings = useAppStore((s) => s.aiSettings)
  const setAiSettings = useAppStore((s) => s.setAiSettings)
  const showToast = useAppStore((s) => s.showToast)

  if (!open) return null

  return (
    <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-[400px] gap-4">
          {/* Sidebar tabs */}
          <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-border pr-3">
            {TABS.map((t) => {
              const Icon = t.icon
              const isActive = activeTab === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                    isActive
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                </button>
              )
            })}
          </nav>

          {/* Content */}
          <div className="min-w-0 flex-1">
            {activeTab === 'general' && <GeneralTab />}
            {activeTab === 'ai' && (
              <AiTab
                aiSettings={aiSettings}
                setAiSettings={setAiSettings}
                showToast={showToast}
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GeneralTab() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-2 py-8 text-center">
      <SettingsIcon className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">More settings coming soon.</p>
    </div>
  )
}

function AiTab({ aiSettings, setAiSettings, showToast }) {
  return (
    <div className="flex flex-col gap-5 px-1 py-2 text-sm">
      <DefaultsSection aiSettings={aiSettings} setAiSettings={setAiSettings} showToast={showToast} />
      <KeySection
        provider="claude"
        label="Anthropic (Claude)"
        placeholder="sk-ant-…"
        configured={aiSettings.hasClaudeKey}
        setAiSettings={setAiSettings}
        showToast={showToast}
      />
      <KeySection
        provider="openai"
        label="OpenAI"
        placeholder="sk-…"
        configured={aiSettings.hasOpenAIKey}
        setAiSettings={setAiSettings}
        showToast={showToast}
      />
      <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
        ⓘ Keys are encrypted via your OS keyring (DPAPI on Windows, Keychain on macOS, libsecret
        on Linux) and never leave this device.
      </p>
    </div>
  )
}

function DefaultsSection({ aiSettings, setAiSettings, showToast }) {
  const updateDefault = async (field, value) => {
    setAiSettings({ [field]: value })
    try {
      await window.gamalab.store.set(`ai.${field}`, value)
    } catch (err) {
      showToast(`Failed to save default: ${err.message}`, 'error')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Default provider
        </div>
        <div className="mt-1.5 flex gap-2">
          {['claude', 'openai'].map((p) => (
            <label key={p} className="flex cursor-pointer items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="defaultProvider"
                checked={aiSettings.defaultProvider === p}
                onChange={() => updateDefault('defaultProvider', p)}
              />
              {p === 'claude' ? 'Claude' : 'OpenAI'}
            </label>
          ))}
        </div>
      </div>
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Default tier
        </div>
        <div className="mt-1.5 flex gap-2">
          {['fast', 'smart'].map((t) => (
            <label key={t} className="flex cursor-pointer items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="defaultTier"
                checked={aiSettings.defaultTier === t}
                onChange={() => updateDefault('defaultTier', t)}
              />
              {t === 'fast' ? 'Fast' : 'Smart'}
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}

function KeySection({ provider, label, placeholder, configured, setAiSettings, showToast }) {
  const [input, setInput] = useState('')
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const hasKeyField = provider === 'claude' ? 'hasClaudeKey' : 'hasOpenAIKey'

  const onSave = async () => {
    const key = input.trim()
    if (!key) return
    setSaving(true)
    try {
      const result = await window.gamalab.ai.saveKey(provider, key)
      if (result.ok) {
        showToast(`${label} key saved`, 'success')
        setAiSettings({ [hasKeyField]: true })
        setInput('')
      } else {
        showToast(result.error || 'Failed to save key', 'error')
      }
    } finally {
      setSaving(false)
    }
  }

  const onTest = async () => {
    setTesting(true)
    try {
      const result = await window.gamalab.ai.testKey(provider)
      if (result.ok) {
        showToast(`${label} key valid ✓`, 'success')
      } else {
        showToast(result.error || 'Test failed', 'error')
      }
    } finally {
      setTesting(false)
    }
  }

  const onRemove = async () => {
    const ok = await confirm({
      title: `Remove ${label} API key?`,
      message: 'The encrypted key will be deleted from this device.',
      variant: 'destructive',
      confirmLabel: 'Remove',
    })
    if (!ok) return
    await window.gamalab.ai.deleteKey(provider)
    setAiSettings({ [hasKeyField]: false })
    showToast(`${label} key removed`, 'info')
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Key className="h-3.5 w-3.5 text-muted-foreground" />
          {label} API key
        </div>
        <span
          className={cn(
            'text-[11px] font-medium',
            configured ? 'text-lab-green' : 'text-muted-foreground'
          )}
        >
          {configured ? '✓ Configured' : 'Not configured'}
        </span>
      </div>
      <div className="relative">
        <Input
          type={show ? 'text' : 'password'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={configured ? '••• Replace existing key' : placeholder}
          disabled={saving || testing}
          className="pr-9 font-mono text-xs"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          tabIndex={-1}
          title={show ? 'Hide' : 'Show'}
        >
          {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="lab"
          onClick={onSave}
          disabled={!input.trim() || saving || testing}
        >
          {saving ? <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</> : 'Save'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onTest}
          disabled={!configured || saving || testing}
          title={configured ? 'Test the saved key' : 'Save a key first'}
        >
          {testing ? <><Loader2 className="h-3 w-3 animate-spin" /> Testing…</> : 'Test'}
        </Button>
        {configured && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={onRemove}
            disabled={saving || testing}
          >
            <Trash2 className="h-3 w-3" />
            Remove
          </Button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
npx vite build
```

Expected: success.

- [ ] **Step 3: Pause for manual commit**

Suggested message: `feat(ai): add SettingsDialog with AI tab for key management`

---

## Task 6: Mount SettingsDialog + wire Toolbar icon

**Files:**
- Modify: `src/components/Toolbar.jsx`
- Modify: `src/App.jsx`

After this task, the user can open Settings and save / test / delete their API keys end-to-end. The AI bar still doesn't exist (Task 7+8).

- [ ] **Step 1: Add `Settings` icon button in Toolbar**

Open `src/components/Toolbar.jsx`. Locate the lucide-react import and add `Settings` to it. Example: if the current line is

```js
import { Plug, Play, Sun, Moon, ... } from 'lucide-react'
```

add `Settings`:

```js
import { Plug, Play, Sun, Moon, Settings, ... } from 'lucide-react'
```

Locate the existing theme toggle / about / etc. buttons in the toolbar. Add a new Settings button next to them (typical placement: just before or after the theme toggle):

```jsx
            <Button
              size="iconSm"
              variant="ghost"
              onClick={() => setSettingsDialogOpen(true)}
              title="Settings"
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
```

Pull `setSettingsDialogOpen` from the store at the top of the component (matching the destructure or individual-selector pattern in this file):

```js
  const setSettingsDialogOpen = useAppStore((s) => s.setSettingsDialogOpen)
```

- [ ] **Step 2: Import + mount SettingsDialog in App.jsx**

Open `src/App.jsx`. Add the import near the other dialog imports:

```js
import { SettingsDialog } from '@/components/SettingsDialog'
```

In the JSX, mount it adjacent to other dialogs (e.g. next to `ImportCsvDialog`, `ConfirmDialog`):

```jsx
        <SettingsDialog />
```

Match the surrounding indentation.

- [ ] **Step 3: Verify build**

```bash
npx vite build
```

Expected: success.

- [ ] **Step 4: Smoke test (interactive)**

Run `npm run dev`. Verify:
- Settings icon visible in main Toolbar
- Click → dialog opens on General tab
- Click AI tab → AI content visible
- Save a Claude key (any string for now — the test button will reject invalid ones) → "Configured" status appears
- Click Test → if real key, "valid ✓" toast; if fake, friendly error toast
- Click Remove → confirm dialog → status returns to "Not configured"
- Close + reopen dialog → input is empty, status persists

If you don't have a real API key to test, just verify the UI flow with a placeholder string (Test will return error).

- [ ] **Step 5: Pause for manual commit**

Suggested message: `feat(ai): mount SettingsDialog and add Toolbar Settings icon`

---

## Task 7: Create `AiBar` component

**Files:**
- Create: `src/components/AiBar.jsx`

The bar is created but not mounted (Task 8 wires it).

- [ ] **Step 1: Write the component**

Create `src/components/AiBar.jsx` with this content:

```jsx
// src/components/AiBar.jsx
// Inline AI bar above Monaco. Renders only when aiBarOpen === true.
// Streams generated SQL into the target query tab, with RAF batching to
// avoid Monaco jank.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { useSchemaInfo } from '@/hooks/useSchemaInfo'

const TIER_LABELS = {
  'claude-fast': 'Claude · Fast',
  'claude-smart': 'Claude · Smart',
  'openai-fast': 'OpenAI · Fast',
  'openai-smart': 'OpenAI · Smart',
}

export function AiBar() {
  const open = useAppStore((s) => s.aiBarOpen)
  const setOpen = useAppStore((s) => s.setAiBarOpen)
  const prompt = useAppStore((s) => s.aiCurrentPrompt)
  const setPrompt = useAppStore((s) => s.setAiCurrentPrompt)
  const generating = useAppStore((s) => s.aiGenerating)
  const setGenerating = useAppStore((s) => s.setAiGenerating)
  const lastResult = useAppStore((s) => s.aiLastResult)
  const setLastResult = useAppStore((s) => s.setAiLastResult)
  const promptHistory = useAppStore((s) => s.aiPromptHistory)
  const pushPromptHistory = useAppStore((s) => s.pushAiPromptHistory)
  const aiSettings = useAppStore((s) => s.aiSettings)
  const activeTab = useAppStore((s) =>
    s.queryTabs.find((t) => t.id === s.activeTabId) ?? null
  )
  const updateTabContent = useAppStore((s) => s.updateTabContent)
  const createTab = useAppStore((s) => s.createTab)
  const setSettingsDialogOpen = useAppStore((s) => s.setSettingsDialogOpen)
  const setSettingsActiveTab = useAppStore((s) => s.setSettingsActiveTab)
  const showToast = useAppStore((s) => s.showToast)

  const schemaInfo = useSchemaInfo()

  const [providerTier, setProviderTier] = useState(
    `${aiSettings.defaultProvider}-${aiSettings.defaultTier}`
  )
  const [historyIdx, setHistoryIdx] = useState(-1)
  const inputRef = useRef(null)
  const targetTabIdRef = useRef(null)
  const pendingTextRef = useRef('')
  const rafIdRef = useRef(null)

  // Keep providerTier in sync if defaults change (e.g. user switches in Settings)
  useEffect(() => {
    setProviderTier(`${aiSettings.defaultProvider}-${aiSettings.defaultTier}`)
  }, [aiSettings.defaultProvider, aiSettings.defaultTier])

  // Auto-focus when bar opens
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // IPC listeners — mount once
  useEffect(() => {
    const flushPending = () => {
      rafIdRef.current = null
      const tabId = targetTabIdRef.current
      if (tabId) updateTabContent(tabId, pendingTextRef.current)
    }
    const scheduleFlush = (accumulated) => {
      pendingTextRef.current = accumulated
      if (rafIdRef.current) return
      rafIdRef.current = requestAnimationFrame(flushPending)
    }
    const offChunk = window.gamalab.ai.onChunk(({ accumulated }) => {
      scheduleFlush(accumulated)
    })
    const offDone = window.gamalab.ai.onDone(({ fullText, usage, costUsd }) => {
      // Cancel any pending RAF flush and write the final text immediately
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      const tabId = targetTabIdRef.current
      if (tabId) updateTabContent(tabId, fullText)
      pendingTextRef.current = ''
      setGenerating(false)
      setLastResult({
        tokensIn: usage.inputTokens,
        cachedTokens: usage.cachedTokens || 0,
        tokensOut: usage.outputTokens,
        costUsd,
      })
    })
    const offError = window.gamalab.ai.onError(({ message }) => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      pendingTextRef.current = ''
      setGenerating(false)
      showToast(`AI generation failed: ${message}`, 'error')
    })
    return () => {
      offChunk()
      offDone()
      offError()
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
    }
  }, [updateTabContent, setGenerating, setLastResult, showToast])

  const options = useMemo(() => {
    const opts = []
    if (aiSettings.hasClaudeKey) {
      opts.push({ value: 'claude-fast', label: TIER_LABELS['claude-fast'] })
      opts.push({ value: 'claude-smart', label: TIER_LABELS['claude-smart'] })
    }
    if (aiSettings.hasOpenAIKey) {
      opts.push({ value: 'openai-fast', label: TIER_LABELS['openai-fast'] })
      opts.push({ value: 'openai-smart', label: TIER_LABELS['openai-smart'] })
    }
    return opts
  }, [aiSettings.hasClaudeKey, aiSettings.hasOpenAIKey])

  const openSettingsToAi = () => {
    setSettingsActiveTab('ai')
    setSettingsDialogOpen(true)
  }

  const handleGenerate = async (createNewTab = false) => {
    if (!prompt.trim() || generating) return

    // Re-resolve provider/tier (the dropdown is source-of-truth, fall back to defaults if invalid)
    const [provider, tier] = providerTier.split('-')
    if (!provider || !tier) {
      showToast('Pick a provider and tier', 'warning')
      return
    }

    // Verify the chosen provider's key is present
    const keyOk = await window.gamalab.ai.hasKey(provider)
    if (!keyOk) {
      showToast(`${provider === 'claude' ? 'Claude' : 'OpenAI'} key not configured`, 'warning')
      openSettingsToAi()
      return
    }

    // Determine target tab — created or active
    let tabId
    if (createNewTab) {
      tabId = createTab({ content: '' })
    } else if (activeTab) {
      tabId = activeTab.id
    } else {
      tabId = createTab({ content: '' })
    }
    targetTabIdRef.current = tabId
    pendingTextRef.current = ''

    // Reset tab content before stream
    updateTabContent(tabId, '')

    // Push to history (front, dedupe — handled in the store action)
    pushPromptHistory(prompt.trim())
    setHistoryIdx(-1)

    setGenerating(true)
    setLastResult(null)

    await window.gamalab.ai.generate({
      prompt: prompt.trim(),
      provider,
      tier,
      schemaInfo,
    })
  }

  const handleAbort = () => {
    window.gamalab.ai.abort()
    setGenerating(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (generating) return
      handleGenerate(false)
      return
    }
    if (e.key === 'Escape') {
      if (generating) handleAbort()
      else setOpen(false)
      return
    }
    if (e.key === 'ArrowUp' && !e.shiftKey && promptHistory.length > 0) {
      // Navigate history only if input empty OR cursor at start
      const ta = e.target
      const isAtStart = ta.selectionStart === 0 && ta.selectionEnd === 0
      if (!isAtStart && prompt.length > 0) return
      e.preventDefault()
      const nextIdx = Math.min(historyIdx + 1, promptHistory.length - 1)
      setHistoryIdx(nextIdx)
      setPrompt(promptHistory[nextIdx])
      return
    }
    if (e.key === 'ArrowDown' && historyIdx >= 0) {
      e.preventDefault()
      const nextIdx = historyIdx - 1
      setHistoryIdx(nextIdx)
      setPrompt(nextIdx === -1 ? '' : promptHistory[nextIdx])
      return
    }
  }

  if (!open) return null

  // No keys configured → minimal CTA layout
  if (options.length === 0) {
    return (
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs">
        <Sparkles className="h-4 w-4 text-muted-foreground" />
        <span className="text-muted-foreground">
          Configure an API key to use the AI assistant
        </span>
        <Button
          size="sm"
          variant="lab"
          className="h-6 px-2 text-[11px]"
          onClick={openSettingsToAi}
        >
          Open Settings
        </Button>
        <div className="flex-1" />
        <button
          onClick={() => setOpen(false)}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  // If the saved provider/tier isn't in options anymore (e.g. key removed), fall back
  const validProviderTier = options.some((o) => o.value === providerTier)
    ? providerTier
    : options[0].value

  return (
    <div className="flex shrink-0 flex-col gap-1 border-b border-border bg-card px-3 py-2">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-1 h-4 w-4 shrink-0 text-lab-blue" />
        <textarea
          ref={inputRef}
          value={prompt}
          onChange={(e) => { setPrompt(e.target.value); setHistoryIdx(-1) }}
          onKeyDown={handleKeyDown}
          placeholder="Describe the SQL you want…"
          rows={1}
          className="min-w-0 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          disabled={generating}
        />
        <button
          onClick={() => setOpen(false)}
          disabled={generating}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          title="Close (Esc)"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-2 pl-6">
        <select
          value={validProviderTier}
          onChange={(e) => setProviderTier(e.target.value)}
          disabled={generating}
          className="h-6 rounded-sm border border-border bg-background px-1.5 text-[11px] outline-none focus:ring-1 focus:ring-ring"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px]"
          onClick={() => handleGenerate(true)}
          disabled={generating || !prompt.trim()}
          title="Generate in a new tab"
        >
          <ArrowUpRight className="h-3 w-3" />
          New tab
        </Button>
        <div className="flex-1" />
        {generating ? (
          <Button
            size="sm"
            variant="destructive"
            className="h-6 px-3 text-[11px]"
            onClick={handleAbort}
          >
            <Square className="h-3 w-3" />
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            variant="lab"
            className="h-6 px-3 text-[11px]"
            onClick={() => handleGenerate(false)}
            disabled={!prompt.trim()}
          >
            <Sparkles className="h-3 w-3" />
            Generate
          </Button>
        )}
      </div>
      {(generating || lastResult) && (
        <div className="flex items-center gap-2 pl-6 text-[10px] text-muted-foreground">
          {generating ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Generating…
            </>
          ) : lastResult ? (
            <>
              <CheckCircle2 className="h-3 w-3 text-lab-green" />
              {(lastResult.tokensIn + lastResult.tokensOut).toLocaleString()} tokens
              {lastResult.cachedTokens > 0 && (
                <span>({lastResult.cachedTokens.toLocaleString()} cached)</span>
              )}
              <span>· ${lastResult.costUsd.toFixed(4)}</span>
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
npx vite build
```

Expected: success. Component is not mounted yet (Task 8 wires it).

- [ ] **Step 3: Pause for manual commit**

Suggested message: `feat(ai): add AiBar with streaming, history, abort, cost display`

---

## Task 8: Wire AiBar + Sparkles button + keybindings + tab guard

**Files:**
- Create: `src/hooks/useAiKeybindings.js`
- Modify: `src/hooks/useTabKeybindings.js`
- Modify: `src/components/QueryEditor.jsx`
- Modify: `src/App.jsx`

After this task, the AI assistant is fully functional end-to-end.

- [ ] **Step 1: Create `useAiKeybindings` hook**

Create `src/hooks/useAiKeybindings.js`:

```js
// src/hooks/useAiKeybindings.js
import { useEffect } from 'react'
import { useAppStore } from '@/store/appStore'

export function useAiKeybindings() {
  useEffect(() => {
    const handler = (e) => {
      const cmd = e.metaKey || e.ctrlKey
      if (!cmd) return
      // Layout-independent: e.code === 'KeyI'. Fallback on e.key for safety.
      const isI = e.code === 'KeyI' || e.key === 'i' || e.key === 'I'
      if (!isI) return
      // Only toggle in SQL view (browse/schema would be confusing)
      if (useAppStore.getState().viewMode !== 'sql') return
      e.preventDefault()
      const open = useAppStore.getState().aiBarOpen
      useAppStore.getState().setAiBarOpen(!open)
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [])
}
```

- [ ] **Step 2: Add guard in `useTabKeybindings` for AI bar focus**

Open `src/hooks/useTabKeybindings.js`. At the very top of the `handler` function (before the existing `snippetPaletteOpen` guard if present, or before the viewMode check), add:

```js
      // If the AI bar is open and focused, ignore tab keybindings
      if (useAppStore.getState().aiBarOpen) return
```

The final handler start should look something like:

```js
    const handler = (e) => {
      if (useAppStore.getState().aiBarOpen) return
      if (useAppStore.getState().snippetPaletteOpen) return  // (if it exists)
      const viewMode = useAppStore.getState().viewMode
      if (viewMode !== 'sql') return
      // ...rest of the handler
```

- [ ] **Step 3: Add Sparkles button in QueryEditor toolbar**

Open `src/components/QueryEditor.jsx`. Locate the lucide-react import and add `Sparkles`:

```js
import { Wand2, Copy, Trash2, Bookmark, Sparkles } from 'lucide-react'
```

(Adjust to match the actual existing import — `Bookmark` was added by the snippets feature.)

Pull the AI bar setter and current state at the top of the component:

```js
  const aiBarOpen = useAppStore((s) => s.aiBarOpen)
  const setAiBarOpen = useAppStore((s) => s.setAiBarOpen)
```

In the toolbar JSX (where Format / Copy / Save-snippet / Clear buttons already exist), add a new button. Natural placement: between Format and Copy (it groups with "do something with the editor content"):

```jsx
          <Button
            size="iconSm"
            variant="ghost"
            onClick={() => setAiBarOpen(!aiBarOpen)}
            title="AI assistant (Ctrl+I)"
            className={aiBarOpen ? 'text-lab-blue' : ''}
          >
            <Sparkles className="h-3.5 w-3.5" />
          </Button>
```

The `className={aiBarOpen ? 'text-lab-blue' : ''}` gives visual feedback that the bar is currently open.

- [ ] **Step 4: Wire AiBar + useAiKeybindings in App.jsx**

Open `src/App.jsx`. Add imports near the other hook/component imports:

```js
import { AiBar } from '@/components/AiBar'
import { useAiKeybindings } from '@/hooks/useAiKeybindings'
```

In the App component body, near other hook calls (e.g. `useTabKeybindings()`):

```js
  useAiKeybindings()
```

In the JSX, locate the SQL-mode branch where `QueryTabBar` and `QueryEditor` are rendered. The current structure is:

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
                  ...
                </PanelGroup>
```

Insert `<AiBar />` between `<QueryTabBar />` and the QueryEditor wrapper div:

```jsx
                    <div className="flex h-full flex-col">
                      <QueryTabBar />
                      <AiBar />
                      <div className="min-h-0 flex-1">
                        <QueryEditor onRun={handleRunQuery} />
                      </div>
                    </div>
```

The bar takes 0px when closed (returns `null`), ~36–60px when open. Monaco gets the remaining flex space.

- [ ] **Step 5: Verify build**

```bash
npx vite build
```

Expected: success.

- [ ] **Step 6: Smoke test (interactive, recommended)**

Run `npm run dev`. With a valid Claude or OpenAI key saved (Task 6), verify:

- ✨ icon visible in QueryEditor toolbar (between Format and Copy)
- Click ✨ → AI bar appears above Monaco
- Click ✨ again → AI bar disappears
- Ctrl+I (in SQL view) → toggles AI bar
- In bar: type "show me table version" + Enter → SQL streams into the active tab
- Click Stop during streaming → aborts
- Esc when not generating → closes bar
- Ctrl+T while focus is in AI bar → does NOT create a new tab (guard works)

If interactive testing isn't available, the build verification of Step 5 is sufficient — Task 9 covers the full manual checklist.

- [ ] **Step 7: Pause for manual commit**

Suggested message: `feat(ai): wire AiBar, Sparkles button, Ctrl+I, and tab keybindings guard`

---

## Task 9: Final manual verification checklist

**Files:** none — verification only.

- [ ] **Step 1: Walk the spec's manual verification checklist end-to-end**

From `docs/superpowers/specs/2026-05-22-ai-sql-assistant-design.md` (Testing section), tick every item. Re-stated here for convenience:

**Settings dialog**
- [ ] Settings icon visible in main Toolbar
- [ ] Click → SettingsDialog opens on General tab by default
- [ ] Click AI tab → AI content displayed
- [ ] No keys configured → status "Not configured", input empty
- [ ] Paste valid Claude key + Save → toast "Saved", status "✓ Configured", input clears
- [ ] Reopen dialog → input still empty, status persists "✓ Configured"
- [ ] Test button with valid key → toast "Claude key valid ✓"
- [ ] Test button with invalid key → toast "Invalid API key"
- [ ] Remove button → confirm dialog → OK → status "Not configured"
- [ ] Eye toggle reveals / hides the input value
- [ ] On Linux without libsecret: Save returns "OS keychain not available" error

**AI bar visibility & shortcuts**
- [ ] ✨ icon in QueryEditor toolbar
- [ ] Click ✨ → AI bar opens
- [ ] Click ✨ again → AI bar closes
- [ ] Ctrl+I in SQL view → toggles bar
- [ ] Ctrl+I in browse/schema view → ignored
- [ ] Esc when not generating → closes bar
- [ ] ✕ button in bar → closes
- [ ] Ctrl+T while AI bar focused → no-op (no new tab created)

**AI bar — no key configured**
- [ ] Bar shows "Configure an API key" CTA + "Open Settings" button
- [ ] Click "Open Settings" → SettingsDialog opens on AI tab

**AI bar — with key configured**
- [ ] Bar shows textarea + provider/tier dropdown + Generate button
- [ ] Dropdown lists only configured providers
- [ ] Default provider/tier matches Settings
- [ ] Enter submits, Shift+Enter inserts newline
- [ ] Empty prompt → Generate disabled

**Streaming generation**
- [ ] Click Generate with simple prompt → spinner → SQL streams into Monaco progressively
- [ ] Stop button visible during streaming
- [ ] Click Stop → aborts, partial text remains
- [ ] Esc during streaming → behaves like Stop
- [ ] After completion → badge "✓ X tokens · $Y" displayed
- [ ] Claude: second prompt within 5 min → badge shows "(N cached)"

**Tab routing**
- [ ] Active tab empty → SQL streams into active tab
- [ ] Active tab non-empty → active tab REPLACED by streaming SQL
- [ ] Click "↗ New tab" → new tab created, SQL lands there
- [ ] Switch tabs during streaming → SQL continues into original target tab

**Prompt history**
- [ ] Generate 3 different prompts
- [ ] ↑ in input → previous prompt
- [ ] ↑↑ → 2 back
- [ ] ↓ → forward
- [ ] Restart app → history empty

**Errors**
- [ ] Invalid key + Generate → toast "Invalid API key. Check Settings → AI."
- [ ] No network + Generate → friendly network error toast
- [ ] Simulated 429 → friendly rate-limit toast

**Cost display**
- [ ] After Claude generation → badge "X tokens · $Y.YYYY"
- [ ] Second Claude generation within 5 min → "(N cached)" visible
- [ ] After OpenAI generation → badge without "cached"
- [ ] Cost values non-zero (sanity)

**Persistence**
- [ ] Restart after saving Claude key → key persists, "✓ Configured" in Settings
- [ ] Restart → AI bar closed by default
- [ ] Restart → default provider/tier restored from Settings

- [ ] **Step 2: Pause for any final polish commits**

If you made small tweaks during verification (copy, spacing), group them into one commit. Suggested message: `polish(ai): verification pass`.

---

## Self-review

**Spec coverage cross-check:**

- ✅ Both Claude + OpenAI providers (Q2 = C) → Task 2 (`MODEL_MAP`, provider branching)
- ✅ Single-shot NL → SQL (Q1 = A) → AiBar single textarea + Generate
- ✅ Settings dialog + first-use modal flow (Q3 = D) → Task 5 + Task 7 (no-key CTA opens Settings)
- ✅ Inline AI bar + Ctrl+I + ✨ button (Q4 = D) → Tasks 7, 8
- ✅ Replace active tab by default + "↗ New tab" secondary button (Q5 = C) → AiBar `handleGenerate`
- ✅ Full schema with Anthropic prompt caching + OpenAI truncation (Q6 = E) → Task 2 (`_generateClaude` uses `cache_control`, `_generateOpenAI` truncates to 50)
- ✅ Streaming (Q7 = B) → Task 2 (`messages.stream`, `chat.completions.create({stream: true})`), AiBar RAF batching
- ✅ Tier-based Fast/Smart (Q8 = E) → `MODEL_MAP` and provider/tier dropdown
- ✅ Provider/tier dropdown in bar + default in Settings (Q9 = A) → Task 5 + Task 7
- ✅ AI bar toggle (Ctrl+I show, Esc hide) (Q10a = ii) → `useAiKeybindings` + `handleKeyDown` Esc branch
- ✅ Enter = submit, Shift+Enter = newline (Q10b = i) → AiBar `handleKeyDown`
- ✅ Stop button during streaming (Q10c = i) → AiBar generating-state UI
- ✅ ↑/↓ prompt history (Q10d = i) → store action + AiBar `handleKeyDown`
- ✅ Cost transparency (Q10e = i) → `_estimateCost` + lastResult badge
- ✅ Encrypted key storage via existing `credentialStore` → Task 2 + Task 3
- ✅ Hydration on app start → Task 4 Step 3
- ✅ Tab keybindings guard while AI bar open → Task 8 Step 2

**Type / signature consistency check:**

- `MODEL_MAP[provider][tier]` shape consistent everywhere
- `providerTier` format `'claude-fast'` / `'openai-smart'` consistent between AiBar state, dropdown options, and split for IPC
- IPC channel names (`ai:generate`, `ai:abort`, `ai:save-key`, `ai:has-key`, `ai:delete-key`, `ai:test-key`) match in Task 3 (main.js + preload.js) and Task 5/7 (renderer consumption)
- Store fields and setters (`aiBarOpen` / `setAiBarOpen`, `aiSettings` / `setAiSettings`, `pushAiPromptHistory`, etc.) defined in Task 4 and used identically in Tasks 5–8
- Pricing keys in `PRICING` match `MODEL_MAP` values exactly

**Placeholder scan:** No "TBD" / "TODO" / vague "implement later" markers. Each step has either complete code or precise instructions. The "implementation note" callouts in Task 2 (verify exact model strings / pricing rates) are explicit and bounded — implementer has clear action.

**Task order safety:**
- Task 1: dependency add — no behavior change
- Task 2: service file created — no consumers yet
- Task 3: IPC wired — no callers yet
- Task 4: store extensions — additive only, no breaking change
- Task 5: SettingsDialog component — created, not mounted
- Task 6: Settings becomes user-visible — first E2E user value
- Task 7: AiBar component — created, not mounted
- Task 8: AiBar becomes user-visible — full AI assistant working
- Task 9: verification

App stays runnable and visually unchanged from Task 1 to Task 5. From Task 6 onward, the user can save API keys but not yet use the AI bar. After Task 8, the full feature is live.
