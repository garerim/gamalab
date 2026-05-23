const Store = require('electron-store')

/**
 * Thin wrapper around the JSON store backing window.gamalab.store.*
 *
 * On-disk file: config.json in the Electron userData directory. The name
 * and defaults must remain unchanged so existing persisted connections,
 * query history, and theme survive upgrades.
 *
 * Note: this module exposes only raw get/set/delete. The encryption layer
 * for `connections.password_enc` lives in main.js around these calls,
 * because the IPC handlers transparently wrap the renderer-facing values.
 */
const store = new Store({
  name: 'config',
  defaults: {
    connections: [],
    queryHistory: [],
    theme: 'dark',
  },
})

module.exports = {
  get: (key) => store.get(key),
  set: (key, value) => store.set(key, value),
  delete: (key) => store.delete(key),
  // Escape hatch for any caller that needs the underlying instance
  // (e.g. boot-time migration in main.js).
  _instance: store,
}
