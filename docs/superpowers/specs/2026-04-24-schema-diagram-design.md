# Schema Diagram — Design

**Status:** Design approved, pending implementation
**Date:** 2026-04-24
**Author:** Matheo (via brainstorming session)

## Summary

Add an ER-style schema diagram view to GamaLab. Users open a new "Schema" tab in the sidebar, which renders the tables of the active database as draggable nodes with their columns, types, keys, and foreign-key relationships. The view is read-only in v1 — no schema editing. Positions are persisted per database so users keep their mental map across sessions.

## Goals

- Give users a visual, at-a-glance understanding of their database structure (tables, columns, relationships)
- Zero-config: opening the tab on a connected DB auto-lays out the schema with no user action required
- Preserve user-arranged layouts across app restarts
- Integrate with the existing `TableBrowser` — the diagram is a navigation aid, not a replacement

## Non-goals (v1)

- Schema editing (add/rename/drop tables or columns from the diagram)
- DDL generation or migration tooling
- Views, materialized views, sequences, enums
- Cross-database diagrams
- Search bar (explicitly scoped out)
- Hover-on-FK-column → trace line (explicitly scoped out, v2 candidate)
- Export to SVG (PNG only in v1)
- Automated tests (project has no test framework; manual verification only)

## Architecture

### Data flow

```
  [PostgreSQL]
      ↑ pg driver
  [electron/services/db.service.js]
      + new: getFullSchema(connectionId, { exactCounts })
      ↑ IPC channel "schema:getFull"
  [electron/preload.js]
      + new: window.gamalab.schema.getFull
      ↑
  [src/hooks/useFullSchema.js]   (new — separate from existing useSchemaInfo)
      ↓
  [src/components/SchemaDiagram.jsx]    (new root component for the panel)
      ├── <SchemaToolbar />
      ├── <ReactFlow>
      │     ├── <TableNode />   (custom node, density "Full detail")
      │     └── <FkEdge />      (custom edge, click-to-highlight)
      ├── <MiniMap />           (built-in)
      └── <Controls />          (built-in)
      ↓
  [src/lib/schemaLayout.js]     (new — dagre wrapper + persistence helpers)
      ↓ IPC channels "layout:get", "layout:set", "layout:clear"
  [electron/services/layoutStore.service.js]   (new)
      ↓
  [electron-store file "gamalab-layouts.json"]
      { "<connectionId>::<dbName>": { "<schema>.<table>": {x, y}, ... } }
```

### New files

- `electron/services/layoutStore.service.js`
- `src/components/SchemaDiagram.jsx`
- `src/components/SchemaToolbar.jsx`
- `src/components/schema/TableNode.jsx`
- `src/components/schema/FkEdge.jsx`
- `src/hooks/useFullSchema.js`
- `src/lib/schemaLayout.js`

### Modified files

- `electron/services/db.service.js` — add `getFullSchema(connectionId, opts)`
- `electron/main.js` — register IPC handlers for `schema:getFull`, `layout:get/set/clear`, `dialog:saveFile`
- `electron/preload.js` — expose `window.gamalab.schema.*`, `window.gamalab.layout.*`, `window.gamalab.dialog.saveFile`
- `src/components/Sidebar.jsx` — add "Schema" tab
- `src/App.jsx` — route `viewMode === 'schema'` to `<SchemaDiagram />`
- `src/store/appStore.js` — add `schema` to `viewMode` enum; add `schemaFilter`, `selectedEdgeId`, `exactRowCounts` state + setters
- `package.json` — add `@xyflow/react`, `@dagrejs/dagre`, `html-to-image`

## Backend

### `db.service.js :: getFullSchema(connectionId, { exactCounts = false })`

Executes the following queries against the target DB (parallelised where independent):

1. **Tables**
   ```sql
   SELECT schemaname, tablename
   FROM pg_tables
   WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
   ORDER BY schemaname, tablename;
   ```

2. **Columns** (via `information_schema.columns`) — table key, column name, data type, is_nullable, column_default, character_maximum_length, ordinal_position.

3. **Primary keys** — `pg_constraint` where `contype = 'p'`, joined with `pg_attribute` to get column names.

