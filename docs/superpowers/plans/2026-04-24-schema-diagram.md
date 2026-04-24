# Schema Diagram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an ER-style schema diagram view to GamaLab as a new Sidebar tab — renders tables of the active database as draggable, zoomable nodes with columns/types/keys and foreign-key edges.

**Architecture:** Electron main-process service (`db.service.getFullSchema`) + new IPC channels → React renderer with `@xyflow/react` for pan/zoom/nodes/edges + `@dagrejs/dagre` for initial auto-layout + `html-to-image` for PNG export. Drag positions persist per DB via a dedicated `electron-store` file (`gamalab-layouts.json`).

**Tech Stack:** Electron 28, React 18, Zustand 4, `@xyflow/react` 12, `@dagrejs/dagre` 1, `html-to-image` 1, `electron-store` 8 (already in deps), `pg` 8 (already in deps), Tailwind.

**Reference spec:** [docs/superpowers/specs/2026-04-24-schema-diagram-design.md](../specs/2026-04-24-schema-diagram-design.md). Re-read it before implementation.

**No automated tests.** The project has no test framework (verified in `package.json`). Each task ends with a manual verification step, then a commit. Do NOT introduce a test framework — match existing conventions.

---

## Task 1: Install dependencies and update .gitignore

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `.gitignore`

- [ ] **Step 1: Install runtime dependencies**

Run from repo root:
```bash
npm install @xyflow/react@^12 @dagrejs/dagre@^1 html-to-image@^1.11
```

Expected: three new entries appear under `dependencies` in `package.json`. `package-lock.json` updates. No peer-dependency warnings that block install.

- [ ] **Step 2: Add .superpowers/ to .gitignore**

Append to `.gitignore` (after the `.env*` block at the bottom):

```
# Brainstorming session artifacts (visual companion)
.superpowers/

# Feature spec & plan artifacts are committed — only the session runtime is ignored
```

- [ ] **Step 3: Verify install**

Run:
```bash
npm run dev
```

