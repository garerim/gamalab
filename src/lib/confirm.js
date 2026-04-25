// src/lib/confirm.js
// Async confirm() helper that drives the React ConfirmDialog via the Zustand store.
// One-at-a-time concurrency: a second call while a dialog is open resolves false.

import { useAppStore } from '@/store/appStore'

let pending = null

export function confirm({
  title,
  message,
  detail = '',
  variant = 'default',          // 'default' | 'destructive'
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
} = {}) {
  if (pending) return Promise.resolve(false)

  return new Promise((resolve) => {
    pending = { resolve }
    useAppStore.getState().setConfirmDialog({
      title,
      message,
      detail,
      variant,
      confirmLabel,
      cancelLabel,
      onResolve: (result) => {
        pending = null
        useAppStore.getState().setConfirmDialog(null)
        resolve(result)
      },
    })
  })
}
