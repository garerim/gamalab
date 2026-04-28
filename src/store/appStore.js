import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { deriveTitle } from '@/lib/deriveTitle'

const MAX_HISTORY = 50

export const useAppStore = create(
  persist(
    (set, get) => ({
  // Docker state
  dockerStatus: { checked: false, running: false, installed: false },
  containers: [],
  loadingContainers: false,

  // Connections
  connections: [],
  activeConnectionId: null,

  queryHistory: [],

  // --- Snippets state (mirrored from disk; source of truth = userData/snippets.json) ---
  snippets: [],
  saveSnippetDialogOpen: false,
  saveSnippetDialogPrefilledSql: '',
  editingSnippet: null,        // null = create mode; Snippet object = edit mode
  snippetPaletteOpen: false,

  // --- Confirm dialog (transient; payload is null when closed) ---
  confirmDialog: null,

  // --- Import CSV (transient; context is null when closed) ---
  importCsvDialogOpen: false,
  importCsvContext: null,

  // --- Query tabs (new) ---
  queryTabs: [
    {
      id: (globalThis.crypto?.randomUUID?.() || Math.random().toString(36)).slice(0, 8),
      title: 'Welcome to GamaLab',
      titleManual: false,
      content: '-- Welcome to GamaLab 🧪\n-- Your Database Laboratory\n\nSELECT version();',
      result: null,
      error: null,
      running: false,
      duration: null,
    },
  ],
  activeTabId: null, // set lazily in initialize() if unset
  nextTabNumber: 2,  // "Query 1" is implicitly the first tab's fallback; next new tab = "Query 2"

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

  // Schema diagram
  schemaFilter: 'all', // 'all' or a schema name like 'public'
  selectedEdgeId: null, // id of the currently-highlighted FK edge, or null
  exactRowCounts: false, // false = reltuples estimate, true = COUNT(*)
  schemaRefreshToken: 0, // bump to force useFullSchema to re-fetch

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
  renameConnection: (id, name) => {
    const trimmed = (name || '').trim()
    const connections = get().connections.map((c) =>
      c.id === id
        ? { ...c, name: trimmed || undefined }
        : c
    )
    set({ connections })
    window.gamalab.store.set('connections', connections)
  },
  setActiveConnectionId: (id) => {
    if (id !== get().activeConnectionId) {
      set({
        activeConnectionId: id,
        activeTable: null,
        viewMode: 'sql',
        schemaFilter: 'all',
        selectedEdgeId: null,
      })
      get().clearAllTabResults()
    } else {
      set({ activeConnectionId: id })
    }
  },

  // --- Tab actions ---
  createTab: ({ content = '' } = {}) => {
    const id = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36)).slice(0, 8)
    const n = get().nextTabNumber
    const tab = {
      id,
      title: deriveTitle(content) || `Query ${n}`,
      titleManual: false,
      content,
      result: null,
      error: null,
      running: false,
      duration: null,
    }
    set({
      queryTabs: [...get().queryTabs, tab],
      activeTabId: id,
      nextTabNumber: n + 1,
    })
    return id
  },

  closeTab: (id) => {
    const tabs = get().queryTabs
    if (tabs.length <= 1) return                 // guard: last tab can't close
    const target = tabs.find((t) => t.id === id)
    if (!target || target.running) return        // guard: don't close running
    const idx = tabs.indexOf(target)
    const nextTabs = tabs.filter((t) => t.id !== id)
    // pick neighbour: previous if exists, else next
    const neighbour = nextTabs[idx - 1] || nextTabs[idx] || nextTabs[0]
    set({
      queryTabs: nextTabs,
      activeTabId:
        get().activeTabId === id ? neighbour?.id ?? null : get().activeTabId,
    })
  },

  setActiveTabId: (id) => {
    if (get().queryTabs.some((t) => t.id === id)) set({ activeTabId: id })
  },

  updateTabContent: (id, content) => {
    set({
      queryTabs: get().queryTabs.map((t) => {
        if (t.id !== id) return t
        // If the user manually renamed, keep their title. Otherwise, try to
        // re-derive from new content; if derivation yields nothing (e.g. the
        // user cleared everything), preserve whatever title the tab already
        // has. Never guess a "Query N" number — each tab's Query-N identity
        // is locked in at creation time.
        const nextTitle = t.titleManual
          ? t.title
          : (deriveTitle(content) || t.title)
        return { ...t, content, title: nextTitle }
      }),
    })
  },

  renameTab: (id, title) => {
    const trimmed = (title || '').trim()
    if (!trimmed) return
    set({
      queryTabs: get().queryTabs.map((t) =>
        t.id === id ? { ...t, title: trimmed, titleManual: true } : t
      ),
    })
  },

  setTabResult: (id, { result = null, error = null, duration = null } = {}) => {
    set({
      queryTabs: get().queryTabs.map((t) =>
        t.id === id ? { ...t, result, error, duration } : t
      ),
    })
  },

  setTabRunning: (id, running) => {
    set({
      queryTabs: get().queryTabs.map((t) =>
        t.id === id ? { ...t, running } : t
      ),
    })
  },

  clearAllTabResults: () => {
    set({
      queryTabs: get().queryTabs.map((t) => ({
        ...t,
        result: null,
        error: null,
        running: false,
        duration: null,
      })),
    })
  },

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

  // --- Snippets actions ---
  setSnippets: (snippets) => set({ snippets }),
  addSnippet: (snippet) => set({ snippets: [...get().snippets, snippet] }),
  updateSnippet: (id, patch) =>
    set({
      snippets: get().snippets.map((s) =>
        s.id === id ? { ...s, ...patch } : s
      ),
    }),
  removeSnippet: (id) =>
    set({ snippets: get().snippets.filter((s) => s.id !== id) }),

  openSaveSnippetDialog: ({ sql = '', editing = null } = {}) =>
    set({
      saveSnippetDialogOpen: true,
      saveSnippetDialogPrefilledSql: editing?.sql ?? sql,
      editingSnippet: editing,
    }),
  closeSaveSnippetDialog: () =>
    set({
      saveSnippetDialogOpen: false,
      editingSnippet: null,
      saveSnippetDialogPrefilledSql: '',
    }),

  setSnippetPaletteOpen: (open) => set({ snippetPaletteOpen: open }),

  // --- Confirm dialog actions ---
  setConfirmDialog: (payload) => set({ confirmDialog: payload }),

  // --- Import CSV actions ---
  setImportCsvDialogOpen: (open) => set({ importCsvDialogOpen: open }),
  setImportCsvContext: (ctx) => set({ importCsvContext: ctx }),

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

  setSchemaFilter: (name) => set({ schemaFilter: name || 'all' }),
  setSelectedEdgeId: (id) => set({ selectedEdgeId: id }),
  toggleExactRowCounts: () => set({ exactRowCounts: !get().exactRowCounts }),
  bumpSchemaRefresh: () => set({ schemaRefreshToken: get().schemaRefreshToken + 1 }),

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
    // Ensure an active tab is selected
    if (!get().activeTabId && get().queryTabs.length > 0) {
      set({ activeTabId: get().queryTabs[0].id })
    }
  },
    }),
    {
      name: 'gamalab-app',
      version: 1,
      partialize: (state) => ({
        queryTabs: state.queryTabs.map((t) => ({
          id: t.id,
          title: t.title,
          titleManual: t.titleManual,
          content: t.content,
        })),
        activeTabId: state.activeTabId,
        nextTabNumber: state.nextTabNumber,
      }),
      migrate: (persisted, version) => {
        if (!persisted) return persisted
        // Defensive: future-version migrations hook here.
        // v0 would carry a legacy `currentQuery` string; promote it to a tab.
        if (version < 1 && typeof persisted.currentQuery === 'string') {
          const { currentQuery, ...rest } = persisted
          const id = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36)).slice(0, 8)
          return {
            ...rest,
            queryTabs: [{
              id,
              title: 'Welcome to GamaLab',
              titleManual: false,
              content: currentQuery,
            }],
            activeTabId: id,
            nextTabNumber: 2,
          }
        }
        return persisted
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return
        // Re-inflate volatile per-tab fields (they were stripped by partialize)
        if (Array.isArray(state.queryTabs)) {
          state.queryTabs = state.queryTabs.map((t) => ({
            ...t,
            result: null,
            error: null,
            running: false,
            duration: null,
          }))
        }
        // Safety: if somehow we persisted 0 tabs, seed one
        if (!state.queryTabs || state.queryTabs.length === 0) {
          const id = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36)).slice(0, 8)
          state.queryTabs = [{
            id,
            title: 'Query 1',
            titleManual: false,
            content: '',
            result: null,
            error: null,
            running: false,
            duration: null,
          }]
          state.activeTabId = id
          state.nextTabNumber = 2
        }
        // Ensure activeTabId points to an existing tab
        if (!state.queryTabs.some((t) => t.id === state.activeTabId)) {
          state.activeTabId = state.queryTabs[0].id
        }
      },
    }
  )
)