Expected: Vite starts on 5173, Electron window opens, no module-not-found errors in the Electron DevTools console. The app is visually identical to before (we haven't used the new deps yet).

Stop with `Ctrl+C`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "feat(schema-diagram): add @xyflow/react, @dagrejs/dagre, html-to-image deps"
```

---

## Task 2: Extend Zustand store with schema-diagram state

**Files:**
- Modify: `src/store/appStore.js`

- [ ] **Step 1: Add new state fields and setters**

In `src/store/appStore.js`, inside the `create((set, get) => ({ ... }))` object:

Add these fields in the UI state block (after `activeTable: null,`):

```js
  // Schema diagram
  schemaFilter: 'all',        // 'all' or a schema name like 'public'
  selectedEdgeId: null,       // id of the currently-highlighted FK edge, or null
  exactRowCounts: false,      // false = reltuples estimate, true = COUNT(*)
  schemaRefreshToken: 0,      // bump to force useFullSchema to re-fetch
```

Add these setters in the setters block (after `setActiveTable`):

```js
  setSchemaFilter: (name) => set({ schemaFilter: name || 'all' }),
  setSelectedEdgeId: (id) => set({ selectedEdgeId: id }),
  toggleExactRowCounts: () => set({ exactRowCounts: !get().exactRowCounts }),
  bumpSchemaRefresh: () => set({ schemaRefreshToken: get().schemaRefreshToken + 1 }),
```

- [ ] **Step 2: Reset schema UI state on connection switch**

Find the existing `setActiveConnectionId` setter and extend the reset branch. Replace:

```js
  setActiveConnectionId: (id) => {
    if (id !== get().activeConnectionId) {
      set({
        activeConnectionId: id,
        activeTable: null,
        viewMode: 'sql',
        queryResult: null,
        queryError: null,
      })
    } else {
      set({ activeConnectionId: id })
    }
  },
```

With:

```js
  setActiveConnectionId: (id) => {
    if (id !== get().activeConnectionId) {
      set({
        activeConnectionId: id,
        activeTable: null,
        viewMode: 'sql',
        queryResult: null,
        queryError: null,
        schemaFilter: 'all',
        selectedEdgeId: null,
      })
    } else {
      set({ activeConnectionId: id })
    }
  },
```

- [ ] **Step 3: Verify in DevTools**

Run `npm run dev`. In Electron DevTools console:

```js
useAppStore = window.__debugStore || (() => { const s = require('@/store/appStore').useAppStore; window.__debugStore = s; return s })()
```

Actually — simpler check without attaching to window. Connect to any DB, then in React DevTools inspect the store state or run in DevTools console:

```js
// The store is accessible via any React component using it — test via UI:
// 1. Open Docker tab, create a DB, connect.
// 2. Disconnect/switch connections — viewMode should reset to 'sql'. No runtime errors.
```

Expected: app loads, no console errors about undefined `schemaFilter`/`selectedEdgeId`. Switching connections still works as before.

- [ ] **Step 4: Commit**

```bash
git add src/store/appStore.js
git commit -m "feat(schema-diagram): extend appStore with schema view state"
```

---

## Task 3: Add `listFullSchema` method to db.service

**Files:**
- Modify: `electron/services/db.service.js`

- [ ] **Step 1: Add the method**

Open `electron/services/db.service.js`. After the existing `listSchemaInfo(id)` method (which currently ends around line 444, right before `async exportRows(...)`), insert this new method:

```js
  /**
   * One-shot schema dump used by the Schema Diagram view.
   * Returns tables + columns + PK/UQ/FK flags + indexes + row counts.
   *
   * @param {string} id - connection id
   * @param {{ exactCounts?: boolean }} opts
   * @returns {Promise<{tables: Array, columns: Array, indexes: Array}>}
   */
  async listFullSchema(id, { exactCounts = false } = {}) {
    const pool = this.pools.get(id)
    if (!pool) throw new Error('No active connection')

    // Run all metadata queries in parallel — they're independent.
    const [tablesRes, columnsRes, pksRes, fksRes, uqsRes, indexesRes, estCountsRes] =
      await Promise.all([
        // 1) Tables (user schemas only)
        pool.query(
          `SELECT schemaname AS schema, tablename AS name
           FROM pg_tables
           WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
             AND schemaname NOT LIKE 'pg_%'
           ORDER BY schemaname, tablename`
        ),
        // 2) Columns with type info
        pool.query(
          `SELECT
             c.table_schema AS schema,
             c.table_name   AS table_name,
             c.column_name  AS name,
             c.data_type    AS data_type,
             c.udt_name     AS udt_name,
             c.is_nullable = 'YES' AS nullable,
             c.column_default AS default_value,
             c.character_maximum_length AS max_length,
             c.ordinal_position AS position
           FROM information_schema.columns c
           JOIN information_schema.tables t
             ON t.table_schema = c.table_schema AND t.table_name = c.table_name
           WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
             AND c.table_schema NOT LIKE 'pg_%'
             AND t.table_type = 'BASE TABLE'
           ORDER BY c.table_schema, c.table_name, c.ordinal_position`
        ),
        // 3) Primary keys
        pool.query(
          `SELECT tns.nspname AS schema, t.relname AS table_name, a.attname AS column_name
           FROM pg_constraint con
           JOIN pg_class t ON t.oid = con.conrelid
           JOIN pg_namespace tns ON tns.oid = t.relnamespace
           JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
           JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
           WHERE con.contype = 'p'
             AND tns.nspname NOT IN ('pg_catalog', 'information_schema')
             AND tns.nspname NOT LIKE 'pg_%'`
        ),
        // 4) Foreign keys (single-column; composite rendered as single edge on 1st col)
        pool.query(
          `SELECT
             tns.nspname AS schema,
             t.relname AS table_name,
             a.attname AS column_name,
             fns.nspname AS target_schema,
             ft.relname AS target_table,
             fa.attname AS target_column,
             con.confdeltype AS on_delete,
             con.confupdtype AS on_update
           FROM pg_constraint con
           JOIN pg_class t ON t.oid = con.conrelid
           JOIN pg_namespace tns ON tns.oid = t.relnamespace
           JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
           JOIN pg_class ft ON ft.oid = con.confrelid
           JOIN pg_namespace fns ON fns.oid = ft.relnamespace
           JOIN pg_attribute fa ON fa.attrelid = con.confrelid AND fa.attnum = con.confkey[1]
           WHERE con.contype = 'f'
             AND tns.nspname NOT IN ('pg_catalog', 'information_schema')
             AND tns.nspname NOT LIKE 'pg_%'`
        ),
        // 5) Unique constraints (single-column)
        pool.query(
          `SELECT tns.nspname AS schema, t.relname AS table_name, a.attname AS column_name
           FROM pg_constraint con
           JOIN pg_class t ON t.oid = con.conrelid
           JOIN pg_namespace tns ON tns.oid = t.relnamespace
           JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
           WHERE con.contype = 'u'
             AND cardinality(con.conkey) = 1
             AND tns.nspname NOT IN ('pg_catalog', 'information_schema')
             AND tns.nspname NOT LIKE 'pg_%'`
        ),
        // 6) Indexes — exclude those backing PK / UQ constraints
        pool.query(
          `SELECT
             ns.nspname AS schema,
             t.relname AS table_name,
             i.relname AS name,
             ix.indisunique AS is_unique,
             ARRAY(
               SELECT a.attname
               FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
               ORDER BY k.ord
             ) AS columns
           FROM pg_index ix
           JOIN pg_class i ON i.oid = ix.indexrelid
           JOIN pg_class t ON t.oid = ix.indrelid
           JOIN pg_namespace ns ON ns.oid = t.relnamespace
           WHERE NOT ix.indisprimary
             AND NOT EXISTS (
               SELECT 1 FROM pg_constraint con
               WHERE con.conindid = ix.indexrelid AND con.contype = 'u'
             )
             AND ns.nspname NOT IN ('pg_catalog', 'information_schema')
             AND ns.nspname NOT LIKE 'pg_%'`
        ),
        // 7) Estimated row counts (always — fast, used as fallback even when exactCounts=true)
        pool.query(
          `SELECT ns.nspname AS schema, c.relname AS name, c.reltuples::bigint AS est
           FROM pg_class c
           JOIN pg_namespace ns ON ns.oid = c.relnamespace
           WHERE c.relkind = 'r'
             AND ns.nspname NOT IN ('pg_catalog', 'information_schema')
             AND ns.nspname NOT LIKE 'pg_%'`
        ),
      ])

    // Build lookup sets for quick membership tests
    const pkSet = new Set(pksRes.rows.map((r) => `${r.schema}.${r.table_name}.${r.column_name}`))
    const uqSet = new Set(uqsRes.rows.map((r) => `${r.schema}.${r.table_name}.${r.column_name}`))
    const fkMap = new Map()
    for (const r of fksRes.rows) {
      const key = `${r.schema}.${r.table_name}.${r.column_name}`
      fkMap.set(key, {
        targetTable: `${r.target_schema}.${r.target_table}`,
        targetColumn: r.target_column,
        onDelete: decodeFkAction(r.on_delete),
        onUpdate: decodeFkAction(r.on_update),
      })
    }

    // Row counts — estimate always available; exact overrides per-table if requested
    const countByKey = new Map()
    for (const r of estCountsRes.rows) {
      countByKey.set(`${r.schema}.${r.name}`, { rowCount: Number(r.est), isEstimate: true })
    }

    if (exactCounts) {
      // One UNION ALL query to get COUNT(*) for every table — single round-trip.
      if (tablesRes.rows.length > 0) {
        const parts = tablesRes.rows.map(
          (t) =>
            `SELECT ${pool.escapeLiteral ? pool.escapeLiteral(t.schema) : `'${t.schema}'`} AS s, ` +
            `${pool.escapeLiteral ? pool.escapeLiteral(t.name) : `'${t.name}'`} AS n, ` +
            `(SELECT COUNT(*)::bigint FROM ${this._qi(t.schema)}.${this._qi(t.name)}) AS c`
        )
        const { rows: exactRows } = await pool.query(parts.join(' UNION ALL '))
        for (const r of exactRows) {
          countByKey.set(`${r.s}.${r.n}`, { rowCount: Number(r.c), isEstimate: false })
        }
      }
    }

    // Shape the final response
    const tables = tablesRes.rows.map((t) => {
      const { rowCount = 0, isEstimate = true } = countByKey.get(`${t.schema}.${t.name}`) || {}
      return { schema: t.schema, name: t.name, rowCount, isEstimate }
    })

    const columns = columnsRes.rows.map((c) => {
      const key = `${c.schema}.${c.table_name}.${c.name}`
      const fk = fkMap.get(key) || null
      // Normalize type string: prefer udt for e.g. int4, varchar; append length when relevant
      let type = c.udt_name || c.data_type
      if (c.max_length && typeof c.max_length === 'number') type += `(${c.max_length})`
      return {
        tableKey: `${c.schema}.${c.table_name}`,
        name: c.name,
        type,
        nullable: !!c.nullable,
        default: c.default_value,
        isPrimary: pkSet.has(key),
        isUnique: uqSet.has(key),
        foreignKey: fk,
        maxLength: c.max_length || null,
      }
    })

    const indexes = indexesRes.rows.map((i) => ({
      tableKey: `${i.schema}.${i.table_name}`,
      name: i.name,
      columns: i.columns,
      isUnique: !!i.is_unique,
    }))

    return { tables, columns, indexes }
  }
```

- [ ] **Step 2: Add the `decodeFkAction` helper**

At the top of `db.service.js` (after the `require` block, before the `class DbService` declaration), add:

```js
function decodeFkAction(code) {
  switch (code) {
    case 'a': return 'NO ACTION'
    case 'r': return 'RESTRICT'
    case 'c': return 'CASCADE'
    case 'n': return 'SET NULL'
    case 'd': return 'SET DEFAULT'
    default: return 'NO ACTION'
  }
}
```

- [ ] **Step 3: Manual verification via DevTools (after Task 5 wires IPC)**

This method is not callable from the renderer yet — IPC isn't wired. Verification happens in Task 5.

- [ ] **Step 4: Commit**

```bash
git add electron/services/db.service.js
git commit -m "feat(schema-diagram): add DbService.listFullSchema"
```

---

## Task 4: Create layoutStore service

**Files:**
- Create: `electron/services/layoutStore.service.js`

- [ ] **Step 1: Write the service**

Create `electron/services/layoutStore.service.js`:

```js
const Store = require('electron-store')

/**
 * Stores node positions for the Schema Diagram view, keyed by
 * `<connectionId>::<dbName>`. Positions are not sensitive — no encryption.
 *
 * On-disk file: gamalab-layouts.json in the Electron userData directory,
 * separate from the main config store.
 */
const store = new Store({
  name: 'gamalab-layouts',
  defaults: {},
})

const key = (connectionId, dbName) => `${connectionId}::${dbName}`

module.exports = {
  /**
   * @returns {Record<string, {x:number, y:number}>} - map of nodeId -> position
   */
  getPositions(connectionId, dbName) {
    if (!connectionId || !dbName) return {}
    return store.get(key(connectionId, dbName), {}) || {}
  },

  setPosition(connectionId, dbName, nodeId, pos) {
    if (!connectionId || !dbName || !nodeId) return
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return
    const k = key(connectionId, dbName)
    const current = store.get(k, {}) || {}
    store.set(k, { ...current, [nodeId]: { x: pos.x, y: pos.y } })
  },

  clearPositions(connectionId, dbName) {
    if (!connectionId || !dbName) return
    store.delete(key(connectionId, dbName))
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/services/layoutStore.service.js
git commit -m "feat(schema-diagram): add layoutStore service for persisted node positions"
```

---

## Task 5: Wire IPC handlers and preload bindings

**Files:**
- Modify: `electron/main.js`
- Modify: `electron/preload.js`

- [ ] **Step 1: Register new IPC handlers in main.js**

Open `electron/main.js`. Near the top, add the require for the new service after the existing `credentialStore` require:

```js
const layoutStore = require('./services/layoutStore.service')
```

After the existing `db:list-schema-info` handler block, insert:

```js
ipcMain.handle('schema:get-full', async (_evt, id, opts) => {
  return await dbService.listFullSchema(id, opts || {})
})

ipcMain.handle('layout:get', (_evt, connectionId, dbName) => {
  return layoutStore.getPositions(connectionId, dbName)
})

ipcMain.handle('layout:set', (_evt, connectionId, dbName, nodeId, pos) => {
  layoutStore.setPosition(connectionId, dbName, nodeId, pos)
  return true
})

ipcMain.handle('layout:clear', (_evt, connectionId, dbName) => {
  layoutStore.clearPositions(connectionId, dbName)
  return true
})

ipcMain.handle('dialog:save-png', async (_evt, { defaultPath, dataUrl }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultPath || 'schema.png',
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  // dataUrl is a base64 "data:image/png;base64,..." string from html-to-image toPng()
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl || '')
  if (!match) throw new Error('Invalid PNG data URL')
  const buf = Buffer.from(match[1], 'base64')
  await fs.writeFile(result.filePath, buf)
  return { canceled: false, filePath: result.filePath }
})
```

- [ ] **Step 2: Expose new surface in preload.js**

Open `electron/preload.js`. Inside the `contextBridge.exposeInMainWorld('gamalab', { ... })` object, add the new groups.

Add a new top-level `schema` group (after the existing `db` group, before `store`):

```js
  schema: {
    getFull: (id, opts) => ipcRenderer.invoke('schema:get-full', id, opts),
  },
  layout: {
    get: (connectionId, dbName) => ipcRenderer.invoke('layout:get', connectionId, dbName),
    set: (connectionId, dbName, nodeId, pos) =>
      ipcRenderer.invoke('layout:set', connectionId, dbName, nodeId, pos),
    clear: (connectionId, dbName) => ipcRenderer.invoke('layout:clear', connectionId, dbName),
  },
```

Inside the existing `dialog` group, add one line:

```js
  dialog: {
    confirm: (options) => ipcRenderer.invoke('dialog:confirm', options),
    saveExport: (options) => ipcRenderer.invoke('dialog:save-export', options),
    savePng: (options) => ipcRenderer.invoke('dialog:save-png', options),
  },
```

- [ ] **Step 3: Manual verification via DevTools**

Run `npm run dev`. Connect to any DB (e.g., via Docker tab create → connect). In the Electron DevTools console:

```js
// 1. Test layout round-trip
await window.gamalab.layout.set('test-conn', 'test-db', 'public.foo', { x: 100, y: 200 })
await window.gamalab.layout.get('test-conn', 'test-db')
// Expected: { 'public.foo': { x: 100, y: 200 } }

await window.gamalab.layout.clear('test-conn', 'test-db')
await window.gamalab.layout.get('test-conn', 'test-db')
// Expected: {}

// 2. Test schema fetch (replace connId with the real one from the store)
const connId = (await window.gamalab.store.get('connections'))[0].id
const schema = await window.gamalab.schema.getFull(connId)
console.log('tables:', schema.tables.length, 'columns:', schema.columns.length, 'indexes:', schema.indexes.length)
console.log('sample table:', schema.tables[0])
console.log('sample column:', schema.columns[0])
// Expected: non-zero counts (assuming the DB has tables), and sample objects show the shape from Task 3.
```

If you get a "No active connection" error from schema.getFull, you're passing the wrong id — use the actual active connection id from the Connections tab.

- [ ] **Step 4: Commit**

```bash
git add electron/main.js electron/preload.js
git commit -m "feat(schema-diagram): wire IPC for schema fetch, layout store, PNG save"
```

---

## Task 6: Create `useFullSchema` hook

**Files:**
- Create: `src/hooks/useFullSchema.js`

- [ ] **Step 1: Write the hook**

Create `src/hooks/useFullSchema.js`:

```js
import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { useDatabase } from '@/hooks/useDatabase'

/**
 * Fetches full schema (tables + columns + FKs + indexes + row counts) for the
 * active connection. Refreshes on:
 *   - active connection change
 *   - tablesRefreshToken bump (CREATE/DROP/ALTER via existing dialogs)
 *   - schemaRefreshToken bump (manual "Refresh" button)
 *   - exactRowCounts toggle
 */
export function useFullSchema() {
  const { activeConnection } = useDatabase()
  const tablesRefreshToken = useAppStore((s) => s.tablesRefreshToken)
  const schemaRefreshToken = useAppStore((s) => s.schemaRefreshToken)
  const exactRowCounts = useAppStore((s) => s.exactRowCounts)

  const [data, setData] = useState({ tables: [], columns: [], indexes: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    if (!activeConnection) {
      setData({ tables: [], columns: [], indexes: [] })
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const result = await window.gamalab.schema.getFull(activeConnection.id, {
          exactCounts: exactRowCounts,
        })
        if (!cancelled) setData(result)
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load schema')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeConnection, tablesRefreshToken, schemaRefreshToken, exactRowCounts])

  return { ...data, loading, error }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useFullSchema.js
git commit -m "feat(schema-diagram): add useFullSchema hook"
```

---

## Task 7: Create `schemaLayout` utility library

**Files:**
- Create: `src/lib/schemaLayout.js`

- [ ] **Step 1: Write the utility**

Create `src/lib/schemaLayout.js`:

```js
import dagre from '@dagrejs/dagre'

const DEFAULT_NODE_WIDTH = 260
const DEFAULT_NODE_HEIGHT = 200

/**
 * Run dagre on the given nodes/edges and return a new array of nodes with
 * `position` set. Only nodes present in `subset` (or all if subset is null)
 * are laid out; others keep their existing position.
 *
 * @param {Array} nodes - react-flow nodes (must have `id`; may have `position`,
 *                        `measured.width`, `measured.height`)
 * @param {Array} edges - react-flow edges (need `source`, `target`)
 * @param {Object} opts
 * @param {'LR'|'TB'} [opts.direction='LR']
 * @param {number} [opts.nodesep=60]
 * @param {number} [opts.ranksep=120]
 * @param {Set<string>|null} [opts.subsetIds=null] - if provided, only these ids get new positions
 */
export function autoLayout(nodes, edges, opts = {}) {
  const { direction = 'LR', nodesep = 60, ranksep = 120, subsetIds = null } = opts

  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: direction, nodesep, ranksep, marginx: 40, marginy: 40 })
  g.setDefaultEdgeLabel(() => ({}))

  nodes.forEach((n) => {
    const w = n.measured?.width || n.width || DEFAULT_NODE_WIDTH
    const h = n.measured?.height || n.height || DEFAULT_NODE_HEIGHT
    g.setNode(n.id, { width: w, height: h })
  })
  edges.forEach((e) => {
    g.setEdge(e.source, e.target)
  })
  dagre.layout(g)

  return nodes.map((n) => {
    if (subsetIds && !subsetIds.has(n.id)) return n
    const out = g.node(n.id)
    if (!out) return n
    return {
      ...n,
      position: { x: out.x - out.width / 2, y: out.y - out.height / 2 },
    }
  })
}

/**
 * Merge persisted positions into nodes. Returns `{ nodes, unpositionedIds }`.
 * Nodes with a persisted position get it applied immediately. Nodes without
 * remain with `position: {x:0,y:0}` and their id is in `unpositionedIds`.
 */
export function applyPersistedPositions(nodes, persisted) {
  const unpositionedIds = new Set()
  const out = nodes.map((n) => {
    const saved = persisted?.[n.id]
    if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
      return { ...n, position: { x: saved.x, y: saved.y } }
    }
    unpositionedIds.add(n.id)
    return { ...n, position: { x: 0, y: 0 } }
  })
  return { nodes: out, unpositionedIds }
}

/** Convenience: debounce a function. 300ms default. */
export function debounce(fn, ms = 300) {
  let t = null
  return (...args) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

/**
 * Deterministic HSL hue from a schema name. `public` gets a neutral blue.
 */
export function schemaHue(schemaName) {
  if (schemaName === 'public') return 210 // neutral blue
  let h = 0
  for (let i = 0; i < schemaName.length; i++) {
    h = (h * 31 + schemaName.charCodeAt(i)) & 0xffff
  }
  return h % 360
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/schemaLayout.js
git commit -m "feat(schema-diagram): add schemaLayout utility (dagre + helpers)"
```

---

## Task 8: Create `TableNode` component

**Files:**
- Create: `src/components/schema/TableNode.jsx`

- [ ] **Step 1: Write the component**

Create directory if needed, then create `src/components/schema/TableNode.jsx`:

```jsx
import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { ExternalLink, KeyRound, Link as LinkIcon, Lock } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { schemaHue } from '@/lib/schemaLayout'
import { cn } from '@/lib/utils'

function formatRowCount(n, isEstimate) {
  if (n == null) return ''
  const abs = Math.abs(n)
  let label
  if (abs >= 1_000_000) label = (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  else if (abs >= 1_000) label = (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k'
  else label = String(n)
  return `${isEstimate ? '~' : ''}${label} rows`
}

function TableNodeInner({ data, selected }) {
  const { schema, name, columns, indexes, rowCount, isEstimate } = data
  const setActiveTable = useAppStore((s) => s.setActiveTable)
  const hue = schemaHue(schema)
  const borderColor = `hsl(${hue} 60% 55%)`

  return (
    <div
      className={cn(
        'group rounded-md bg-[#1e1e1e] text-[#e8e8e8] font-mono text-xs shadow-lg',
        selected && 'ring-2 ring-offset-2 ring-offset-[#1e1e1e]'
      )}
      style={{ border: `1px solid ${borderColor}`, minWidth: 240 }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-2 rounded-t-md border-b px-3 py-1.5"
        style={{ background: `hsl(${hue} 30% 18%)`, borderBottomColor: borderColor }}
      >
        <div className="flex items-baseline gap-1 truncate">
          <span className="text-[10px] text-muted-foreground">{schema}.</span>
          <span className="truncate font-semibold text-[#ffa657]">{name}</span>
        </div>
        <div className="flex items-center gap-2">
          {rowCount != null && (
            <span className="text-[10px] text-muted-foreground">
              {formatRowCount(rowCount, isEstimate)}
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              setActiveTable({ schema, name })
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
            title="Open in Table Browser"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Columns */}
      <div className="py-1">
        {columns.map((c) => (
          <div
            key={c.name}
            className="relative flex items-center justify-between gap-3 px-3 py-0.5"
          >
            {/* Left handle — for incoming FK edges */}
            <Handle
              type="target"
              position={Position.Left}
              id={c.name}
              style={{ background: 'transparent', border: 'none', width: 6, height: 6, left: -3 }}
            />
            <div className="flex min-w-0 items-center gap-1.5 truncate">
              {c.isPrimary && <KeyRound className="h-3 w-3 flex-none text-[#f0c674]" />}
              {!c.isPrimary && c.foreignKey && (
                <LinkIcon className="h-3 w-3 flex-none text-[#7ec699]" />
              )}
              {!c.isPrimary && !c.foreignKey && c.isUnique && (
                <Lock className="h-3 w-3 flex-none text-[#b294bb]" />
              )}
              <span className={cn('truncate', c.isPrimary && 'font-semibold')}>{c.name}</span>
            </div>
            <span className="flex-none text-[10px] text-muted-foreground">
              {c.type}
              {!c.nullable && ' NOT NULL'}
              {c.foreignKey ? '' : c.isUnique && !c.isPrimary ? ' UQ' : ''}
            </span>
            {/* Right handle — for outgoing FK edges */}
            <Handle
              type="source"
              position={Position.Right}
              id={c.name}
              style={{ background: 'transparent', border: 'none', width: 6, height: 6, right: -3 }}
            />
          </div>
        ))}
      </div>

      {/* Indexes footer */}
      {indexes?.length > 0 && (
        <div className="rounded-b-md border-t border-[#2d2d30] bg-[#181818] px-3 py-1 text-[10px] text-muted-foreground">
          {indexes.map((idx) => (
            <div key={idx.name} className="truncate">
              idx: {idx.name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export const TableNode = memo(TableNodeInner)
```

- [ ] **Step 2: Commit**

```bash
git add src/components/schema/TableNode.jsx
git commit -m "feat(schema-diagram): add TableNode custom node component"
```

---

## Task 9: Create `FkEdge` component

**Files:**
- Create: `src/components/schema/FkEdge.jsx`

- [ ] **Step 1: Write the component**

Create `src/components/schema/FkEdge.jsx`:

```jsx
import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react'
import { useAppStore } from '@/store/appStore'

function FkEdgeInner(props) {
  const {
    id,
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    markerEnd,
  } = props

  const selectedEdgeId = useAppStore((s) => s.selectedEdgeId)
  const setSelectedEdgeId = useAppStore((s) => s.setSelectedEdgeId)

  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  })

  const isSelected = selectedEdgeId === id
  const isOtherSelected = selectedEdgeId && !isSelected

  const stroke = isSelected ? '#ff9a3c' : '#4a9eff'
  const strokeWidth = isSelected ? 2.5 : 1.5
  const opacity = isOtherSelected ? 0.2 : 1

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ stroke, strokeWidth, opacity }}
        interactionWidth={20}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
            opacity,
          }}
          className="nodrag nopan"
          onClick={(e) => {
            e.stopPropagation()
            setSelectedEdgeId(isSelected ? null : id)
          }}
        >
          <div
            className="rounded border px-1.5 py-0.5 text-[10px] font-mono cursor-pointer"
            style={{
              background: isSelected ? '#ff9a3c' : '#252526',
              color: isSelected ? '#1e1e1e' : '#888',
              borderColor: isSelected ? '#ff9a3c' : '#3e3e42',
            }}
          >
            1 — *
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export const FkEdge = memo(FkEdgeInner)
```

- [ ] **Step 2: Commit**

```bash
git add src/components/schema/FkEdge.jsx
git commit -m "feat(schema-diagram): add FkEdge custom edge with click-to-highlight"
```

---

## Task 10: Create `SchemaToolbar` component

**Files:**
- Create: `src/components/SchemaToolbar.jsx`

- [ ] **Step 1: Write the component**

Create `src/components/SchemaToolbar.jsx`:

```jsx
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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/SchemaToolbar.jsx
git commit -m "feat(schema-diagram): add SchemaToolbar"
```

---

## Task 11: Create `SchemaDiagram` root component

**Files:**
- Create: `src/components/SchemaDiagram.jsx`

- [ ] **Step 1: Write the component**

Create `src/components/SchemaDiagram.jsx`:

```jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { toPng } from 'html-to-image'
import { Database, TableProperties } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { TableNode } from '@/components/schema/TableNode'
import { FkEdge } from '@/components/schema/FkEdge'
import { SchemaToolbar } from '@/components/SchemaToolbar'
import { useAppStore } from '@/store/appStore'
import { useDatabase } from '@/hooks/useDatabase'
import { useFullSchema } from '@/hooks/useFullSchema'
import {
  applyPersistedPositions,
  autoLayout,
  debounce,
  schemaHue,
} from '@/lib/schemaLayout'

const nodeTypes = { table: TableNode }
const edgeTypes = { fk: FkEdge }

function buildGraph(schemaData) {
  const { tables, columns, indexes } = schemaData

  // Group columns and indexes by tableKey for efficient lookup
  const colsByTable = new Map()
  for (const c of columns) {
    if (!colsByTable.has(c.tableKey)) colsByTable.set(c.tableKey, [])
    colsByTable.get(c.tableKey).push(c)
  }
  const idxByTable = new Map()
  for (const i of indexes) {
    if (!idxByTable.has(i.tableKey)) idxByTable.set(i.tableKey, [])
    idxByTable.get(i.tableKey).push(i)
  }

  const nodes = tables.map((t) => {
    const id = `${t.schema}.${t.name}`
    return {
      id,
      type: 'table',
      position: { x: 0, y: 0 },
      data: {
        schema: t.schema,
        name: t.name,
        rowCount: t.rowCount,
        isEstimate: t.isEstimate,
        columns: colsByTable.get(id) || [],
        indexes: idxByTable.get(id) || [],
      },
    }
  })

  const edges = []
  for (const c of columns) {
    if (!c.foreignKey) continue
    edges.push({
      id: `fk:${c.tableKey}:${c.name}->${c.foreignKey.targetTable}:${c.foreignKey.targetColumn}`,
      source: c.tableKey,
      target: c.foreignKey.targetTable,
      sourceHandle: c.name,
      targetHandle: c.foreignKey.targetColumn,
      type: 'fk',
    })
  }

  return { nodes, edges }
}

function SchemaDiagramInner() {
  const { activeConnection } = useDatabase()
  const { tables, columns, indexes, loading, error } = useFullSchema()
  const schemaFilter = useAppStore((s) => s.schemaFilter)
  const selectedEdgeId = useAppStore((s) => s.selectedEdgeId)
  const setSelectedEdgeId = useAppStore((s) => s.setSelectedEdgeId)
  const setCreateDialogOpen = useAppStore((s) => s.setCreateDialogOpen)
  const setCreateTableDialogOpen = useAppStore((s) => s.setCreateTableDialogOpen)

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const { fitView, getViewport } = useReactFlow()
  const wrapperRef = useRef(null)

  // Key that identifies the current layout scope ("<connId>::<dbName>")
  const layoutKey = useMemo(() => {
    if (!activeConnection) return null
    return [activeConnection.id, activeConnection.database]
  }, [activeConnection])

  // Debounced persist — stable across renders
  const debouncedSave = useMemo(
    () =>
      debounce((connectionId, dbName, nodeId, pos) => {
        window.gamalab.layout.set(connectionId, dbName, nodeId, pos)
      }, 300),
    []
  )

  // Rebuild graph when schema data changes
  useEffect(() => {
    let cancelled = false
    if (!layoutKey || tables.length === 0) {
      setNodes([])
      setEdges([])
      return
    }

    const [connectionId, dbName] = layoutKey
    const { nodes: rawNodes, edges: rawEdges } = buildGraph({ tables, columns, indexes })

    ;(async () => {
      const persisted = await window.gamalab.layout.get(connectionId, dbName)
      if (cancelled) return

      const { nodes: withPos, unpositionedIds } = applyPersistedPositions(rawNodes, persisted)
      let finalNodes = withPos
      if (unpositionedIds.size > 0) {
        finalNodes = autoLayout(withPos, rawEdges, {
          subsetIds: unpositionedIds.size === withPos.length ? null : unpositionedIds,
        })
      }
      if (cancelled) return
      setNodes(finalNodes)
      setEdges(rawEdges)
      // Fit view on next frame
      requestAnimationFrame(() => {
        if (!cancelled) fitView({ padding: 0.1, duration: 300 })
      })
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey?.[0], layoutKey?.[1], tables, columns, indexes])

  // Filter nodes + edges by schema
  const visibleNodes = useMemo(() => {
    if (schemaFilter === 'all') return nodes
    return nodes.map((n) => ({
      ...n,
      hidden: n.data.schema !== schemaFilter,
    }))
  }, [nodes, schemaFilter])

  const visibleEdges = useMemo(() => {
    if (schemaFilter === 'all') return edges
    const visibleIds = new Set(nodes.filter((n) => n.data.schema === schemaFilter).map((n) => n.id))
    return edges.map((e) => ({
      ...e,
      hidden: !(visibleIds.has(e.source) && visibleIds.has(e.target)),
    }))
  }, [edges, nodes, schemaFilter])

  // Dim non-highlighted nodes when an edge is selected
  const highlightedNodes = useMemo(() => {
    if (!selectedEdgeId) return visibleNodes
    const edge = edges.find((e) => e.id === selectedEdgeId)
    if (!edge) return visibleNodes
    const keep = new Set([edge.source, edge.target])
    return visibleNodes.map((n) => ({
      ...n,
      style: { ...(n.style || {}), opacity: keep.has(n.id) ? 1 : 0.3 },
    }))
  }, [visibleNodes, selectedEdgeId, edges])

  const onNodeDragStop = useCallback(
    (_evt, node) => {
      if (!layoutKey) return
      const [connectionId, dbName] = layoutKey
      debouncedSave(connectionId, dbName, node.id, node.position)
    },
    [layoutKey, debouncedSave]
  )

  const handleAutoLayout = useCallback(async () => {
    if (!layoutKey) return
    const ok = await window.gamalab.dialog.confirm({
      title: 'Reset layout?',
      message: 'This will discard your manually arranged positions and re-run auto-layout.',
    })
    if (!ok) return
    const [connectionId, dbName] = layoutKey
    await window.gamalab.layout.clear(connectionId, dbName)
    const relaid = autoLayout(nodes, edges)
    setNodes(relaid)
    requestAnimationFrame(() => fitView({ padding: 0.1, duration: 300 }))
  }, [layoutKey, nodes, edges, fitView, setNodes])

  const handleExportPng = useCallback(async () => {
    if (!wrapperRef.current || !activeConnection) return
    const viewport = wrapperRef.current.querySelector('.react-flow__viewport')
    if (!viewport) return

    // Fit view so all nodes are visible, then capture
    fitView({ padding: 0.1, duration: 0 })
    await new Promise((r) => requestAnimationFrame(r))

    const dataUrl = await toPng(viewport, {
      backgroundColor: '#0a0a0a',
      pixelRatio: 2,
    })
    const dbname = activeConnection.database || 'database'
    const date = new Date().toISOString().slice(0, 10)
    await window.gamalab.dialog.savePng({
      defaultPath: `${dbname}-schema-${date}.png`,
      dataUrl,
    })
  }, [activeConnection, fitView])

  const uniqueSchemas = useMemo(
    () => Array.from(new Set(tables.map((t) => t.schema))).sort(),
    [tables]
  )

  // Empty states
  if (!activeConnection) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={Database}
          title="No active connection"
          description="Select or create a database to view its schema."
          action={
            <Button onClick={() => setCreateDialogOpen(true)}>New Database</Button>
          }
        />
      </div>
    )
  }

  if (!loading && tables.length === 0 && !error) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={TableProperties}
          title="No tables in this database"
          description="Create a table to start building your schema."
          action={
            <Button onClick={() => setCreateTableDialogOpen(true)}>Create Table</Button>
          }
        />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState icon={Database} title="Couldn't load schema" description={error} />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <SchemaToolbar
        schemas={uniqueSchemas}
        onAutoLayout={handleAutoLayout}
        onExportPng={handleExportPng}
      />
      <div ref={wrapperRef} className="relative flex-1">
        <ReactFlow
          nodes={highlightedNodes}
          edges={visibleEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          onEdgeClick={(_evt, edge) => setSelectedEdgeId(edge.id)}
          onPaneClick={() => setSelectedEdgeId(null)}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          proOptions={{ hideAttribution: true }}
          fitView
        >
          <Background variant="dots" gap={16} size={1} color="#2d2d30" />
          <Controls />
          <MiniMap
            nodeColor={(n) => `hsl(${schemaHue(n.data.schema)} 60% 55%)`}
            nodeStrokeWidth={2}
            pannable
            zoomable
          />
        </ReactFlow>
      </div>
    </div>
  )
}

export function SchemaDiagram() {
  return (
    <ReactFlowProvider>
      <SchemaDiagramInner />
    </ReactFlowProvider>
  )
}
```

- [ ] **Step 2: Verify lint errors resolve in IDE**

No runtime check yet (not wired into App.jsx). Just confirm the file saves without TS/lint errors in your editor (if using one). JS imports should resolve: `@xyflow/react`, `html-to-image`, `lucide-react`, the local components.

- [ ] **Step 3: Commit**

```bash
git add src/components/SchemaDiagram.jsx
git commit -m "feat(schema-diagram): add SchemaDiagram root component"
```

---

## Task 12: Add "Schema" tab to Sidebar

**Files:**
- Modify: `src/components/Sidebar.jsx`

- [ ] **Step 1: Register the new tab**

In `src/components/Sidebar.jsx`:

1. Add `Network` to the lucide-react import:

```jsx
import { Container, Database, History as HistoryIcon, Network, Table as TableIcon } from 'lucide-react'
```

2. Add the import for `SchemaDiagram` — we do **not** render the diagram inside the sidebar (it belongs in the main panel), so the sidebar tab just shows a thin placeholder that explains the view is in the main panel.

Actually the Schema tab differs from Tables / Docker / etc. — the other tabs render content inside the sidebar. For Schema, the content is in the main panel (via viewMode). So the sidebar shows a short info block. Add a tiny inline component at the top of the file (after imports):

```jsx
function SchemaTabInfo() {
  return (
    <div className="flex h-full flex-col p-3 text-xs text-muted-foreground">
      <p>The schema diagram is displayed in the main panel.</p>
      <p className="mt-2">Drag to arrange, click an FK to highlight, hover a table for the open button.</p>
    </div>
  )
}
```

3. Add the new tab entry to `ALL_TABS`, after the `tables` entry:

```jsx
const ALL_TABS = [
  { id: 'docker', label: 'Docker', icon: Container },
  { id: 'connections', label: 'Connections', icon: Database },
  { id: 'tables', label: 'Tables', icon: TableIcon, requiresConnection: true },
  { id: 'schema', label: 'Schema', icon: Network, requiresConnection: true },
  { id: 'history', label: 'History', icon: HistoryIcon },
]
```

4. Render `<SchemaTabInfo />` in the content switch. Find:

```jsx
          {sidebarTab === 'connections' && <ConnectionList />}
          {sidebarTab === 'tables' && <TablesList />}
          {sidebarTab === 'docker' && <DockerManager />}
          {sidebarTab === 'history' && <HistoryList />}
```

Replace with:

```jsx
          {sidebarTab === 'connections' && <ConnectionList />}
          {sidebarTab === 'tables' && <TablesList />}
          {sidebarTab === 'schema' && <SchemaTabInfo />}
          {sidebarTab === 'docker' && <DockerManager />}
          {sidebarTab === 'history' && <HistoryList />}
```

- [ ] **Step 2: Switch viewMode when user clicks the Schema sidebar tab**

Still in `Sidebar.jsx`. We want clicking the "Schema" icon to both select the sidebar tab AND flip `viewMode` to `'schema'` in the store, so the main panel renders the diagram.

Add `setViewMode` and `viewMode` to the store destructure:

```jsx
  const { sidebarTab, setSidebarTab, setViewMode } = useAppStore()
```

Then wrap the click handler. Change the existing onClick:

```jsx
              onClick={() => setSidebarTab(tab.id)}
```

to:

```jsx
              onClick={() => {
                setSidebarTab(tab.id)
                if (tab.id === 'schema') setViewMode('schema')
              }}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.jsx
git commit -m "feat(schema-diagram): add Schema tab to sidebar and switch viewMode"
```

---

## Task 13: Route `viewMode === 'schema'` in App.jsx

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Import SchemaDiagram**

Add the import alongside the existing component imports:

```jsx
import { SchemaDiagram } from '@/components/SchemaDiagram'
```

- [ ] **Step 2: Add the schema branch in the main panel render**

Find:

```jsx
const showBrowser = viewMode === 'browse' && activeTable
```

Replace with:

```jsx
const showBrowser = viewMode === 'browse' && activeTable
const showSchema = viewMode === 'schema'
```

Find the main panel block:

```jsx
            <Panel defaultSize={78} minSize={40}>
              {showBrowser ? (
                <TableBrowser />
              ) : (
                <PanelGroup direction="vertical" autoSaveId="gamalab-editor">
                  ...
                </PanelGroup>
              )}
            </Panel>
```

Replace with:

```jsx
            <Panel defaultSize={78} minSize={40}>
              {showSchema ? (
                <SchemaDiagram />
              ) : showBrowser ? (
                <TableBrowser />
              ) : (
                <PanelGroup direction="vertical" autoSaveId="gamalab-editor">
                  <Panel defaultSize={50} minSize={20}>
                    <QueryEditor onRun={handleRunQuery} />
                  </Panel>
                  <PanelResizeHandle className="h-1 bg-border transition-colors hover:bg-ring data-[resize-handle-active]:bg-ring" />
                  <Panel defaultSize={50} minSize={20}>
                    <ResultsTable />
                  </Panel>
                </PanelGroup>
              )}
            </Panel>
```

The inner `PanelGroup` children (`QueryEditor`, `PanelResizeHandle`, `ResultsTable`) are identical to what the file has today — the replacement only adds the `showSchema ?` branch at the top of the ternary.

- [ ] **Step 3: First full-app manual verification**

Run `npm run dev`. Create or connect to a Postgres DB that has at least 2-3 tables with FK relationships. The included `seed_test.sql` would be ideal, but any DB with FKs will do; a fresh DB created via the Docker tab can be seeded with:

```sql
CREATE TABLE roles (id serial PRIMARY KEY, name text NOT NULL UNIQUE);
CREATE TABLE users (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  role_id int REFERENCES roles(id),
  created_at timestamptz DEFAULT now()
);
CREATE TABLE posts (
  id serial PRIMARY KEY,
  author_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text
);
CREATE INDEX posts_author_idx ON posts(author_id);
INSERT INTO roles (name) VALUES ('admin'), ('user');
INSERT INTO users (email, role_id) VALUES ('ada@gamalab.dev', 1);
INSERT INTO posts (author_id, title) VALUES (1, 'Hello');
```

Then:

1. Click the Schema tab in the sidebar (Network icon)
2. Expected: main panel shows three table nodes — `roles`, `users`, `posts` — with FK edges `posts → users` and `users → roles`
3. Expected: each node shows columns with PK (`KeyRound`), FK (`Link`), UQ (`Lock`) icons. Types visible. Row counts shown as `~1 rows` (estimates) initially.
4. Expected: hover a table → `↗` button appears in top-right. Click it → TableBrowser opens on that table.
5. Expected: click an FK edge → edge turns orange, the 2 connected tables keep full opacity, other tables dim. Click background → clears.
6. Expected: toggle "Exact counts" → row counts update to precise values (no `~` prefix).
7. Expected: drag a node to a new position. Close the app. Re-open. Position restored.
8. Expected: click "Auto-layout" → confirm dialog → positions reset.
9. Expected: click "Export PNG" → native save dialog → file saves → open in image viewer, should contain all 3 tables with edges.

If any expectation fails, check the Electron DevTools console for errors and fix before committing.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat(schema-diagram): route viewMode=schema to SchemaDiagram in App"
```

---

## Task 14: Final verification checklist

**Files:** none — verification only.

- [ ] **Step 1: Walk the checklist from the spec**

Run `npm run dev`. Tick each item as you verify it. Do not mark a box unless the behavior is correct.

- [ ] "Schema" tab appears in Sidebar with the Network icon
- [ ] Opening the tab on a connected DB triggers auto-layout — no user action needed
- [ ] Nodes render with density "Full detail" — PK/UQ/FK icons, types, indexes, row counts
- [ ] Dragging a node persists position. Verify the file exists:
  - On Windows: `%APPDATA%\GamaLab\gamalab-layouts.json` (or `%APPDATA%\gamalab\gamalab-layouts.json`)
  - On Linux: `~/.config/gamalab/gamalab-layouts.json`
  - On macOS: `~/Library/Application Support/gamalab/gamalab-layouts.json`
- [ ] Reloading the app (`Ctrl+R` in DevTools, or full restart) restores positions
- [ ] Click `↗` on a table → opens `TableBrowser` on that exact table
- [ ] Click on an FK edge → highlights source + target tables, dims the rest; label turns orange
- [ ] Click on empty background → clears highlight
- [ ] Schema filter (if DB has multiple schemas) hides/shows nodes + their edges
- [ ] Auto-layout button prompts confirmation, then resets to algorithmic positions
- [ ] Toggle "exact counts" re-fetches and updates row counts (~ prefix disappears)
- [ ] Export PNG saves a usable file with the full diagram (not just visible viewport)
- [ ] Empty state on no-connection (disconnect and verify) — shows "New Database" CTA
- [ ] Empty state on zero-tables (connect to a fresh empty DB) — shows "Create Table" CTA
- [ ] Creating a table via `CreateTableDialog` causes the diagram to refresh (new node appears)
- [ ] Switching connections clears the schema filter and edge selection

- [ ] **Step 2: Smoke-test build**

```bash
npm run build
```

Expected: Vite build completes, no errors, no warnings about missing imports.

- [ ] **Step 3: Commit the plan as done**

If anything is broken, go back to the relevant task, fix, commit, and re-run the checklist. When all boxes are ticked:

```bash
git log --oneline  # sanity check: all 13 prior commits are on the branch
```

Do not squash — the per-task commit history is the record of the work.

---

## Implementation notes / gotchas

- **React-flow v12** is published as `@xyflow/react`. Imports are `from '@xyflow/react'`, not `reactflow`. CSS import is `'@xyflow/react/dist/style.css'`.
- **html-to-image + foreign objects**: on some systems, `toPng` can skip elements with `position: fixed`. The MiniMap and Controls use `position: absolute` inside the wrapper, which is fine. If export comes out blank, render at `pixelRatio: 1` first to bisect.
- **Dagre subset layout**: when only some nodes have persisted positions, we lay out all nodes but overwrite only the `subsetIds` positions. In practice this keeps the user's arrangement stable while giving newly-discovered tables (e.g. just-created) a sensible spot.
- **FK handles on columns**: react-flow requires handle ids to be set on both ends. `sourceHandle` = column name, `targetHandle` = target column name. Mismatches are silent (edge just doesn't render).
- **Sidebar tab switch ≠ viewMode switch** for other tabs. For Schema we bundle both because the tab is essentially a view toggle. Clicking Docker/Connections/etc. does not change `viewMode` — they show inside the sidebar.
- **Empty state when clicking Schema with no active connection**: `viewMode` is set to `'schema'` regardless; the `SchemaDiagram` component renders the empty state. That's fine — if the user connects later, the diagram will mount normally.
- **Active table from node button**: reuses `setActiveTable`, which already sets `viewMode: 'browse'`. That moves the user OUT of the schema view into the table browser. There's no "Back" button in v1; user clicks the Schema sidebar tab to return.
