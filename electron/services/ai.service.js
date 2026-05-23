// electron/services/ai.service.js
// Provider-agnostic AI service. Handles Claude + OpenAI streaming generation,
// AbortController lifecycle, key load/decrypt via credentialStore, and cost
// estimation. Never throws after the initial validation - all errors flow
// through the onError callback.

const { Anthropic } = require('@anthropic-ai/sdk')
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
The user describes what they want; you respond with ONLY the SQL statement(s) - no markdown fences, no explanations, no comments unless the user explicitly asks for them.
Use the provided database schema as the source of truth for table and column names.
Prefer readable, well-formatted SQL with appropriate whitespace.
If the user's request is ambiguous, make a reasonable choice and produce working SQL - they can edit it.`

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
      // accessed via the store.service module.
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
      onError({ message: `No ${provider === 'claude' ? 'Claude' : 'OpenAI'} API key configured. Open Settings -> AI.` })
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
      return 'Invalid API key. Check Settings -> AI.'
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
