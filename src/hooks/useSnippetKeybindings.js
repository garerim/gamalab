// src/hooks/useSnippetKeybindings.js
import { useEffect } from 'react'
import { useAppStore } from '@/store/appStore'

export function useSnippetKeybindings() {
  useEffect(() => {
    const handler = (e) => {
      const cmd = e.metaKey || e.ctrlKey
      if (!cmd || !e.shiftKey) return
      // Layout-independent: e.code === 'KeyP'. Fallback on e.key for safety.
      const isP = e.code === 'KeyP' || e.key === 'p' || e.key === 'P'
      if (!isP) return
      e.preventDefault()
      useAppStore.getState().setSnippetPaletteOpen(true)
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [])
}
