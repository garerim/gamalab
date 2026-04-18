// Shared formatters for exporting row data to CSV / JSON / SQL

function escapeCsvCell(value) {
  if (value === null || value === undefined) return ''
  let str
  if (value instanceof Date) str = value.toISOString()
  else if (typeof value === 'object') str = JSON.stringify(value)
  else str = String(value)
  // Quote if contains comma, quote, newline, or leading/trailing whitespace
  if (/[",\r\n]|^\s|\s$/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

export function toCsv(columns, rows) {
  const header = columns.map(escapeCsvCell).join(',')
  const body = rows
    .map((row) => columns.map((c) => escapeCsvCell(row[c])).join(','))
    .join('\r\n')
  return header + '\r\n' + body + (rows.length > 0 ? '\r\n' : '')
}

export function toJson(rows) {
  // Use the default serializer; Date → ISO string via toJSON
  return JSON.stringify(rows, null, 2)
}

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"'
}

function formatSqlValue(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (v instanceof Date) return `'${v.toISOString()}'`
  if (typeof v === 'object') {
    return "'" + JSON.stringify(v).replace(/'/g, "''") + "'"
  }
  return "'" + String(v).replace(/'/g, "''") + "'"
}

export function toSqlInserts(schema, table, columns, rows) {
  if (rows.length === 0) {
    return `-- No rows to export from ${schema}.${table}\n`
  }
  const qualified = `${quoteIdent(schema)}.${quoteIdent(table)}`
  const colList = columns.map(quoteIdent).join(', ')
  const lines = rows.map((row) => {
    const values = columns.map((c) => formatSqlValue(row[c])).join(', ')
    return `INSERT INTO ${qualified} (${colList}) VALUES (${values});`
  })
  return lines.join('\n') + '\n'
}

export function formatExport({ format, schema, table, columns, rows }) {
  const colNames = columns.map((c) => (typeof c === 'string' ? c : c.name))
  if (format === 'csv') return toCsv(colNames, rows)
  if (format === 'json') return toJson(rows)
  if (format === 'sql') return toSqlInserts(schema, table, colNames, rows)
  throw new Error(`Unknown format: ${format}`)
}