4. **Foreign keys** — `pg_constraint` where `contype = 'f'`, resolving source/target tables and columns, plus `confdeltype`/`confupdtype` for ON DELETE / ON UPDATE actions.

5. **Unique constraints** — `pg_constraint` where `contype = 'u'`.

6. **Indexes** — `pg_indexes`, filtered to exclude indexes that back a PK or UQ constraint (those are already represented).

7. **Row counts**
   - Default (estimate): `SELECT relname, reltuples::bigint AS est FROM pg_class WHERE relkind = 'r' AND relnamespace IN (...)`
   - Exact (opt-in via toolbar toggle): a single `COUNT(*)` per table, batched as one query using `UNION ALL`.

### Return shape

```ts
{
  tables: Array<{
    schema: string,
    name: string,
    rowCount: number,
    isEstimate: boolean,
  }>,
  columns: Array<{
    tableKey: string,               // "<schema>.<table>"
    name: string,
    type: string,                   // e.g. "varchar(255)", "int4"
    nullable: boolean,
    default: string | null,
    isPrimary: boolean,
    isUnique: boolean,
    foreignKey: null | {
      targetTable: string,          // "<schema>.<table>"
      targetColumn: string,
      onDelete: 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT',
      onUpdate: 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT',
    },
    maxLength: number | null,
  }>,
  indexes: Array<{
    tableKey: string,
    name: string,
    columns: string[],
    isUnique: boolean,
  }>,
}
```

### Caching

No backend cache. Renderer-side cache in `useFullSchema` keyed by `connectionId + dbName`, invalidated by:
- Manual "Refresh" button
- Existing `tablesRefreshToken` incrementing in the Zustand store (already fired by `CreateTableDialog`, drop-table paths, etc.)
- Connection switch (existing reset logic in the store)

## Frontend

### `SchemaDiagram.jsx`

Root of the panel when `viewMode === 'schema'`. Responsibilities:

- Call `useFullSchema()` → derive `nodes`/`edges`
- Merge persisted positions with auto-layout output
- Mount `<ReactFlow>` with custom node/edge types and built-in `<MiniMap>` + `<Controls>`
- Handle `onNodeDragStop` → debounced `savePosition()` (300 ms)
- Handle `onEdgeClick` → toggle `selectedEdgeId` in store
- Handle "click on empty background" → clear `selectedEdgeId`

Derivation from schema data:

- One node per table, `id = "<schema>.<table>"`, type `table`
- One edge per FK, `id = "fk:<srcTable>:<srcCol>-><tgtTable>:<tgtCol>"`, type `fk`, `source`/`target` = table ids, `sourceHandle`/`targetHandle` = column names

### `TableNode.jsx`

Custom node, VS Code dark-themed, with three sections:

```
┌───────────────────────────────────┐
│ users                  ~1.4k rows ↗│   ← header (hover reveals ↗ button)
├───────────────────────────────────┤
│ 🔑 id          int4 NOT NULL      │   ← body: columns
│ 📧 email       varchar(255) UQ    │
│ 🔗 role_id     int4 NULL          │
│    created_at  timestamp DEFAULT  │
├───────────────────────────────────┤
│ idx: users_email_idx              │   ← footer: non-constraint indexes (muted)
└───────────────────────────────────┘
```

- Header shows `schema.table` (schema muted) + row count (`~1.4k rows` estimated, `1423 rows` exact) + hover-only `↗` button (`lucide-react` `ExternalLink`)
- Column rows have `lucide-react` icons: `KeyRound` (PK), `Lock` (UQ), `Link` (FK). Type column is right-aligned, muted.
- Each column row renders a right-side `<Handle>` with `id = columnName` (for FK edges to anchor on the correct column)
- FK target columns also render a left-side `<Handle>` with the same scheme
- Border color derived from a deterministic hash of the schema name, mapped to an HSL hue (pastel saturation/lightness). Tables in the same schema share a hue; `public` is pinned to a neutral blue so the common case stays calm.
- `↗` button stops propagation so react-flow's drag handler doesn't fire; onClick dispatches:
  ```js
  setActiveTable({ schema, name });
  setViewMode('table');
  ```

