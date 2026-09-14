# Changelog

All notable changes to GamaLab are documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Open-sourced under MIT license
- `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`
- Issue and pull request templates under `.github/`

## [1.0.0] — 2026-05-24

First public release.

### Added
- **Multi-tab SQL editor** with state persistence between sessions
- **AI SQL Assistant** — inline natural-language to SQL bar
  - Bring Your Own Key (Anthropic Claude, OpenAI)
  - Streaming responses with live cost display
  - Encrypted local key storage via `safeStorage`
  - Markdown code-fence stripping on streamed and final output
- **Connection management**
  - Save unlimited local, remote, or Docker connections
  - Test connection before saving
  - Inline rename
  - Passwords encrypted at rest via OS keychain
- **Docker integration** — spin up and manage local `postgres:16` containers
- **CSV import** with preview and column auto-mapping
- **CSV export** of any result set
- **Saved queries** library with snippets
- **Visual schema explorer** powered by React Flow + Dagre
- **Confirm dialog** for destructive SQL (`DROP`, `TRUNCATE`, unscoped `DELETE`)
- **Sortable, filterable result grid**
- **Light and dark themes**

### Known issues
- The Windows installer is currently unsigned — SmartScreen will warn on first launch
- Vite main chunk exceeds 500 kB — will be split in a future release

---

[Unreleased]: https://github.com/garerim/gamalab/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/garerim/gamalab/releases/tag/v1.0.0
