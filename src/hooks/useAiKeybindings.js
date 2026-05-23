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
