// electron/services/snippets.service.js
// Atomic CRUD for snippets persisted as JSON in userData/snippets.json.
// Pure Node — only Electron dependency is app.getPath('userData').

const fs = require('fs/promises')
const path = require('path')
const { app } = require('electron')

const FILENAME = 'snippets.json'

function filePath() {
  return path.join(app.getPath('userData'), FILENAME)
}

async function load() {
  try {
    const raw = await fs.readFile(filePath(), 'utf8')
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

async function atomicWrite(arr) {
  const fp = filePath()
  const tmp = fp + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(arr, null, 2), 'utf8')
  await fs.rename(tmp, fp)
}

async function list() {
  return await load()
}

async function save(snippet) {
  const arr = await load()
  const idx = arr.findIndex((s) => s.id === snippet.id)
  // Preserve createdAt on update; client always sends fresh updatedAt
  const merged =
    idx >= 0
      ? { ...arr[idx], ...snippet, createdAt: arr[idx].createdAt }
      : snippet
  if (idx >= 0) arr[idx] = merged
  else arr.push(merged)
  await atomicWrite(arr)
  return merged
}

async function remove(id) {
  const arr = await load()
  const next = arr.filter((s) => s.id !== id)
  await atomicWrite(next)
}

module.exports = { list, save, remove }
