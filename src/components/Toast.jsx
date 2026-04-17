import { useEffect } from 'react'
import { CheckCircle2, AlertCircle, Info, XCircle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'

const ICON = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertCircle,
  info: Info,
}

const COLORS = {
  success: 'border-lab-green/40 bg-lab-green/10 text-lab-green',
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
  warning: 'border-lab-orange/40 bg-lab-orange/10 text-lab-orange',
  info: 'border-lab-blue/40 bg-lab-blue/10 text-lab-blue',
}

export function Toast() {
  const { toast, hideToast } = useAppStore()

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape' && toast) hideToast()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toast, hideToast])

  if (!toast) return null
  const Icon = ICON[toast.type] || Info

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex justify-end">
      <div
        className={cn(
          'pointer-events-auto flex max-w-sm items-start gap-2 rounded-md border bg-background px-3 py-2 text-xs shadow-lg animate-in fade-in slide-in-from-bottom-2',
          COLORS[toast.type] || COLORS.info
        )}
      >
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1 text-foreground">{toast.message}</div>
        <button
          onClick={hideToast}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
