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
import { useAppStore } from '@/store/appStore'
import { useSchemaInfo } from '@/hooks/useSchemaInfo'

// Strip markdown code fences from AI output. The system prompt tells the
// model to emit raw SQL, but it sometimes wraps in ```sql ... ``` anyway.
// Streaming-safe: strips leading fence as soon as it's complete, and
// trailing fence at any stage. Doesn't touch backticks elsewhere in the SQL.
function stripCodeFences(text) {
  if (!text) return text
  // Leading: ```sql\n or ```\n (case-insensitive, optional whitespace before)
  let result = text.replace(/^\s*```(?:sql|postgresql|postgres)?\s*\n?/i, '')
  // Trailing: ``` possibly preceded by newline and followed by whitespace
  result = result.replace(/\n?\s*```\s*$/i, '')
  return result
}

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
      if (tabId) updateTabContent(tabId, stripCodeFences(pendingTextRef.current))
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
      if (tabId) updateTabContent(tabId, stripCodeFences(fullText))
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

    try {
      await window.gamalab.ai.generate({
        prompt: prompt.trim(),
        provider,
        tier,
        schemaInfo,
      })
    } catch (err) {
      setGenerating(false)
      showToast(`AI generation failed to start: ${err.message}`, 'error')
    }
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
