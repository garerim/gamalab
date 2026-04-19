import { useState } from 'react'
import { AlertTriangle, RotateCcw, RefreshCw, Trash2, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ErrorScreen({ error, info, onReset, onReload, onHardReset }) {
  const [copied, setCopied] = useState(false)

  const stack = error?.stack || String(error)
  const componentStack = info?.componentStack || ''
  const fullReport = `${error?.message || 'Unknown error'}\n\n${stack}\n${componentStack}`

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(fullReport)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="flex w-full max-w-2xl flex-col gap-4 rounded-lg border border-destructive/30 bg-card p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              GamaLab caught an unexpected error. Your data is safe — try one of the
              recovery options below.
            </p>
          </div>
        </div>

        <div className="rounded-md border border-border bg-muted/20 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Error details
            </span>
            <button
              onClick={copyReport}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  Copy
                </>
              )}
            </button>
          </div>
          <div className="font-mono text-xs font-semibold text-destructive">
            {error?.message || 'Unknown error'}
          </div>
          {stack && (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] text-muted-foreground">
              {stack}
            </pre>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Button variant="lab" onClick={onReset}>
            <RotateCcw className="h-4 w-4" />
            Try again
          </Button>
          <Button variant="ghost" onClick={onReload}>
            <RefreshCw className="h-4 w-4" />
            Reload window
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              if (
                window.confirm(
                  'This will erase saved connections, query history, and onboarding state. Continue?'
                )
              ) {
                onHardReset()
              }
            }}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            Reset all app state
          </Button>
        </div>
      </div>
    </div>
  )
}
