const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('gamalab', {
  docker: {
    check: () => ipcRenderer.invoke('docker:check'),
    list: () => ipcRenderer.invoke('docker:list'),
    create: (config) => ipcRenderer.invoke('docker:create', config),
    start: (id) => ipcRenderer.invoke('docker:start', id),
    stop: (id) => ipcRenderer.invoke('docker:stop', id),
    restart: (id) => ipcRenderer.invoke('docker:restart', id),
    remove: (id, removeVolume) => ipcRenderer.invoke('docker:remove', id, removeVolume),
    findFreePort: (start) => ipcRenderer.invoke('docker:find-free-port', start),
    logs: (id) => ipcRenderer.invoke('docker:logs', id),
  },
  db: {
    connect: (config) => ipcRenderer.invoke('db:connect', config),
    disconnect: (id) => ipcRenderer.invoke('db:disconnect', id),
    query: (id, sql, params) => ipcRenderer.invoke('db:query', id, sql, params),
    transaction: (id, statements) => ipcRenderer.invoke('db:transaction', id, statements),
    exportRows: (id, schema, table, options) =>
      ipcRenderer.invoke('db:export-rows', id, schema, table, options),
    listSchemaInfo: (id) => ipcRenderer.invoke('db:list-schema-info', id),
    listDatabases: (id) => ipcRenderer.invoke('db:list-databases', id),
    createDatabase: (id, name, options) =>
      ipcRenderer.invoke('db:create-database', id, name, options),
    dropDatabase: (id, name) => ipcRenderer.invoke('db:drop-database', id, name),
    listTables: (id, schema) => ipcRenderer.invoke('db:list-tables', id, schema),
    listAllTables: (id) => ipcRenderer.invoke('db:list-all-tables', id),
    listSchemas: (id) => ipcRenderer.invoke('db:list-schemas', id),
    listColumns: (id, schema, table) => ipcRenderer.invoke('db:list-columns', id, schema, table),
    countRows: (id, schema, table, filters) =>
      ipcRenderer.invoke('db:count-rows', id, schema, table, filters),
    browseTable: (id, schema, table, options) =>
      ipcRenderer.invoke('db:browse-table', id, schema, table, options),
  },
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
    delete: (key) => ipcRenderer.invoke('store:delete', key),
  },
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    platform: () => ipcRenderer.invoke('app:platform'),
    name: () => ipcRenderer.invoke('app:name'),
  },
  dialog: {
    confirm: (options) => ipcRenderer.invoke('dialog:confirm', options),
    saveExport: (options) => ipcRenderer.invoke('dialog:save-export', options),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  },
})
