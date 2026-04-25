// src/components/ConfirmDialog.jsx
// Renders a modal driven by the store's confirmDialog payload.
// Variant-aware: 'destructive' shows a red trash icon and red Confirm button + focuses Cancel by default.
// 'default' shows a yellow warning icon and a default Confirm button + focuses Confirm by default.

import { useEffect, useRef } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'

export function ConfirmDialog() {
  const dialog = useAppStore((s) => s.confirmDialog)

  const cancelRef = useRef(null)
  const confirmRef = useRef(null)

  const isDestructive = dialog?.variant === 'destructive'

  useEffect(() => {
    if (!dialog) return
    // Variant-aware default focus: destructive -> cancel; default -> confirm.
    const target = isDestructive ? cancelRef.current : confirmRef.current
    target?.focus()
  }, [dialog, isDestructive])

  if (!dialog) return null

  const { title, message, detail, confirmLabel, cancelLabel, onResolve } = dialog
  const Icon = isDestructive ? Trash2 : AlertTriangle
  const iconClass = isDestructive ? 'text-destructive' : 'text-yellow-500'
  const confirmVariant = isDestructive ? 'destructive' : 'default'

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onResolve(false)
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', iconClass)} />
            <DialogTitle>{title}</DialogTitle>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-2 pl-8 text-sm">
          {message && <p>{message}</p>}
          {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
        </div>

        <DialogFooter>
          <Button
            ref={cancelRef}
            variant="ghost"
            onClick={() => onResolve(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={confirmVariant}
            onClick={() => onResolve(true)}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
