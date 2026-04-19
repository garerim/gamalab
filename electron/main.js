const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs/promises')
const Store = require('electron-store')
const DockerService = require('./services/docker.service')
const DbService = require('./services/db.service')
const credentialStore = require('./services/credentialStore.service')

const isDev = process.env.NODE_ENV === 'development'
const store = new Store({
  name: 'config',
  defaults: {
    connections: [],
    queryHistory: [],
    theme: 'dark',
  },
})

const dockerService = new DockerService()
const dbService = new DbService()

/**
 * Transparently encrypt `password` fields on connection entries when writing,
 * and decrypt `password_enc` back to `password` when reading. The renderer
 * always sees plaintext in memory; the on-disk JSON only holds the encrypted
 * base64 blob.
 */
function encryptConnectionsForStorage(connections) {
  if (!Array.isArray(connections)) return connections
  return connections.map((c) => {
    if (!c || typeof c !== 'object') return c
    const out = { ...c }
    if (typeof out.password === 'string' && out.password.length > 0) {
      const enc = credentialStore.encrypt(out.password)
      if (enc) {
        out.password_enc = enc
        delete out.password
      } else {
        // Encryption unavailable — leave plaintext and flag it so we can warn
        out.password_unencrypted = true
      }
    }
    return out
  })
}

function decryptConnectionsForRenderer(connections) {
  if (!Array.isArray(connections)) return connections
  return connections.map((c) => {
    if (!c || typeof c !== 'object') return c
    const out = { ...c }
    if (typeof out.password_enc === 'string' && !out.password) {
      const dec = credentialStore.decrypt(out.password_enc)
      out.password = dec || ''
    }
    delete out.password_enc
    return out
  })
}

/**
 * One-shot migration at boot: if any persisted connection still has a
 * plaintext `password`, encrypt it in place and save.
 */
function migratePlaintextPasswords() {
  try {
    const connections = store.get('connections') || []
    const needsMigration = connections.some(
      (c) => typeof c?.password === 'string' && c.password.length > 0 && !c.password_enc
    )
    if (!needsMigration) return
    if (!credentialStore.isAvailable()) {
      console.warn(
        '[credentials] safeStorage unavailable — passwords will remain in plaintext on disk.'
      )
      return
    }
    const migrated = encryptConnectionsForStorage(connections)
    store.set('connections', migrated)
    console.log(`[credentials] Encrypted ${migrated.length} connection(s) on disk.`)
  } catch (err) {
    console.error('[credentials] Migration failed:', err)
  }
}

let mainWindow = null

function createWindow() {
  // In dev, read the logo from the source public/ folder.
  // In prod, Vite copies public/* into dist/ during `npm run build`, and dist/
  // is bundled into the asar archive. Electron can read icons from within asar.
  const iconPath = isDev
    ? path.join(__dirname, '..', 'public', 'logo-white.png')
    : path.join(__dirname, '..', 'dist', 'logo-white.png')

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'GamaLab',
    icon: iconPath,
    backgroundColor: '#0a0a0a',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  migratePlaintextPasswords()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  await dbService.closeAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  await dbService.closeAll()
})

// ============ IPC: Docker ============
ipcMain.handle('docker:check', async () => {
  return await dockerService.checkDocker()
})

ipcMain.handle('docker:launch-desktop', async () => {
  return await dockerService.launchDockerDesktop()
})

ipcMain.handle('docker:list', async () => {
  return await dockerService.listContainers()
})

ipcMain.handle('docker:create', async (_evt, config) => {
  return await dockerService.createPostgresContainer(config)
})

ipcMain.handle('docker:start', async (_evt, id) => {
  return await dockerService.startContainer(id)
})

ipcMain.handle('docker:stop', async (_evt, id) => {
  return await dockerService.stopContainer(id)
})

ipcMain.handle('docker:restart', async (_evt, id) => {
  return await dockerService.restartContainer(id)
})

