// src/components/SettingsDialog.jsx
// Tabbed Settings modal. Tab "General" is a placeholder; tab "AI" manages
// provider API keys (encrypted via the OS keyring) and default provider/tier.

import { useState } from 'react'
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
    try {
      const result = await window.gamalab.ai.deleteKey(provider)
      if (result && result.ok === false) {
        showToast(result.error || `Failed to remove ${label} key`, 'error')
        return
      }
      setAiSettings({ [hasKeyField]: false })
      showToast(`${label} key removed`, 'info')
    } catch (err) {
      showToast(`Failed to remove ${label} key: ${err.message}`, 'error')
    }
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
