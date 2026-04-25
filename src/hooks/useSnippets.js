// src/hooks/useSnippets.js
// Bridges the Zustand snippets state with the on-disk snippets.json via IPC.
// Hydrates on mount, exposes save/delete that persist to disk and update the store.

import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { confirm } from '@/lib/confirm'

function newId() {
  return (globalThis.crypto?.randomUUID?.() || Math.random().toString(36)).slice(0, 8)
}

// Module-level flag — ensures we only hit disk once per app lifetime regardless
// of how many components mount the hook. Pass { force: true } to bypass.
let hasHydrated = false

export function useSnippets() {
  const snippets = useAppStore((s) => s.snippets)
  const setSnippets = useAppStore((s) => s.setSnippets)
  const addSnippet = useAppStore((s) => s.addSnippet)
  const updateSnippet = useAppStore((s) => s.updateSnippet)
  const removeSnippet = useAppStore((s) => s.removeSnippet)
  const showToast = useAppStore((s) => s.showToast)

  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (hasHydrated && !force) return
    setLoading(true)
    try {
      const list = await window.gamalab.snippets.list()
      setSnippets(Array.isArray(list) ? list : [])
      hasHydrated = true
    } catch (err) {
      showToast(`Failed to load snippets: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [setSnippets, showToast])

  useEffect(() => {
    refresh()
  }, [refresh])

  const saveSnippet = useCallback(
    async ({ id, name, sql, description = '' }) => {
      const trimmedName = (name || '').trim()
      if (!trimmedName) {
        showToast('Name is required', 'warning')
        return null
      }
      const isNew = !id
      const now = Date.now()
      const snippet = {
        id: id || newId(),
        name: trimmedName.slice(0, 80),
        sql,
        description: (description || '').trim().slice(0, 500),
        createdAt: now, // service preserves the original on update
        updatedAt: now,
      }
      try {
        const saved = await window.gamalab.snippets.save(snippet)
        if (isNew) addSnippet(saved)
        else updateSnippet(saved.id, saved)
        showToast(isNew ? 'Snippet saved' : 'Snippet updated', 'success')
        return saved
      } catch (err) {
        showToast(`Save failed: ${err.message}`, 'error')
        return null
      }
    },
    [addSnippet, updateSnippet, showToast]
  )

  const deleteSnippet = useCallback(
    async (id) => {
      const snippet = snippets.find((s) => s.id === id)
      if (!snippet) return false
      const ok = await confirm({
        title: `Delete "${snippet.name}"?`,
        message: 'This snippet will be permanently removed.',
        detail: 'This cannot be undone.',
        variant: 'destructive',
        confirmLabel: 'Delete',
      })
      if (!ok) return false
      try {
        await window.gamalab.snippets.delete(id)
        removeSnippet(id)
        showToast('Snippet deleted', 'info')
        return true
      } catch (err) {
        showToast(`Delete failed: ${err.message}`, 'error')
        return false
      }
    },
    [snippets, removeSnippet, showToast]
  )

  return { snippets, loading, refresh, saveSnippet, deleteSnippet }
}
