import { create } from 'zustand'

const MAX_HISTORY = 50

export const useAppStore = create((set, get) => ({
  // Docker state
  dockerStatus: { checked: false, running: false, installed: false },
  containers: [],
  loadingContainers: false,

  // Connections
  connections: [],
  activeConnectionId: null,

  // Query state
  currentQuery: '-- Welcome to GamaLab 🧪\n-- Your Database Laboratory\n\nSELECT version();',
  queryResult: null,
  queryError: null,
  queryRunning: false,
  queryHistory: [],

  // UI state
  sidebarTab: 'connections',
  aboutOpen: false,
  createDialogOpen: false,
  newLogicalDbDialogOpen: false,
  createTableDialogOpen: false,
  insertRowDialogOpen: false,
  editTableDialogOpen: false,
  editTableTarget: null, // { schema, name }
  viewMode: 'sql', // 'sql' | 'browse'
  activeTable: null, // { schema, name } | null

  // Notifications
  toast: null,

  // === Setters ===
  setDockerStatus: (status) => set({ dockerStatus: { ...status, checked: true } }),
  setContainers: (containers) => set({ containers }),
  setLoadingContainers: (loadingContainers) => set({ loadingContainers }),

  setConnections: (connections) => set({ connections }),
  addConnection: (conn) => {
    const connections = [...get().connections.filter((c) => c.id !== conn.id), conn]
    set({ connections })
    window.gamalab.store.set('connections', connections)
  },
  removeConnection: (id) => {
    const connections = get().connections.filter((c) => c.id !== id)
    set({
      connections,
      activeConnectionId: get().activeConnectionId === id ? null : get().activeConnectionId,
    })
    window.gamalab.store.set('connections', connections)
  },
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

  setCurrentQuery: (query) => set({ currentQuery: query }),
  setQueryResult: (result) => set({ queryResult: result, queryError: null }),
  setQueryError: (error) => set({ queryError: error, queryResult: null }),
  setQueryRunning: (running) => set({ queryRunning: running }),

  addHistoryItem: (item) => {
    const history = [item, ...get().queryHistory].slice(0, MAX_HISTORY)
    set({ queryHistory: history })
    window.gamalab.store.set('queryHistory', history)
  },
  clearHistory: () => {
    set({ queryHistory: [] })
    window.gamalab.store.set('queryHistory', [])
  },
  removeHistoryItem: (id) => {
    const history = get().queryHistory.filter((h) => h.id !== id)
    set({ queryHistory: history })
    window.gamalab.store.set('queryHistory', history)
  },

  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setAboutOpen: (open) => set({ aboutOpen: open }),
  setCreateDialogOpen: (open) => set({ createDialogOpen: open }),
  setNewLogicalDbDialogOpen: (open) => set({ newLogicalDbDialogOpen: open }),
  setCreateTableDialogOpen: (open) => set({ createTableDialogOpen: open }),
  setInsertRowDialogOpen: (open) => set({ insertRowDialogOpen: open }),
  setEditTableDialogOpen: (open) => set({ editTableDialogOpen: open }),
  openEditTableDialog: (schema, name) =>
    set({ editTableTarget: { schema, name }, editTableDialogOpen: true }),

  tablesRefreshToken: 0,
  bumpTablesRefresh: () => set({ tablesRefreshToken: get().tablesRefreshToken + 1 }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setActiveTable: (table) =>
    set({ activeTable: table, viewMode: table ? 'browse' : 'sql' }),

  showToast: (message, type = 'info') => {
    const id = Date.now()
    set({ toast: { id, message, type } })
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null })
    }, 4000)
  },
  hideToast: () => set({ toast: null }),

  // === Bootstrap ===
  initialize: async () => {
    try {
      const [connections, queryHistory] = await Promise.all([
        window.gamalab.store.get('connections'),
        window.gamalab.store.get('queryHistory'),
      ])
      set({
        connections: connections || [],
        queryHistory: queryHistory || [],
      })
    } catch (err) {
      console.error('Failed to initialize store', err)
    }
  },
}))
