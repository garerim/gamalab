const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const Store = require('electron-store')
const DockerService = require('./services/docker.service')
const DbService = require('./services/db.service')

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

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'GamaLab',
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
ipcMain.handle('store:get', (_evt, key) => store.get(key))
ipcMain.handle('store:set', (_evt, key, value) => store.set(key, value))
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
