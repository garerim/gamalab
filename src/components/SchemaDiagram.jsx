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
import { confirm } from '@/lib/confirm'

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
    const ok = await confirm({
      title: 'Reset layout?',
      message: 'This will discard your manually arranged positions and re-run auto-layout.',
      confirmLabel: 'Reset',
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
