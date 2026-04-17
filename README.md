# 🧪 GamaLab

> **Your Database Laboratory** — Experiment faster with PostgreSQL.

GamaLab is a desktop application for developers who want to spin up, explore and
destroy PostgreSQL databases at the speed of thought. Create a fully isolated
Postgres container in **10 seconds** and start running queries immediately — no
config, no yaml, no terminal gymnastics.

```
   ┌──────────────────────────────────────────┐
   │  🧪  GamaLab                              │
   │  ────────────────────────────────────────  │
   │  + New Database     ↻ Refresh   ▶ Run      │
   ├──────────┬───────────────────────────────┤
   │ Conns    │  SELECT * FROM users …         │
   │ Docker   │ ─────────────────────────────  │
   │ History  │  ┌ id ─┬ email ──────────── ┐  │
   │          │  │ 1   │ ada@gamalab.dev    │  │
   │          │  │ 2   │ turing@gamalab.dev │  │
   └──────────┴─────────────────────────────── ┘
```

---

## ✨ Features

- 🐳 **Docker-native** — Spin up `postgres:16` containers with one click
- ⚡ **10-second databases** — Auto port-resolution, auto-connect, auto-ready
- 🎨 **Monaco-powered SQL editor** — Syntax highlighting, formatting (`Shift+Alt+F`)
- 📊 **Paginated results** — 100 rows/page, cell/row copy on double-click
- 🕘 **Query history** — Last 50 queries persisted between sessions
- 🗂 **Persistent volumes** — Optional Docker volume per container
- 🛡 **Safety net** — Confirmation dialogs before `DROP`/`TRUNCATE`/unscoped `DELETE`
- 🎛 **VS Code-style layout** — Resizable panels, dark by default
- 💾 **Zero-config** — Settings in `~/.config/gamalab/config.json`

## 🛠 Tech Stack

| Layer          | Tech                                             |
| -------------- | ------------------------------------------------ |
| Desktop shell  | Electron 28                                      |
| UI framework   | React 18 + Vite 5                                |
| Styling        | Tailwind CSS + shadcn/ui (Radix UI primitives)  |
| SQL editor     | `@monaco-editor/react` 4 + `sql-formatter`      |
| Docker client  | `dockerode` 4                                    |
| Postgres       | `pg` (node-postgres) 8                          |
| State          | Zustand 4                                        |
| Config storage | `electron-store` 8                               |
| Panels         | `react-resizable-panels`                         |

## 🚀 Quick start

### Prerequisites

- **Node.js** 18+ and **npm** 9+
- **Docker Desktop** (or Docker Engine with the `docker.sock` accessible)

### Install

```bash
cd gamalab
npm install
```

### Develop

```bash
npm run dev
```

This starts Vite (port `5173`) + Electron concurrently. The app hot-reloads on
changes to `src/`. Electron auto-restarts on changes to `electron/` — just
`Ctrl+C` and re-run if you edit main-process files.

### Build / package

```bash
npm run build           # Vite production build only
npm run package         # Build + electron-builder (current platform)
npm run package:win     # Windows installer
npm run package:mac     # macOS DMG/zip
npm run package:linux   # AppImage/deb
```

Artifacts land in `release/`.

## 🧭 Usage

1. **Check Docker**: The toolbar shows `Docker <version>` (green) when ready.
2. **Create a DB**: Click `+ New Database`. Fill in name, port, user, password.
   If the port is busy, GamaLab auto-increments until it finds a free one.
3. **Auto-connect**: GamaLab waits for Postgres to be ready and connects you.
4. **Query**: Write SQL in the editor, press `Ctrl/Cmd + Enter` to execute.
5. **Inspect**: Results appear in the bottom panel with pagination. Double-click
   a cell to copy its value.
6. **Manage**: The `Docker` tab in the sidebar lets you Start/Stop/Restart/Delete
   any GamaLab-managed container.

### Keyboard shortcuts

| Shortcut             | Action              |
| -------------------- | ------------------- |
| `Ctrl/Cmd + Enter`   | Run query           |
| `Shift + Alt + F`    | Format SQL          |
| `Esc`                | Dismiss toast       |

## 📂 Project structure

```
gamalab/
├── electron/                     # Main process
│   ├── main.js                   # App bootstrap, IPC routing, window
│   ├── preload.js                # contextBridge: exposes window.gamalab
│   └── services/
│       ├── docker.service.js     # dockerode wrapper, port discovery
│       └── db.service.js         # pg Pool registry, safe error mapping
├── src/                          # Renderer (React)
│   ├── components/
│   │   ├── ui/                   # shadcn-style primitives
│   │   ├── Toolbar.jsx
│   │   ├── Sidebar.jsx
│   │   ├── ConnectionList.jsx
│   │   ├── DockerManager.jsx
│   │   ├── QueryEditor.jsx       # Monaco
│   │   ├── ResultsTable.jsx
│   │   ├── HistoryList.jsx
│   │   ├── CreateDbDialog.jsx
│   │   ├── AboutDialog.jsx
│   │   ├── StatusBar.jsx
│   │   └── Toast.jsx
│   ├── hooks/
│   │   ├── useDocker.js
│   │   └── useDatabase.js
│   ├── store/appStore.js         # Zustand store
│   ├── lib/utils.js
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
└── electron-builder.json
```

## 🔒 Security notes

- The renderer runs with `contextIsolation: true` and `nodeIntegration: false`.
  All privileged operations go through a typed IPC bridge (`window.gamalab.*`)
  defined in `electron/preload.js`.
- Connections are local-only (`127.0.0.1`) by design. GamaLab is meant for
  development and experimentation — don't point it at production data.
- Containers created by GamaLab are labelled `com.gamalab.managed=true`. The
  Docker sidebar only lists those, so your other containers stay untouched.
- Destructive SQL (`DROP`, `TRUNCATE`, unscoped `DELETE`) triggers a native
  confirmation dialog before execution.

## 🧪 Philosophy

Databases shouldn't be a ceremony. GamaLab treats them like what they are in
the early stages of a project: a scratch pad. Spin one up, throw schemas at
it, run wild queries, break things, delete it, do it again. That's the lab
mindset.

## 📜 License

MIT — © 2026 GamaLab. Ship fast, experiment faster. 🧪
