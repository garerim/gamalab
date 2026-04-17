import { useEffect, useMemo, useState } from 'react'
import {
  Plus,
  Trash2,
  Key,
  Table as TableIcon,
  Loader2,
  Code2,
  GripVertical,
} from 'lucide-react'
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
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { useDatabase } from '@/hooks/useDatabase'

const PG_TYPES = [
  { group: 'Numeric', types: ['serial', 'bigserial', 'smallint', 'integer', 'bigint', 'real', 'double precision', 'numeric'] },
  { group: 'Text', types: ['text', 'varchar', 'char'] },
  { group: 'Boolean', types: ['boolean'] },
  { group: 'Date & Time', types: ['date', 'time', 'timestamp', 'timestamptz', 'interval'] },
  { group: 'JSON', types: ['json', 'jsonb'] },
  { group: 'UUID', types: ['uuid'] },
  { group: 'Binary', types: ['bytea'] },
]

const ALL_TYPES = PG_TYPES.flatMap((g) => g.types)
const AUTO_TYPES = new Set(['serial', 'bigserial'])

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"'
}

function newColumn(overrides = {}) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    type: 'text',
    length: '',
    nullable: true,
    primaryKey: false,
    unique: false,
    defaultValue: '',
    ...overrides,
  }
}

function buildCreateSql(schema, name, columns) {
  if (!name) return ''
  const colLines = columns
    .filter((c) => c.name.trim())
    .map((c) => {
      const parts = [quoteIdent(c.name)]
      let type = c.type
      if (['varchar', 'char'].includes(type) && c.length) {
        type = `${type}(${parseInt(c.length, 10) || 255})`
      }
      parts.push(type)
      if (c.primaryKey) parts.push('PRIMARY KEY')
      if (!c.nullable && !c.primaryKey) parts.push('NOT NULL')
      if (c.unique && !c.primaryKey) parts.push('UNIQUE')
      if (c.defaultValue) parts.push(`DEFAULT ${c.defaultValue}`)
      return '  ' + parts.join(' ')
    })
  return `CREATE TABLE ${quoteIdent(schema || 'public')}.${quoteIdent(name)} (\n${colLines.join(',\n')}\n);`
}

