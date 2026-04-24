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
