import { useEffect, useState } from 'react'
import { Loader2, Plug, Eye, EyeOff, Cable, CheckCircle2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
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
import { useAppStore } from '@/store/appStore'
import { useDatabase } from '@/hooks/useDatabase'

const SSL_MODES = [
  { value: 'disable', label: 'Disable' },
  { value: 'prefer', label: 'Prefer' },
  { value: 'require', label: 'Require' },
  { value: 'verify-full', label: 'Verify full' },
]

function tryDecode(v) {
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

/**
 * Permissive parser for Postgres connection strings.
 * Tolerates:
 *  - `[YOUR-PASSWORD]` placeholders → left blank for the user to fill in
 *  - raw special chars in the password (e.g. `/`, `@`, `:`, `#`, `&`) because
 *    Supabase/Neon users often paste passwords without URL-encoding
 *  - missing port, missing database, missing query string
 */
function parseConnectionString(str) {
  if (!str || !str.trim()) return null
  const raw = str.trim()

  const schemeMatch = raw.match(/^postgres(?:ql)?:\/\/(.+)$/i)
  if (!schemeMatch) return null
  let s = schemeMatch[1]

  // Split on the LAST '@' so passwords containing '@' still work
  const atIdx = s.lastIndexOf('@')
  if (atIdx === -1) return null
  const credPart = s.slice(0, atIdx)
  const rest = s.slice(atIdx + 1)

  // user[:password] — split on the FIRST ':' (user cannot contain ':')
  let user = credPart
  let password = ''
  const colonIdx = credPart.indexOf(':')
  if (colonIdx !== -1) {
    user = credPart.slice(0, colonIdx)
    password = credPart.slice(colonIdx + 1)
  }
  user = tryDecode(user)
  password = tryDecode(password)

  // Strip placeholder passwords (leave blank for user input)
  if (/^\[.*\]$/.test(password.trim()) || password.trim() === '') {
    password = ''
  }

  // rest = host[:port][/dbname][?query]
  const qIdx = rest.indexOf('?')
  const beforeQuery = qIdx === -1 ? rest : rest.slice(0, qIdx)
  const query = qIdx === -1 ? '' : rest.slice(qIdx + 1)

  const slashIdx = beforeQuery.indexOf('/')
  const hostPort = slashIdx === -1 ? beforeQuery : beforeQuery.slice(0, slashIdx)
  const dbPath = slashIdx === -1 ? '' : beforeQuery.slice(slashIdx + 1)

  let host = hostPort
  let port = 5432
  const pm = hostPort.match(/^(.+):(\d+)$/)
  if (pm) {
    host = pm[1]
    port = Number(pm[2])
  }

  const database = tryDecode(dbPath) || 'postgres'

  let sslMode
  if (query) {
    const params = new URLSearchParams(query)
    const mode = (params.get('sslmode') || params.get('ssl') || '').toLowerCase()
    if (['disable', 'prefer', 'require', 'verify-full', 'verify-ca'].includes(mode)) {
      sslMode = mode === 'verify-ca' ? 'verify-full' : mode
    }
  }

  if (!host) return null
  return { host, port, user: user || 'postgres', password, database, sslMode }
}

export function ConnectRemoteDialog() {
  const { connectRemoteDialogOpen, setConnectRemoteDialogOpen, showToast } = useAppStore()
  const { connect } = useDatabase()

  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('5432')
  const [user, setUser] = useState('postgres')
  const [password, setPassword] = useState('')
  const [database, setDatabase] = useState('postgres')
  const [sslMode, setSslMode] = useState('disable')
  const [connStr, setConnStr] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  useEffect(() => {
    if (connectRemoteDialogOpen) {
      setName('')
      setHost('')
      setPort('5432')
      setUser('postgres')
      setPassword('')
      setDatabase('postgres')
      setSslMode('disable')
      setConnStr('')
      setSubmitting(false)
      setShowPassword(false)
      setTestResult(null)
      setTesting(false)
    }
  }, [connectRemoteDialogOpen])

  // Clear test banner when test-relevant fields change.
  // `name` and `connStr` are intentionally excluded — name is display-only,
  // connStr's parser re-fills the relevant fields below (transitively triggering this effect).
  useEffect(() => {
    setTestResult(null)
  }, [host, port, user, password, database, sslMode])

  const tryParseConnStr = () => {
    const parsed = parseConnectionString(connStr)
    if (!parsed) {
      showToast('Could not parse connection string', 'warning')
      return
    }
    setHost(parsed.host)
    setPort(String(parsed.port))
    setUser(parsed.user || 'postgres')
    setPassword(parsed.password || '')
    setDatabase(parsed.database || 'postgres')
    if (parsed.sslMode) setSslMode(parsed.sslMode)
    showToast(
      parsed.password
        ? 'Parsed — review and connect'
        : 'Parsed — fill in the password then connect',
      'info'
    )
  }

  const handleTest = async () => {
    if (!host.trim()) {
      showToast('Host is required', 'warning')
      return
    }
    const portNum = Number(port)
    if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
      showToast('Port must be between 1 and 65535', 'warning')
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.gamalab.db.test({
        host: host.trim(),
        port: portNum,
        user: user.trim() || 'postgres',
        password,
        database: database.trim() || 'postgres',
        sslMode,
      })
      setTestResult(result)
    } catch (err) {
      // Defensive — backend is contracted not to throw, but guard anyway
      setTestResult({ ok: false, error: err.message })
    } finally {
      setTesting(false)
    }
  }

  const handleSubmit = async () => {
    if (!host.trim()) {
      showToast('Host is required', 'warning')
      return
    }
    const portNum = Number(port)
    if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
      showToast('Port must be between 1 and 65535', 'warning')
      return
    }

    setSubmitting(true)
    try {
      const config = {
        kind: 'remote',
        name: name.trim() || `${user}@${host}:${portNum}`,
        host: host.trim(),
        port: portNum,
        user: user.trim() || 'postgres',
        password,
        database: database.trim() || 'postgres',
        sslMode,
      }
      await connect(config)
      setConnectRemoteDialogOpen(false)
    } catch {
      // showToast is triggered inside connect()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={connectRemoteDialogOpen}
      onOpenChange={(o) => !submitting && !testing && setConnectRemoteDialogOpen(o)}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cable className="h-5 w-5 text-lab-blue" />
            Connect to existing Postgres
          </DialogTitle>
          <DialogDescription>
            Connect to any PostgreSQL server (cloud, on-prem, or remote Docker).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/20 p-2.5">
            <Label htmlFor="connstr" className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Paste a connection string (optional)
            </Label>
            <div className="flex gap-1.5">
              <Input
                id="connstr"
                value={connStr}
                onChange={(e) => setConnStr(e.target.value)}
                placeholder="postgres://user:password@host:5432/db?sslmode=require"
                className="h-8 font-mono text-[11px]"
                disabled={submitting}
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={tryParseConnStr}
                disabled={submitting || !connStr.trim()}
                className="h-8 shrink-0 px-2 text-[11px]"
              >
                Parse
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rname">Name (optional)</Label>
            <Input
              id="rname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Production Supabase"
              disabled={submitting}
            />
          </div>

          <div className="grid grid-cols-[1fr_100px] gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rhost">Host</Label>
              <Input
                id="rhost"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="db.example.com"
                disabled={submitting}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rport">Port</Label>
              <Input
                id="rport"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="5432"
                disabled={submitting}
                className="tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ruser">User</Label>
              <Input
                id="ruser"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rdb">Database</Label>
              <Input
                id="rdb"
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rpass">Password</Label>
            <div className="relative">
              <Input
                id="rpass"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rssl">SSL mode</Label>
            <select
              id="rssl"
              value={sslMode}
              onChange={(e) => setSslMode(e.target.value)}
              disabled={submitting}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {SSL_MODES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {testResult && (
          <div
            className={cn(
              'flex flex-col gap-1 rounded-md border p-3 text-sm',
              testResult.ok
                ? 'border-lab-green/30 bg-lab-green/10'
                : 'border-destructive/30 bg-destructive/10'
            )}
          >
            <div className="flex items-center gap-2 font-medium">
              {testResult.ok ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-lab-green" />
                  Connected in {testResult.latencyMs} ms
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 text-destructive" />
                  Connection failed
                </>
              )}
            </div>
            {testResult.ok ? (
              <div className="text-xs text-muted-foreground">
                {testResult.version} · user "{testResult.user}" · database "{testResult.database}"
              </div>
            ) : (
              <div className="whitespace-pre-wrap break-words text-xs text-destructive">
                {testResult.error}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setConnectRemoteDialogOpen(false)}
            disabled={submitting || testing}
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={submitting || testing || !host.trim()}
          >
            {testing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Testing…
              </>
            ) : (
              <>
                <Cable className="h-4 w-4" />
                Test connection
              </>
            )}
          </Button>
          <Button
            variant="lab"
            onClick={handleSubmit}
            disabled={submitting || testing}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Connecting…
              </>
            ) : (
              <>
                <Plug className="h-4 w-4" />
                Connect
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
