const fs = require('fs')
const path = require('path')
const { app } = require('electron')

const MAX_BYTES = 2 * 1024 * 1024 // 2MB — rotate past this
const KEEP_ROTATED = 3

/**
 * Append-only file logger for diagnostics.
 *
 * Writes to `<userData>/gamalab.log`. Rotates by renaming the file to
 * `gamalab.log.1`, keeping up to N rotated copies. Cheap, sync fallback
 * if the async write fails (rare — disk full / permission denied).
 *
 * Use for anything useful at debug time: uncaught React errors, pg pool
 * errors, auto-reconnect attempts, friendly-error mappings, Docker detect
 * results. Not a replacement for a real crash reporter but enough to
 * triage field bug reports from users.
 */
class Logger {
  constructor() {
    this.filePath = null
    this.ready = false
    try {
      const dir = app.getPath('userData')
      this.filePath = path.join(dir, 'gamalab.log')
      this._rotateIfNeeded()
      this.ready = true
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[logger] init failed:', err)
    }
  }

  _rotateIfNeeded() {
    try {
      if (!fs.existsSync(this.filePath)) return
      const stats = fs.statSync(this.filePath)
      if (stats.size < MAX_BYTES) return
      // Shift existing rotations
      for (let i = KEEP_ROTATED - 1; i >= 1; i--) {
        const src = `${this.filePath}.${i}`
        const dst = `${this.filePath}.${i + 1}`
        if (fs.existsSync(src)) {
          try {
            fs.renameSync(src, dst)
          } catch {
            /* ignore */
          }
        }
      }
      try {
        fs.renameSync(this.filePath, `${this.filePath}.1`)
      } catch {
        /* ignore */
      }
    } catch {
      /* ignore */
    }
  }

  _format(level, msg, meta) {
    const ts = new Date().toISOString()
    const suffix = meta ? ` ${safeJson(meta)}` : ''
    return `${ts} [${level}] ${msg}${suffix}\n`
  }

  _append(line) {
    if (!this.ready || !this.filePath) return
    fs.appendFile(this.filePath, line, (err) => {
      if (err) {
        // Fallback: try sync once, then give up silently
        try {
          fs.appendFileSync(this.filePath, line)
        } catch {
          /* disk full or permission denied — drop */
        }
      }
    })
  }

  info(msg, meta) {
    this._append(this._format('INFO', msg, meta))
  }

  warn(msg, meta) {
    this._append(this._format('WARN', msg, meta))
    // eslint-disable-next-line no-console
    console.warn(`[gamalab] ${msg}`, meta || '')
  }

  error(msg, meta) {
    this._append(this._format('ERROR', msg, meta))
    // eslint-disable-next-line no-console
    console.error(`[gamalab] ${msg}`, meta || '')
  }

  getPath() {
    return this.filePath
  }
}

function safeJson(v) {
  try {
    if (v instanceof Error) {
      return JSON.stringify({ message: v.message, stack: v.stack, code: v.code })
    }
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

// Single instance — the app starts once and logs flow through here
module.exports = new Logger()
