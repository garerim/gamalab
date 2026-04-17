import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes, decimals = 1) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`
}

export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`
  return `${(ms / 60000).toFixed(2)}min`
}

export function truncate(str, n = 40) {
  if (!str) return ''
  return str.length > n ? str.substring(0, n) + '…' : str
}

export function timeAgo(timestamp) {
  const diff = Date.now() - timestamp
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

const DANGEROUS_SQL = /\b(DROP|TRUNCATE|DELETE\s+FROM(?!\s+\S+\s+WHERE)|ALTER\s+TABLE.+DROP)/i
export function isDangerousSql(sql) {
  if (!sql) return false
  return DANGEROUS_SQL.test(sql)
}
