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
  connectRemoteDialogOpen: false,
  newLogicalDbDialogOpen: false,
  createTableDialogOpen: false,
  insertRowDialogOpen: false,
  editTableDialogOpen: false,
  editTableTarget: null, // { schema, name }
  pendingTableFilters: null, // { schema, name, filters } — one-shot hint for FK navigation
  viewMode: 'sql', // 'sql' | 'browse'
  activeTable: null, // { schema, name } | null

  // Onboarding
  welcomeDialogOpen: false,
  onboardingCompleted: false, // hydrated from disk on initialize()

  // Connection health: { [id]: { status: 'healthy'|'degraded'|'broken'|'unknown', lastPing: number, latencyMs: number } }
  connectionHealth: {},
  // Stashed by useHealthCheck so any component can force an immediate ping
  forceHealthRefresh: null,

  // Theme
  theme: (typeof localStorage !== 'undefined' && localStorage.getItem('gamalab-theme')) || 'dark',

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
  setConnectRemoteDialogOpen: (open) => set({ connectRemoteDialogOpen: open }),
  setNewLogicalDbDialogOpen: (open) => set({ newLogicalDbDialogOpen: open }),
  setCreateTableDialogOpen: (open) => set({ createTableDialogOpen: open }),
  setInsertRowDialogOpen: (open) => set({ insertRowDialogOpen: open }),
  setEditTableDialogOpen: (open) => set({ editTableDialogOpen: open }),
  openEditTableDialog: (schema, name) =>
    set({ editTableTarget: { schema, name }, editTableDialogOpen: true }),

  setWelcomeDialogOpen: (open) => set({ welcomeDialogOpen: open }),
  markOnboardingComplete: () => {
    set({ onboardingCompleted: true })
    window.gamalab?.store?.set('onboardingCompleted', true)
  },

  setConnectionHealth: (id, health) =>
    set({
      connectionHealth: {
        ...get().connectionHealth,
        [id]: { ...health, lastPing: Date.now() },
      },
    }),
  clearConnectionHealth: (id) => {
    const next = { ...get().connectionHealth }
    delete next[id]
    set({ connectionHealth: next })
  },
  setForceHealthRefresh: (fn) => set({ forceHealthRefresh: fn }),

  navigateToTableWithFilter: (schema, name, filters) => {
    set({
      pendingTableFilters: { schema, name, filters },
      activeTable: { schema, name },
      viewMode: 'browse',
    })
  },
  consumePendingFilters: () => {
    const pending = get().pendingTableFilters
    if (pending) set({ pendingTableFilters: null })
    return pending
  },

  setTheme: (theme) => {
    set({ theme })
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', theme === 'dark')
      const favicon = document.getElementById('favicon')
      if (favicon) {
        favicon.href = theme === 'dark' ? '/logo-white.png' : '/logo-dark.png'
      }
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('gamalab-theme', theme)
    }
  },
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    get().setTheme(next)
  },

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
      const [connections, queryHistory, onboardingCompleted] = await Promise.all([
        window.gamalab.store.get('connections'),
        window.gamalab.store.get('queryHistory'),
        window.gamalab.store.get('onboardingCompleted'),
      ])
      set({
        connections: connections || [],
        queryHistory: queryHistory || [],
        onboardingCompleted: !!onboardingCompleted,
      })
    } catch (err) {
      console.error('Failed to initialize store', err)
    }
  },
}))