ipcMain.handle('docker:remove', async (_evt, id, removeVolume) => {
  return await dockerService.removeContainer(id, removeVolume)
})

ipcMain.handle('docker:find-free-port', async (_evt, start) => {
  return await dockerService.findFreePort(start)
})

ipcMain.handle('docker:logs', async (_evt, id) => {
  return await dockerService.getContainerLogs(id)
})

// ============ IPC: Database ============
ipcMain.handle('db:connect', async (_evt, config) => {
  return await dbService.connect(config)
})

ipcMain.handle('db:disconnect', async (_evt, id) => {
  return await dbService.disconnect(id)
})

ipcMain.handle('db:query', async (_evt, id, sql, params) => {
  return await dbService.query(id, sql, params)
})

ipcMain.handle('db:transaction', async (_evt, id, statements) => {
  return await dbService.runTransaction(id, statements)
})

ipcMain.handle('db:ping', async (_evt, id) => {
  return await dbService.ping(id)
})

ipcMain.handle('db:export-rows', async (_evt, id, schema, table, options) => {
  return await dbService.exportRows(id, schema, table, options)
})

ipcMain.handle('db:list-schema-info', async (_evt, id) => {
  return await dbService.listSchemaInfo(id)
})

ipcMain.handle('dialog:save-export', async (_evt, { defaultPath, content, format }) => {
  const filters = {
    csv: [{ name: 'CSV', extensions: ['csv'] }],
    json: [{ name: 'JSON', extensions: ['json'] }],
    sql: [{ name: 'SQL', extensions: ['sql'] }],
  }[format] || [{ name: 'All Files', extensions: ['*'] }]

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultPath || 'export',
    filters,
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  await fs.writeFile(result.filePath, content, 'utf-8')
  return { canceled: false, filePath: result.filePath }
})

ipcMain.handle('db:list-databases', async (_evt, id) => {
  return await dbService.listDatabases(id)
})

ipcMain.handle('db:create-database', async (_evt, id, name, options) => {
  return await dbService.createDatabase(id, name, options)
})

ipcMain.handle('db:drop-database', async (_evt, id, name) => {
  return await dbService.dropDatabase(id, name)
})

ipcMain.handle('db:list-tables', async (_evt, id, schema) => {
  return await dbService.listTables(id, schema)
})

ipcMain.handle('db:list-all-tables', async (_evt, id) => {
  return await dbService.listAllTables(id)
})

ipcMain.handle('db:list-schemas', async (_evt, id) => {
  return await dbService.listSchemas(id)
})

ipcMain.handle('db:list-columns', async (_evt, id, schema, table) => {
  return await dbService.listColumns(id, schema, table)
})

ipcMain.handle('db:count-rows', async (_evt, id, schema, table, filters) => {
  return await dbService.countTableRows(id, schema, table, filters)
})

ipcMain.handle('db:browse-table', async (_evt, id, schema, table, options) => {
  return await dbService.browseTable(id, schema, table, options)
})

// ============ IPC: Config/Store ============
ipcMain.handle('credentials:is-encrypted', () => credentialStore.isAvailable())

ipcMain.handle('store:get', (_evt, key) => {
  const value = store.get(key)
  if (key === 'connections') return decryptConnectionsForRenderer(value)
  return value
})
ipcMain.handle('store:set', (_evt, key, value) => {
  if (key === 'connections') {
    return store.set(key, encryptConnectionsForStorage(value))
  }
  return store.set(key, value)
})
ipcMain.handle('store:delete', (_evt, key) => store.delete(key))

// ============ IPC: System ============
ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('app:platform', () => process.platform)
ipcMain.handle('app:name', () => 'GamaLab')

ipcMain.handle('dialog:confirm', async (_evt, options) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Confirm'],
    defaultId: 0,
    cancelId: 0,
    title: options.title || 'Confirm',
    message: options.message || 'Are you sure?',
    detail: options.detail,
  })
  return result.response === 1
})

ipcMain.handle('shell:open-external', (_evt, url) => shell.openExternal(url))
