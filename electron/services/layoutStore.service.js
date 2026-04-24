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
