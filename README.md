<div align="center">

# 🧪 GamaLab

**Your Database Laboratory** — a modern, local-first PostgreSQL workbench with AI-assisted SQL.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-28-47848F.svg)](https://www.electronjs.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF.svg)](https://vitejs.dev/)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg)](https://react.dev/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Download](#-download) · [Features](#-features) · [Quick start](#-quick-start) · [Contributing](#-contributing) · [License](#-license)

</div>

---

GamaLab is a desktop application for developers who want to spin up, explore, and destroy PostgreSQL databases at the speed of thought. Multi-tab SQL editing, AI-assisted query generation, Docker integration, CSV import — all local, all private, no cloud account, no telemetry.

```
   ┌──────────────────────────────────────────────┐
   │  🧪  GamaLab                                  │
   │  ────────────────────────────────────────────  │
   │  + New Database   ⚙ Settings   ▶ Run   ✨ Ask AI │
   ├──────────┬───────────────────────────────────┤
   │ Conns    │  [ users ] [ orders + ]           │
   │ Docker   │ ─────────────────────────────      │
   │ Saved    │  SELECT * FROM users              │
   │ History  │  WHERE created_at > NOW()         │
   │          │ ─────────────────────────────      │
   │          │  ┌ id ─┬ email ──────────── ┐     │
   │          │  │ 1   │ ada@gamalab.dev    │     │
   │          │  │ 2   │ turing@gamalab.dev │     │
   └──────────┴─────────────────────────────── ┘
```

## 📦 Download

Grab the latest installer from the [**Releases**](https://github.com/garerim/gamalab/releases/latest) page.

Windows installers are provided (`Setup.exe` and portable). Build from source for macOS/Linux (see [Build / package](#build--package)).

> Windows SmartScreen may warn on first launch — the installer is currently unsigned. Click **More info → Run anyway**.

## ✨ Features

**SQL Editor**
- 🧩 **Multi-tab editing** with state persistence between sessions
- 🎨 **Monaco editor** with PostgreSQL syntax highlighting and smart autocomplete
- 💅 **SQL formatter** (`Shift + Alt + F`)
- 📚 **Saved queries** library with snippets

**AI SQL Assistant** (Bring Your Own Key)
- ⌨️ **Inline natural-language bar** — type your question, get SQL
- 📡 **Streaming responses** with live cost display
- 🔀 **Multi-provider** — Anthropic Claude (Haiku, Sonnet, Opus) and OpenAI (GPT-4, GPT-4o-mini)
- 🔐 **Local-only** — your API key stays encrypted on your device

**Database Management**
- 🐳 **Docker-native** — spin up `postgres:16` containers in one click
- ⚡ **10-second databases** — auto port-resolution, auto-connect, auto-ready
- 🔍 **Schema explorer** with a visual React Flow diagram
- 📊 **Sortable, filterable result grid** with pagination
- 📥 **CSV import** with preview and column auto-mapping
- 📤 **CSV export** of any result set
- 🕘 **Query history** — last 50 queries persisted per connection

**Connections**
- 🌐 Local, remote, or Docker-managed connections
- 🔑 **Encrypted credentials** at rest via OS keychain (Electron `safeStorage`)
- ✅ **Test connection** before saving
- ✏️ Inline rename

**Safety & polish**
- 🛡 Confirmation dialogs before `DROP` / `TRUNCATE` / unscoped `DELETE`
- 🎛 VS Code-style resizable panels, dark & light themes
- 💾 **Zero-config** — settings in the standard user-data directory

## 🛠 Tech Stack

| Layer          | Tech                                             |
| -------------- | ------------------------------------------------ |
| Desktop shell  | Electron 28                                      |
| UI framework   | React 18 + Vite 5                                |
| Styling        | Tailwind CSS + shadcn/ui (Radix UI primitives)  |
| SQL editor     | `@monaco-editor/react` 4 + `sql-formatter`      |
| AI SDKs        | `@anthropic-ai/sdk`, `openai`                    |
| Docker client  | `dockerode` 4                                    |
| Postgres       | `pg` (node-postgres) 8                          |
| CSV            | `papaparse`                                      |
| Diagrams       | `@xyflow/react` + `@dagrejs/dagre`               |
| State          | Zustand 4                                        |
| Config storage | `electron-store` 8                               |
| Panels         | `react-resizable-panels`                         |

## 🚀 Quick start

### Prerequisites

- **Node.js** 18+ and **npm** 9+
- **Docker Desktop** (or Docker Engine with the `docker.sock` accessible) — for container features
- **PostgreSQL 12+** somewhere reachable — Docker, local, or remote

### Install

```bash
git clone https://github.com/garerim/gamalab.git
cd gamalab
npm install
```

### Develop

```bash
npm run dev
```

This starts Vite (port `5173`) and Electron concurrently. The renderer hot-reloads on changes to `src/`. Restart the process to pick up changes in `electron/`.

### Build / package

```bash
npm run build           # Vite production build only
npm run package         # Build + electron-builder (current platform)
npm run package:win     # Windows installer (NSIS + portable)
npm run package:mac     # macOS DMG/zip
npm run package:linux   # AppImage/deb
```

Artifacts land in `release/`.

## 🧭 Usage

1. **Connect** — click `+ Connection`, choose Docker (spins up a fresh container) or Remote (host/port/user/password to an existing DB).
2. **Query** — write SQL in the tabbed editor, press `Ctrl/Cmd + Enter` to run.
3. **Ask AI** — open the AI bar with the `✨` toolbar button, type your question in plain English or French, get a ready-to-run query.
4. **Save what matters** — right-click any query tab or use the Save button to add it to your saved queries library.
5. **Import CSV** — right-click a table in the sidebar to import a CSV with preview and column mapping.

### Keyboard shortcuts

| Shortcut             | Action              |
| -------------------- | ------------------- |
| `Ctrl/Cmd + Enter`   | Run query           |
| `Shift + Alt + F`    | Format SQL          |
| `Ctrl/Cmd + T`       | New query tab       |
| `Ctrl/Cmd + S`       | Save current query  |
| `Esc`                | Dismiss toast/dialog|

## 🔒 Privacy & security

GamaLab is **local-first**:

- No account, no signup, no cloud, no telemetry, no crash reporting
- All data stays on your device
- Passwords and API keys encrypted at rest using Electron `safeStorage` (OS keychain)
- The AI Assistant talks directly to the provider (Anthropic / OpenAI) with your own key — no proxy
- The renderer runs with `contextIsolation: true` and `nodeIntegration: false`; all privileged operations go through a typed IPC bridge (`window.gamalab.*`)
- Containers created by GamaLab are labelled `com.gamalab.managed=true` — the Docker sidebar only shows those, so your other containers stay untouched
- Destructive SQL (`DROP`, `TRUNCATE`, unscoped `DELETE`) triggers a confirmation dialog

Full policy: [PRIVACY.md](PRIVACY.md) · Security issues: see [SECURITY.md](SECURITY.md)

## 📂 Project structure

```
gamalab/
├── electron/                         # Main process
│   ├── main.js                       # App bootstrap, IPC routing, window
│   ├── preload.js                    # contextBridge: exposes window.gamalab
│   └── services/
│       ├── docker.service.js         # dockerode wrapper, port discovery
│       ├── db.service.js             # pg Pool registry, safe error mapping
│       ├── ai.service.js             # LLM providers (Anthropic + OpenAI)
│       ├── store.service.js          # electron-store persistence
│       └── credentialStore.service.js# safeStorage for passwords & API keys
├── src/                              # Renderer (React)
│   ├── components/
│   │   ├── ui/                       # shadcn primitives
│   │   ├── QueryEditor.jsx           # Monaco + tabs
│   │   ├── AiBar.jsx                 # NL → SQL bar
│   │   ├── SettingsDialog.jsx        # AI provider config
│   │   ├── ConnectRemoteDialog.jsx
│   │   ├── DockerManager.jsx
│   │   ├── ResultsTable.jsx
│   │   ├── SchemaDiagram.jsx         # React Flow visual explorer
│   │   ├── CsvImportDialog.jsx
│   │   └── ... (30+ components)
│   ├── hooks/                        # useDocker, useDatabase, useFullSchema…
│   ├── store/appStore.js             # Zustand store
│   ├── App.jsx
│   └── main.jsx
├── docs/superpowers/                 # Design specs & implementation plans
├── build/                            # Icons and installer resources
├── package.json                      # electron-builder config lives here
└── vite.config.js
```

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

Quick pointers:
- **Bug reports** — use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md)
- **Feature requests** — use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md)
- **Security issues** — do NOT open a public issue, see [SECURITY.md](SECURITY.md)

By participating in this project you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## 🧪 Philosophy

Databases shouldn't be a ceremony. GamaLab treats them like what they are in the early stages of a project: a scratch pad. Spin one up, throw schemas at it, run wild queries, break things, delete it, do it again. That's the lab mindset.

## 📜 License

[MIT](LICENSE) — © 2026 Gama EI. Ship fast, experiment faster. 🧪