export function CreateTableDialog() {
  const {
    createTableDialogOpen,
    setCreateTableDialogOpen,
    showToast,
    bumpTablesRefresh,
    setSidebarTab,
  } = useAppStore()
  const { activeConnection } = useDatabase()

  const [schema, setSchema] = useState('public')
  const [tableName, setTableName] = useState('')
  const [columns, setColumns] = useState([
    newColumn({ name: 'id', type: 'serial', primaryKey: true, nullable: false }),
    newColumn({ name: 'created_at', type: 'timestamptz', nullable: false, defaultValue: 'now()' }),
  ])
  const [submitting, setSubmitting] = useState(false)
  const [showSql, setShowSql] = useState(false)

  useEffect(() => {
    if (createTableDialogOpen) {
      setSchema('public')
      setTableName('')
      setColumns([
        newColumn({ name: 'id', type: 'serial', primaryKey: true, nullable: false }),
        newColumn({ name: 'created_at', type: 'timestamptz', nullable: false, defaultValue: 'now()' }),
      ])
      setSubmitting(false)
      setShowSql(false)
    }
  }, [createTableDialogOpen])

  const updateCol = (id, patch) => {
    setColumns((cols) => cols.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  const removeCol = (id) => {
    setColumns((cols) => cols.filter((c) => c.id !== id))
  }

  const addCol = () => {
    setColumns((cols) => [...cols, newColumn()])
  }

  const togglePrimaryKey = (id) => {
    setColumns((cols) =>
      cols.map((c) =>
        c.id === id
          ? { ...c, primaryKey: !c.primaryKey, nullable: c.primaryKey ? c.nullable : false }
          : c
      )
    )
  }

  const sql = useMemo(() => buildCreateSql(schema, tableName, columns), [schema, tableName, columns])

  const handleSubmit = async () => {
    if (!activeConnection) {
      showToast('Connect to a database first', 'warning')
      return
    }
    if (!tableName.trim()) {
      showToast('Table name is required', 'warning')
      return
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      showToast('Invalid table name', 'warning')
      return
    }
    if (columns.filter((c) => c.name.trim()).length === 0) {
      showToast('At least one column is required', 'warning')
      return
    }
    for (const c of columns) {
      if (c.name.trim() && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c.name)) {
        showToast(`Invalid column name: ${c.name}`, 'warning')
        return
      }
    }

    setSubmitting(true)
    try {
      await window.gamalab.db.query(activeConnection.id, sql)
      showToast(`Table "${tableName}" created`, 'success')
      bumpTablesRefresh()
      setSidebarTab('tables')
      setCreateTableDialogOpen(false)
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={createTableDialogOpen}
      onOpenChange={(o) => !submitting && setCreateTableDialogOpen(o)}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TableIcon className="h-5 w-5 text-lab-blue" />
            New Table
          </DialogTitle>
          <DialogDescription>
            Design your table visually. GamaLab generates the CREATE TABLE for you.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="schema">Schema</Label>
              <Input
                id="schema"
                value={schema}
                onChange={(e) => setSchema(e.target.value)}
                placeholder="public"
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tname">Table name</Label>
              <Input
                id="tname"
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                placeholder="users"
                autoFocus
                disabled={submitting}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Columns ({columns.length})
              </Label>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                onClick={() => setShowSql((s) => !s)}
              >
                <Code2 className="h-3 w-3" />
                {showSql ? 'Hide SQL' : 'Preview SQL'}
              </Button>
            </div>

            <div className="rounded-md border border-border bg-muted/20">
              <div className="grid grid-cols-[20px_1fr_1fr_70px_60px_60px_60px_1fr_28px] gap-1 border-b border-border bg-muted/40 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span />
                <span>Name</span>
                <span>Type</span>
                <span>Len</span>
                <span className="text-center">PK</span>
                <span className="text-center">NULL</span>
                <span className="text-center">UNIQ</span>
                <span>Default</span>
                <span />
              </div>
              <div className="flex flex-col">
                {columns.map((col) => {
                  const needsLength = ['varchar', 'char'].includes(col.type)
                  return (
                    <div
                      key={col.id}
                      className={cn(
                        'grid grid-cols-[20px_1fr_1fr_70px_60px_60px_60px_1fr_28px] gap-1 border-b border-border px-2 py-1.5 text-xs last:border-b-0',
                        col.primaryKey && 'bg-lab-orange/5'
                      )}
                    >
                      <div className="flex items-center justify-center text-muted-foreground">
                        {col.primaryKey ? (
                          <Key className="h-3 w-3 text-lab-orange" />
                        ) : (
                          <GripVertical className="h-3 w-3 opacity-40" />
                        )}
                      </div>
                      <Input
                        value={col.name}
                        onChange={(e) => updateCol(col.id, { name: e.target.value })}
                        placeholder="column_name"
                        className="h-7 text-xs"
                        disabled={submitting}
                      />
                      <select
                        value={col.type}
                        onChange={(e) => updateCol(col.id, { type: e.target.value })}
                        disabled={submitting}
                        className="h-7 rounded border border-input bg-background px-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        {PG_TYPES.map((g) => (
                          <optgroup key={g.group} label={g.group}>
                            {g.types.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <Input
                        value={col.length}
                        onChange={(e) => updateCol(col.id, { length: e.target.value })}
                        placeholder="255"
                        disabled={submitting || !needsLength}
                        className="h-7 text-xs tabular-nums"
                      />
                      <button
                        onClick={() => togglePrimaryKey(col.id)}
                        disabled={submitting}
                        className={cn(
                          'flex items-center justify-center rounded transition-colors',
                          col.primaryKey
                            ? 'text-lab-orange'
                            : 'text-muted-foreground/50 hover:text-foreground'
                        )}
                        title="Primary key"
                      >
                        <input
                          type="checkbox"
                          checked={col.primaryKey}
                          onChange={() => togglePrimaryKey(col.id)}
                          className="h-3.5 w-3.5 accent-lab-orange"
                        />
                      </button>
                      <div className="flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={col.nullable}
                          disabled={submitting || col.primaryKey || AUTO_TYPES.has(col.type)}
                          onChange={(e) => updateCol(col.id, { nullable: e.target.checked })}
                          className="h-3.5 w-3.5 accent-lab-blue"
                          title={col.primaryKey ? 'PK cannot be NULL' : 'Allow NULL'}
                        />
                      </div>
                      <div className="flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={col.unique}
                          disabled={submitting || col.primaryKey}
                          onChange={(e) => updateCol(col.id, { unique: e.target.checked })}
                          className="h-3.5 w-3.5 accent-lab-green"
                          title="Unique"
                        />
                      </div>
                      <Input
                        value={col.defaultValue}
                        onChange={(e) => updateCol(col.id, { defaultValue: e.target.value })}
                        placeholder="now(), 'x', 0"
                        className="h-7 font-mono text-[11px]"
                        disabled={submitting}
                      />
                      <Button
                        size="iconSm"
                        variant="ghost"
                        onClick={() => removeCol(col.id)}
                        disabled={submitting || columns.length === 1}
                        className="h-7 w-7 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )
                })}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={addCol}
                disabled={submitting}
                className="w-full justify-start rounded-none text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3 w-3" />
                Add column
              </Button>
            </div>
          </div>

          {showSql && (
            <div className="rounded-md border border-border bg-background p-3">
              <pre className="whitespace-pre-wrap font-mono text-[11px] text-foreground/90">
                {sql || '-- Fill in the table name and at least one column'}
              </pre>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <Badge variant="info">{columns.length} columns</Badge>
            {columns.some((c) => c.primaryKey) && (
              <Badge variant="warning">
                PK: {columns.filter((c) => c.primaryKey).map((c) => c.name).join(', ')}
              </Badge>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setCreateTableDialogOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button variant="lab" onClick={handleSubmit} disabled={submitting || !activeConnection}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <TableIcon className="h-4 w-4" />
                Create Table
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
