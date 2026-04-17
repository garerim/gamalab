import { useEffect, useState } from 'react'
import { Database, Loader2, Server } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAppStore } from '@/store/appStore'
import { useDatabase } from '@/hooks/useDatabase'

export function NewLogicalDbDialog() {
  const { newLogicalDbDialogOpen, setNewLogicalDbDialogOpen, showToast } = useAppStore()
  const { activeConnection, connect } = useDatabase()

  const [name, setName] = useState('')
  const [autoConnect, setAutoConnect] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (newLogicalDbDialogOpen) {
      setName('')
      setAutoConnect(true)
      setSubmitting(false)
    }
  }, [newLogicalDbDialogOpen])

  const handleSubmit = async () => {
    if (!activeConnection) {
      showToast('Connect to a server first', 'warning')
      return
    }
    const dbName = name.trim()
    if (!dbName) {
      showToast('Database name is required', 'warning')
      return
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
      showToast('Name must start with a letter/_ and contain only letters, digits, _', 'warning')
      return
    }

    setSubmitting(true)
    try {
      await window.gamalab.db.createDatabase(activeConnection.id, dbName, {})
      showToast(`Database "${dbName}" created`, 'success')

      if (autoConnect) {
        await connect({
          name: `${activeConnection.name || activeConnection.host}/${dbName}`,
          host: activeConnection.host,
          port: activeConnection.port,
          user: activeConnection.user,
          password: activeConnection.password,
          database: dbName,
        })
      }
      setNewLogicalDbDialogOpen(false)
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const serverLabel = activeConnection
    ? `${activeConnection.host}:${activeConnection.port}`
    : '—'

  return (
    <Dialog
      open={newLogicalDbDialogOpen}
      onOpenChange={(o) => !submitting && setNewLogicalDbDialogOpen(o)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-lab-blue" />
            New Database
          </DialogTitle>
          <DialogDescription>
            Create a new PostgreSQL database inside the current server. Same container, isolated data.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
            <Server className="h-3.5 w-3.5 text-lab-blue" />
            <span className="text-muted-foreground">Server</span>
            <span className="font-mono font-medium">{serverLabel}</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="db-name">Database name</Label>
            <Input
              id="db-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my_app_db"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !submitting) handleSubmit()
              }}
              disabled={submitting}
            />
            <span className="text-[10px] text-muted-foreground">
              Letters, digits, underscore. Must start with a letter or underscore.
            </span>
          </div>

          <div className="mt-2 flex items-start justify-between gap-3 rounded-md border border-border bg-muted/30 p-3">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="autoconnect">Connect immediately</Label>
              <span className="text-[11px] text-muted-foreground">
                Open a new connection pointing to the new database.
              </span>
            </div>
            <Switch
              id="autoconnect"
              checked={autoConnect}
              onCheckedChange={setAutoConnect}
              disabled={submitting}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setNewLogicalDbDialogOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            variant="lab"
            onClick={handleSubmit}
            disabled={submitting || !activeConnection}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <Database className="h-4 w-4" />
                Create Database
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
