# Contributing to GamaLab

First — thanks for considering a contribution! GamaLab is a solo-maintained project and every well-scoped fix, feature, or docs improvement is genuinely appreciated.

## Ways to contribute

- 🐛 **Report a bug** — open an issue with the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md)
- 💡 **Suggest a feature** — open an issue with the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md)
- 📝 **Improve documentation** — typos, unclear passages, missing sections in the README are all fair game
- 🧪 **Send a pull request** — fix a bug, add a feature, refactor a rough edge

Before spending significant time on a large PR, **open an issue first** to discuss the approach. A rejected large PR is a bad outcome for both of us.

## Development setup

### Prerequisites

- **Node.js** 18 or later
- **npm** 9 or later
- **Docker Desktop** (for Docker-related features)
- A PostgreSQL server for manual testing (a Docker container spun up from within GamaLab is fine)

### Setup

```bash
git clone https://github.com/garerim/gamalab.git
cd gamalab
npm install
npm run dev
```

`npm run dev` launches Vite (renderer) and Electron (main process) concurrently. The renderer hot-reloads. The main process needs a restart on changes to `electron/`.

### Build the installer locally

```bash
npm run package:win     # or :mac, :linux
```

The output lands in `release/`.

## Project layout

Read the [Project structure](README.md#-project-structure) section of the README for the code map. Key entry points:

- **Main process** — `electron/main.js` bootstraps the app, registers IPC handlers, creates the window
- **Preload** — `electron/preload.js` exposes the typed `window.gamalab.*` API via `contextBridge`
- **Renderer** — `src/App.jsx` is the root React component; state lives in `src/store/appStore.js` (Zustand)
- **Services** — `electron/services/*.js` — one file per subsystem (Docker, database, AI, storage, credentials)

## Code style

- **Formatting** — no formatter configured yet; match the existing style (2-space indent, single quotes in JS, no semicolons in JSX props)
- **Comments** — write comments only when the *why* isn't obvious from the code. Skip narration of what the code does
- **Commits** — use short imperative subjects (`feat(csv-import): add column auto-mapping`, `fix(ai): strip markdown fences from streamed SQL`). Conventional commits are welcome but not enforced
- **Scope** — keep PRs focused on one change. If a bug fix reveals adjacent refactor opportunities, note them in an issue and leave them for a follow-up

## Adding a dependency

- Prefer the current stack (React, Zustand, Radix, Tailwind, Monaco, etc.) before pulling in a new library
- If you must add one: mention it in the PR description with a one-liner on why the existing tools don't fit
- Runtime dependencies go in `dependencies`; build-only and dev tools in `devDependencies`

## Pull request checklist

Before opening a PR:

- [ ] The app builds locally (`npm run build`)
- [ ] The app runs (`npm run dev`) and the change works as described
- [ ] Manual test path is documented in the PR description
- [ ] Screenshots or a short GIF included for UI changes
- [ ] Related issue linked (`Fixes #123`)

PRs are reviewed as time allows. A single maintainer means turnaround is not instant — thanks for your patience.

## Reporting security issues

**Do NOT open a public issue for security vulnerabilities.** See [SECURITY.md](SECURITY.md) for the disclosure process.

## Code of conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold it.

## License

By contributing you agree that your contributions will be licensed under the [MIT License](LICENSE), the same license the rest of the project uses.
