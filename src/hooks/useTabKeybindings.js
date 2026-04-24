// src/hooks/useTabKeybindings.js
import { useEffect } from 'react'
import { useAppStore } from '@/store/appStore'

export function useTabKeybindings() {
  useEffect(() => {
    const handler = (e) => {
      const viewMode = useAppStore.getState().viewMode
      if (viewMode !== 'sql') return

      const cmd = e.metaKey || e.ctrlKey
      if (!cmd) return

      const state = useAppStore.getState()
      const { queryTabs, activeTabId } = state

      // Ctrl/Cmd + T — new tab
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        state.createTab()
        return
      }

      // Ctrl/Cmd + W — close tab
      if (e.key === 'w' || e.key === 'W') {
        // Always prevent default — otherwise Electron may close the window mid-query.
        e.preventDefault()
        if (!activeTabId) return
        const tab = queryTabs.find((t) => t.id === activeTabId)
        if (!tab) return
        if (queryTabs.length <= 1 || tab.running) return
        // Empty content → close immediately; non-empty → confirm via same flow as × button
        const nonEmpty = (tab.content || '').trim().length > 0
        if (nonEmpty) {
          window.gamalab.dialog
            .confirm({
              title: `Close "${tab.title}"?`,
              message: 'You have unsaved SQL in this tab. Closing will discard it.',
              detail: 'This cannot be undone.',
            })
            .then((ok) => {
              if (ok) useAppStore.getState().closeTab(tab.id)
            })
        } else {
          state.closeTab(tab.id)
        }
        return
      }

      // Ctrl/Cmd + Tab — next tab
      if (e.key === 'Tab' && !e.shiftKey) {
        if (queryTabs.length <= 1) return
        e.preventDefault()
        const idx = queryTabs.findIndex((t) => t.id === activeTabId)
        const next = queryTabs[(idx + 1) % queryTabs.length]
        state.setActiveTabId(next.id)
        return
      }

      // Ctrl/Cmd + Shift + Tab — previous tab
      if (e.key === 'Tab' && e.shiftKey) {
        if (queryTabs.length <= 1) return
        e.preventDefault()
        const idx = queryTabs.findIndex((t) => t.id === activeTabId)
        const prev = queryTabs[(idx - 1 + queryTabs.length) % queryTabs.length]
        state.setActiveTabId(prev.id)
        return
      }

      // Ctrl/Cmd + 1..9 — jump to tab N (uses e.code for layout-independent matching)
      if (/^Digit[1-9]$/.test(e.code)) {
        const n = parseInt(e.code.slice(5), 10)
        if (n > queryTabs.length) return
        e.preventDefault()
        state.setActiveTabId(queryTabs[n - 1].id)
        return
      }
    }

    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [])
}