### `FkEdge.jsx`

- Default style: bezier curve, stroke `#4a9eff`, width 1.5 px
- Label at midpoint: cardinality `1 — *` (always N:1 for a single-column FK; composite FKs out of scope in v1)
- When `selectedEdgeId === this.id`:
  - Stroke color → `#ff9a3c` (orange), width → 2.5 px
  - Store selector computes `{ highlightedNodeIds: Set }` = `{source, target}` of selected edge
  - `<ReactFlow>` passes `opacity: 0.3` to nodes not in that set via `nodeClassName` or `style` prop
  - All other edges also dim to `opacity: 0.2`

### `SchemaToolbar.jsx`

Horizontal row above the diagram. Left-to-right:

- **Schema filter** — dropdown (`All schemas` / `public` / `auth` / …) built from unique schemas in `tables`. Filters both nodes and edges client-side.
- **Auto-layout button** (`RotateCcw` icon) — shows confirm dialog ("This will reset manual positions. Continue?"), then clears persisted positions and re-runs dagre.
- **Refresh button** (`RefreshCw`) — invalidates cache and re-fetches.
- **Exact counts toggle** (`Switch`) — flips `exactRowCounts` in store, triggers re-fetch.
- **Export PNG button** (`Download`) — calls `toPng()` on the react-flow viewport, opens native save dialog via new `window.gamalab.dialog.saveFile` IPC.

## Layout & persistence

### `src/lib/schemaLayout.js`

Pure functions, no React dependency:

- `autoLayout(nodes, edges, { direction = 'LR', nodesep = 60, ranksep = 120 })` — wraps `dagre.graphlib.Graph`, returns nodes with `position` set. Default direction `LR` (FK source on the left, target on the right), matching typical PG ER diagrams.
- `mergeWithPersisted(nodes, persistedPositions)` — returns `{ positioned, unpositioned }` based on whether each node id has an entry in the persisted map.
- `loadPositions(connectionId, dbName)` — `await window.gamalab.layout.get(connectionId, dbName)`
- `savePosition(connectionId, dbName, nodeId, { x, y })` — debounced 300 ms, `await window.gamalab.layout.set(...)`
- `clearPositions(connectionId, dbName)` — `await window.gamalab.layout.clear(...)`

### Node dimensions

Dagre needs node dimensions to lay out. Strategy:

