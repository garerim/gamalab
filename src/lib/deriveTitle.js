// src/lib/deriveTitle.js
// Pure function — turns SQL content into a short human-readable title.
// Returns null when no meaningful title can be derived (caller falls back to "Query N").

const SQL_VERBS =
  /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|EXPLAIN|SHOW|WITH)\b/i

const VERB_WITH_TABLE =
  /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE)\b[^;]*?\b(?:FROM|INTO|TABLE|UPDATE)\s+["']?([a-zA-Z_][\w.]*)/i

function truncate(str, max) {
  if (str.length <= max) return str
  return str.slice(0, max - 1) + '…'
}

export function deriveTitle(content) {
  if (!content || !content.trim()) return null

  // 1. First non-empty -- line comment wins
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*--\s*(.+?)\s*$/)
    if (m && m[1].trim().length > 0) return truncate(m[1], 32)
  }

  // 2. Verb + table from first recognizable statement
  const flat = content.replace(/\s+/g, ' ')
  const m = flat.match(VERB_WITH_TABLE)
  if (m) {
    const verb = m[1].toUpperCase()
    const table = m[2]
    return truncate(`${verb} ${table}`, 32)
  }

  // 3. Lone verb fallback
  const verb = flat.match(SQL_VERBS)
  if (verb) return verb[1].toUpperCase()

  return null
}
