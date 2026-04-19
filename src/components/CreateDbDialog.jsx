import { useEffect, useState } from 'react'
import { Loader2, Database } from 'lucide-react'
import { Logo } from '@/components/Logo'
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
import { useDocker } from '@/hooks/useDocker'
import { useDatabase } from '@/hooks/useDatabase'

function genName() {
  const adjectives = ['bright', 'quick', 'silent', 'cosmic', 'nimble', 'electric']
  const nouns = ['flask', 'beaker', 'lab', 'atom', 'nova', 'vial']
  return `gamalab-${adjectives[Math.floor(Math.random() * adjectives.length)]}-${
    nouns[Math.floor(Math.random() * nouns.length)]
  }`
}

const DEFAULTS = () => ({
  name: genName(),
  port: 5432,
  user: 'postgres',
  password: 'postgres',
  database: 'postgres',
  persistData: true,
})

export function CreateDbDialog() {
  const { createDialogOpen, setCreateDialogOpen, showToast } = useAppStore()
  const { createContainer } = useDocker()
  const { connect } = useDatabase()

  const [form, setForm] = useState(DEFAULTS)
  const [submitting, setSubmitting] = useState(false)
  const [portConflict, setPortConflict] = useState(false)

  useEffect(() => {
    if (createDialogOpen) {
      setForm(DEFAULTS())
      setSubmitting(false)
      setPortConflict(false)
    }
  }, [createDialogOpen])

  const setField = (key) => (e) => {
    const value = e?.target ? e.target.value : e
    setForm((f) => ({ ...f, [key]: key === 'port' ? Number(value) : value }))
  }

  const handlePortBlur = async () => {
    try {
      const free = await window.gamalab.docker.findFreePort(form.port)
      setPortConflict(free !== form.port)
    } catch {
      setPortConflict(false)
    }
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      showToast('Container name is required', 'warning')
      return
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(form.name)) {
      showToast('Name: only letters, numbers, _ and -', 'warning')
      return
    }
    if (!form.password) {
      showToast('Password is required', 'warning')
      return
    }
    if (form.port < 1024 || form.port > 65535) {
      showToast('Port must be between 1024 and 65535', 'warning')
      return
    }

    setSubmitting(true)
    try {
      const container = await createContainer(form)
      await connect({
        name: container.name,
        host: '127.0.0.1',
        port: container.port,
        user: container.user,
        password: container.password,
        database: container.database,
      })
      setCreateDialogOpen(false)
    } catch {
      // toast already shown
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={createDialogOpen} onOpenChange={(o) => !submitting && setCreateDialogOpen(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Logo className="h-5 w-5" />
            New PostgreSQL Database
          </DialogTitle>
          <DialogDescription>
            Spin up a PostgreSQL 16 container in seconds. GamaLab will auto-connect when ready.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Container name</Label>
            <Input
              id="name"
              value={form.name}
              onChange={setField('name')}
              placeholder="my-postgres"
              disabled={submitting}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="port">Port</Label>
              <Input
                id="port"
                type="number"
                min={1024}
                max={65535}
                value={form.port}
                onChange={setField('port')}
                onBlur={handlePortBlur}
                disabled={submitting}
              />
              {portConflict && (
                <span className="text-[10px] text-lab-orange">
                  Port in use — will auto-resolve
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="database">Database</Label>
              <Input
                id="database"
                value={form.database}
                onChange={setField('database')}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="user">User</Label>
              <Input
                id="user"
                value={form.user}
                onChange={setField('user')}
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="text"
                value={form.password}
                onChange={setField('password')}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="mt-2 flex items-start justify-between gap-3 rounded-md border border-border bg-muted/30 p-3">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="persist" className="flex items-center gap-1.5">
                <Database className="h-3.5 w-3.5" />
                Persist data
              </Label>
              <span className="text-[11px] text-muted-foreground">
                Mount a Docker volume so data survives restarts.
              </span>
            </div>
            <Switch
              id="persist"
              checked={form.persistData}
              onCheckedChange={(v) => setForm((f) => ({ ...f, persistData: v }))}
              disabled={submitting}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setCreateDialogOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button variant="lab" onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <Logo className="h-4 w-4" />
                Create & Connect
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