1. Initial pass uses defaults `width: 240, height: 180` (good approximation for density "Full detail")
2. After first render, `onNodesChange` reports real `node.measured.width/height` values
3. If the measured dimensions differ meaningfully from the defaults (threshold: >30% variance on any node), run a second dagre pass using measured values — but only for nodes that have no persisted position (so we don't override user arrangement)

### Opening flow

```
1. Fetch getFullSchema → tables + columns + FKs + indexes + row counts
2. Build nodes[] and edges[]
3. Load persisted positions via window.gamalab.layout.get
4. Split nodes into positioned vs unpositioned
5. If all unpositioned → autoLayout(all)
   Else if some unpositioned → autoLayout only the unpositioned subset, anchored by keeping the positioned ones fixed
   Else → use persisted positions as-is
6. Render
7. On onNodeDragStop → savePosition (debounced)
```

Invariant: every node has a position before it is rendered. No "jumping" nodes on first frame.

### `electron/services/layoutStore.service.js`

Miroir minimal de `credentialStore.service.js` mais sans chiffrement (positions are not sensitive). Uses `electron-store` with file name `gamalab-layouts.json`.

```js
const Store = require('electron-store');
const store = new Store({ name: 'gamalab-layouts' });

const key = (cid, db) => `${cid}::${db}`;

module.exports = {
  getPositions: (cid, db) => store.get(key(cid, db), {}),
  setPosition: (cid, db, nodeId, pos) => {
    const current = store.get(key(cid, db), {});
    store.set(key(cid, db), { ...current, [nodeId]: pos });
  },
  clearPositions: (cid, db) => store.delete(key(cid, db)),
};
```

## Store changes (`appStore.js`)

```js
// extend viewMode union
viewMode: 'query' | 'table' | 'schema'

// new state
schemaFilter: 'all',                 // or schema name like 'public'
selectedEdgeId: null,                // FK highlight
exactRowCounts: false,               // toolbar toggle

// new setters
setSchemaFilter(name)
setSelectedEdgeId(id)
toggleExactRowCounts()
```

When the user switches connections, the existing reset logic in the store is extended to clear `schemaFilter` and `selectedEdgeId`. `exactRowCounts` persists across connections (it's a UI preference).

## Interactions (locked)

| Interaction | Behavior |
|---|---|
| Click `↗` on a table node | `setActiveTable({schema,name})` + `setViewMode('table')` — opens existing TableBrowser |
| Click on FK edge | Set `selectedEdgeId`; highlight the 2 endpoint nodes, dim the rest |
| Click on empty background | Clear `selectedEdgeId` |
| Drag a node | Move it freely; position persists after drag end (debounced 300 ms) |
| Change schema filter | Nodes/edges outside the filter hide; layout is preserved for the remaining ones |
| Click "Auto-layout" | Confirm dialog → clear persisted positions → recompute via dagre |
| Click "Refresh" | Invalidate cache, re-fetch |
| Toggle "Exact counts" | Re-fetch with `COUNT(*)` instead of `reltuples` |
| Click "Export PNG" | Save `<dbname>-schema-<YYYY-MM-DD>.png` via native dialog |

## Edge cases & empty states

| State | UI |
|---|---|
| No active connection | `<EmptyState>` "Select or create a database to view its schema" + CTA "New Database" (reuses existing `NewLogicalDbDialog`) |
| Active connection but zero tables | `<EmptyState>` "No tables in this database yet" + CTA "Create Table" (reuses existing `CreateTableDialog`) |
| Connection lost while diagram is open | Toast error + overlay "Connection lost — reconnect" button |
| Schema fetch fails | Existing `<ErrorScreen>` (already used elsewhere in the app) |
| Very large schemas (>100 tables) | Show a warning toast on load: "Large schema (N tables) — rendering may be slow". Not a blocker. |
| Table created/dropped via existing dialogs | `tablesRefreshToken` already increments; `useFullSchema` subscribes to it and re-fetches |
| Composite FK (multi-column) | Render as a single edge on the first column pair. Visually correct enough for v1. |

## Dependencies to add

```json
"@xyflow/react": "^12.x",
"@dagrejs/dagre": "^1.x",
"html-to-image": "^1.11.x"
```

Use `@dagrejs/dagre` (maintained fork) rather than the unmaintained `dagre` package on npm. API is identical.

Estimated bundle impact: ~150 KB gzip additional. Acceptable for an Electron app.

## Manual verification checklist

To be executed by the implementer before marking the feature done:

- [ ] "Schema" tab appears in Sidebar
- [ ] Opening the tab on a connected DB triggers auto-layout, no user action needed
- [ ] Nodes render with density "Full detail" — PK/UQ/FK icons, types, indexes, row counts
- [ ] Dragging a node persists position (verify `gamalab-layouts.json` on disk)
- [ ] Reloading the app restores positions
- [ ] Click `↗` on a table → opens TableBrowser on that table
- [ ] Click on an FK edge → highlights source + target table, dims the rest
- [ ] Click on background → clears highlight
- [ ] Schema filter hides/shows nodes + their edges
- [ ] Auto-layout button resets to algorithmic positions after confirmation
- [ ] Toggle "exact counts" re-fetches and updates row counts
- [ ] Export PNG saves a usable file with the full diagram (not just visible viewport)
- [ ] Empty state on no-connection and on zero-tables cases
- [ ] Creating a table via `CreateTableDialog` causes the diagram to refresh
- [ ] Large schema (>100 tables) renders with the warning toast but stays interactive

## Out of scope — v2 candidates

- Search bar (centers view on matched table)
- Hover on FK column → trace line to target
- Show views as nodes (dashed border, distinct icon)
- Export SVG
- Schema diff between two DBs
- Light editing: rename column / add column / create FK via drag between handles
- Multi-column FK rendering (one edge per column pair)
