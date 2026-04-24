import { Download, RefreshCw, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useAppStore } from '@/store/appStore'

export function SchemaToolbar({ schemas, onAutoLayout, onExportPng }) {
  const schemaFilter = useAppStore((s) => s.schemaFilter)
  const setSchemaFilter = useAppStore((s) => s.setSchemaFilter)
  const exactRowCounts = useAppStore((s) => s.exactRowCounts)
  const toggleExactRowCounts = useAppStore((s) => s.toggleExactRowCounts)
  const bumpSchemaRefresh = useAppStore((s) => s.bumpSchemaRefresh)

  return (
    <div className="flex h-10 flex-none items-center gap-3 border-b border-border bg-card px-3">
      <div className="flex items-center gap-1.5">
        <Label htmlFor="schema-filter" className="text-xs text-muted-foreground">
          Schema:
        </Label>
        <select
          id="schema-filter"
          value={schemaFilter}
          onChange={(e) => setSchemaFilter(e.target.value)}
          className="h-7 rounded border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="all">All schemas</option>
          {schemas.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="h-5 w-px bg-border" />

      <Button size="sm" variant="ghost" onClick={onAutoLayout} title="Reset layout">
        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
        Auto-layout
      </Button>

      <Button size="sm" variant="ghost" onClick={bumpSchemaRefresh} title="Refresh schema">
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        Refresh
      </Button>

      <div className="flex items-center gap-1.5">
        <Switch
          id="exact-counts"
          checked={exactRowCounts}
          onCheckedChange={toggleExactRowCounts}
        />
        <Label htmlFor="exact-counts" className="cursor-pointer text-xs text-muted-foreground">
          Exact counts
        </Label>
      </div>

      <div className="ml-auto">
        <Button size="sm" variant="ghost" onClick={onExportPng} title="Export as PNG">
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export PNG
        </Button>
      </div>
    </div>
  )
}
