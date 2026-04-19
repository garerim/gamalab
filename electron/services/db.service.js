const { Pool } = require('pg')
const crypto = require('crypto')

class DbService {
  constructor() {
    this.pools = new Map()
  }

  _connectionId(config) {
    const key = `${config.host}:${config.port}:${config.database}:${config.user}`
    return crypto.createHash('sha1').update(key).digest('hex').substring(0, 16)
  }

  async connect(config) {
    const id = config.id || this._connectionId(config)

    if (this.pools.has(id)) {
      await this.disconnect(id)
    }

    const sslMode = config.sslMode || 'disable'
    let sslConfig
    if (sslMode === 'require') {
      sslConfig = { rejectUnauthorized: false }
    } else if (sslMode === 'verify-full') {
      sslConfig = { rejectUnauthorized: true }
    } else if (sslMode === 'prefer') {
      // pg lib falls back to non-SSL if SSL fails
      sslConfig = { rejectUnauthorized: false }
    } else {
      sslConfig = false
    }

    const pool = new Pool({
      host: config.host || '127.0.0.1',
      port: config.port || 5432,
      user: config.user || 'postgres',
      password: config.password || '',
      database: config.database || 'postgres',
      ssl: sslConfig,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: Number(config.connectionTimeoutMs) || 10000,
      statement_timeout: Number(config.statementTimeoutMs) || 60000,
    })

    try {
      const client = await pool.connect()
      const result = await client.query('SELECT version()')
      client.release()

      this.pools.set(id, pool)

      return {
        id,
        connected: true,
        version: result.rows[0].version,
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
      }
    } catch (err) {
      await pool.end().catch(() => {})
      throw new Error(this._friendlyError(err))
    }
  }

  async disconnect(id) {
    const pool = this.pools.get(id)
    if (pool) {
      await pool.end().catch(() => {})
      this.pools.delete(id)
    }
    return { success: true }
  }

  async closeAll() {
    const ids = Array.from(this.pools.keys())
    await Promise.all(ids.map((id) => this.disconnect(id)))
  }

  async runTransaction(id, statements) {
    const pool = this.pools.get(id)
    if (!pool) throw new Error('No active connection. Please connect first.')
    if (!Array.isArray(statements) || statements.length === 0) {
      return { executed: 0 }
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const stmt of statements) {
        const sql = typeof stmt === 'string' ? stmt : stmt?.sql
        const params = typeof stmt === 'string' ? [] : stmt?.params || []
        if (!sql) continue
        await client.query(sql, params)
      }
      await client.query('COMMIT')
      return { executed: statements.length }
    } catch (err) {
      try {
        await client.query('ROLLBACK')
      } catch {
        /* ignore */
      }
      throw new Error(this._friendlyError(err))
    } finally {
      client.release()
    }
  }

  async query(id, sql, params = []) {
    const pool = this.pools.get(id)
    if (!pool) throw new Error('No active connection. Please connect first.')

    const start = Date.now()
    try {
      const result = await pool.query(sql, params)
      const duration = Date.now() - start

      if (Array.isArray(result)) {
        return {
          multi: true,
          results: result.map((r) => this._mapResult(r, duration)),
          duration,
        }
      }

      return this._mapResult(result, duration)
    } catch (err) {
      throw new Error(this._friendlyError(err))
    }
  }

  _mapResult(result, duration) {
    return {
      multi: false,
      command: result.command,
      rowCount: result.rowCount,
      duration,
      fields: (result.fields || []).map((f) => ({
        name: f.name,
        dataTypeID: f.dataTypeID,
      })),
      rows: result.rows || [],
    }
  }

  async listDatabases(id) {
    const pool = this.pools.get(id)
    if (!pool) throw new Error('No active connection')
    const { rows } = await pool.query(
      `SELECT d.datname AS name,
              pg_catalog.pg_get_userbyid(d.datdba) AS owner,
              pg_catalog.pg_database_size(d.datname) AS size_bytes
       FROM pg_database d
       WHERE d.datistemplate = false
       ORDER BY d.datname`
    )
    return rows
  }

  async createDatabase(id, name, options = {}) {
    const pool = this.pools.get(id)
    if (!pool) throw new Error('No active connection')
    this._validateIdent(name)
    const parts = [`CREATE DATABASE ${this._qi(name)}`]
    if (options.owner) {
      this._validateIdent(options.owner)
      parts.push(`OWNER ${this._qi(options.owner)}`)
    }
    if (options.encoding) {
      const enc = String(options.encoding).replace(/[^A-Za-z0-9_-]/g, '')
      parts.push(`ENCODING '${enc}'`)
    }
    if (options.template) {
      this._validateIdent(options.template)
      parts.push(`TEMPLATE ${this._qi(options.template)}`)
    }
    try {
      await pool.query(parts.join(' '))
      return { name, owner: options.owner }
    } catch (err) {
      throw new Error(this._friendlyError(err))
    }
  }

  async dropDatabase(id, name) {
    const pool = this.pools.get(id)
    if (!pool) throw new Error('No active connection')
    this._validateIdent(name)
    try {
      await pool.query(`DROP DATABASE ${this._qi(name)}`)
      return { success: true }
    } catch (err) {
      throw new Error(this._friendlyError(err))
    }
  }

  async listSchemas(id) {
    const pool = this.pools.get(id)
    if (!pool) throw new Error('No active connection')
    const { rows } = await pool.query(
      `SELECT schema_name AS name FROM information_schema.schemata
       WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
         AND schema_name NOT LIKE 'pg_%'
       ORDER BY schema_name`
    )
    return rows
  }

  async listTables(id, schema = 'public') {
    const pool = this.pools.get(id)
    if (!pool) throw new Error('No active connection')
    const { rows } = await pool.query(
      `SELECT table_name AS name, table_type AS type
       FROM information_schema.tables
       WHERE table_schema = $1
       ORDER BY table_name`,
      [schema]
    )
    return rows
  }

  async listAllTables(id) {
    const pool = this.pools.get(id)
    if (!pool) throw new Error('No active connection')
    const { rows } = await pool.query(
      `SELECT table_schema AS schema, table_name AS name, table_type AS type
       FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
         AND table_schema NOT LIKE 'pg_%'
       ORDER BY table_schema, table_name`
    )
    return rows
  }

  async listColumns(id, schema, table) {
    const pool = this.pools.get(id)
    if (!pool) throw new Error('No active connection')
    this._validateIdent(schema)
    this._validateIdent(table)

    // 1) Base column info + PK flag
    const { rows: cols } = await pool.query(
      `SELECT
         c.column_name AS name,
         c.data_type AS type,
         c.udt_name AS udt_name,
         c.is_nullable = 'YES' AS nullable,
         c.column_default AS default_value,
         c.character_maximum_length AS max_length,
         c.ordinal_position AS position,
         EXISTS (
           SELECT 1 FROM information_schema.key_column_usage kcu
           JOIN information_schema.table_constraints tc
             ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
           WHERE tc.table_schema = $1
             AND tc.table_name = $2
             AND kcu.column_name = c.column_name
             AND tc.constraint_type = 'PRIMARY KEY'
         ) AS is_primary_key
       FROM information_schema.columns c
       WHERE c.table_schema = $1 AND c.table_name = $2
       ORDER BY c.ordinal_position`,
      [schema, table]
    )

    // 2) Foreign keys (single-column only) via pg_catalog — most reliable across PG versions
    const { rows: fks } = await pool.query(
      `SELECT
         a.attname AS column_name,
         con.conname AS constraint_name,
         fns.nspname AS foreign_schema,
         ft.relname AS foreign_table,
         fa.attname AS foreign_column
       FROM pg_constraint con
       JOIN pg_class t ON t.oid = con.conrelid
       JOIN pg_namespace tns ON tns.oid = t.relnamespace
       JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
       JOIN pg_class ft ON ft.oid = con.confrelid
       JOIN pg_namespace fns ON fns.oid = ft.relnamespace
       JOIN pg_attribute fa ON fa.attrelid = con.confrelid AND fa.attnum = con.confkey[1]
       WHERE con.contype = 'f'
         AND cardinality(con.conkey) = 1
         AND tns.nspname = $1
         AND t.relname = $2`,
      [schema, table]
    )

    const fkByCol = new Map(fks.map((f) => [f.column_name, f]))
    return cols.map((c) => {
      const fk = fkByCol.get(c.name)
      return {
        ...c,
        foreign_schema: fk ? fk.foreign_schema : null,
        foreign_table: fk ? fk.foreign_table : null,
        foreign_column: fk ? fk.foreign_column : null,
        fk_constraint_name: fk ? fk.constraint_name : null,
      }
    })
  }

  async listSchemaInfo(id) {
    const pool = this.pools.get(id)
    if (!pool) throw new Error('No active connection')
    const { rows } = await pool.query(
      `SELECT
         t.table_schema,
         t.table_name,
         t.table_type,
         c.column_name,
         c.data_type,
         c.udt_name,
         c.ordinal_position
       FROM information_schema.tables t
       LEFT JOIN information_schema.columns c
         ON c.table_schema = t.table_schema
         AND c.table_name = t.table_name
       WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
         AND t.table_schema NOT LIKE 'pg_%'
       ORDER BY t.table_schema, t.table_name, c.ordinal_position NULLS LAST`
    )
    const tableMap = new Map()
    for (const row of rows) {
      const key = `${row.table_schema}.${row.table_name}`
      if (!tableMap.has(key)) {
        tableMap.set(key, {
          schema: row.table_schema,
          name: row.table_name,
          type: row.table_type === 'VIEW' ? 'VIEW' : 'TABLE',
          columns: [],
        })
      }
      if (row.column_name) {
        tableMap.get(key).columns.push({
          name: row.column_name,
          type: row.data_type,
          udt_name: row.udt_name,
        })
      }
    }
    return Array.from(tableMap.values())
  }

  async exportRows(id, schema, table, { filters = [], orderBy = null, limit = null } = {}) {
    const pool = this.pools.get(id)
    if (!pool) throw new Error('No active connection')
    this._validateIdent(schema)
    this._validateIdent(table)

    const { whereClause, params } = this._buildWhere(filters)

    let orderClause = ''
    if (orderBy && typeof orderBy.column === 'string') {
      this._validateIdent(orderBy.column)
      const dir = orderBy.direction === 'desc' ? 'DESC' : 'ASC'
      orderClause = ` ORDER BY ${this._qi(orderBy.column)} ${dir}`
    }

    const limitClause = limit != null ? ` LIMIT ${Math.max(1, Math.floor(Number(limit)))}` : ''

    const sql = `SELECT * FROM ${this._qi(schema)}.${this._qi(table)}${whereClause}${orderClause}${limitClause}`
    const result = await pool.query(sql, params)
    return {
      rows: result.rows,
      fields: result.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
    }
  }

  async countTableRows(id, schema, table, filters = []) {
    const pool = this.pools.get(id)
    if (!pool) throw new Error('No active connection')
    this._validateIdent(schema)
    this._validateIdent(table)
    const { whereClause, params } = this._buildWhere(filters)
    const sql = `SELECT COUNT(*)::bigint AS count FROM ${this._qi(schema)}.${this._qi(table)}${whereClause}`
    const { rows } = await pool.query(sql, params)
    return Number(rows[0].count)
  }

  async browseTable(id, schema, table, options = {}) {
    const pool = this.pools.get(id)
    if (!pool) throw new Error('No active connection')
    this._validateIdent(schema)
    this._validateIdent(table)

    const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 1000)
    const offset = Math.max(Number(options.offset) || 0, 0)

    const { whereClause, params } = this._buildWhere(options.filters || [])

    let orderClause = ''
    if (options.orderBy && typeof options.orderBy.column === 'string') {
      this._validateIdent(options.orderBy.column)
      const dir = options.orderBy.direction === 'desc' ? 'DESC' : 'ASC'
      orderClause = ` ORDER BY ${this._qi(options.orderBy.column)} ${dir}`
    }

    const sql = `SELECT * FROM ${this._qi(schema)}.${this._qi(table)}${whereClause}${orderClause} LIMIT ${limit} OFFSET ${offset}`

    const start = Date.now()
    try {
      const result = await pool.query(sql, params)
      return {
        rows: result.rows,
        fields: result.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
        duration: Date.now() - start,
        limit,
        offset,
      }
    } catch (err) {
      throw new Error(this._friendlyError(err))
    }
  }

  _buildWhere(filters) {
    if (!Array.isArray(filters) || filters.length === 0) {
      return { whereClause: '', params: [] }
    }
    const ALLOWED_OPS = new Set([
      '=', '!=', '<', '<=', '>', '>=',
      'LIKE', 'ILIKE', 'NOT LIKE', 'NOT ILIKE',
      'IS NULL', 'IS NOT NULL',
      'IS TRUE', 'IS FALSE',
      'BETWEEN',
    ])
    const clauses = []
    const params = []
    for (const f of filters) {
      if (!f || typeof f !== 'object') continue
      if (typeof f.column !== 'string') continue
      this._validateIdent(f.column)
      const op = String(f.op || '').toUpperCase()
      if (!ALLOWED_OPS.has(op)) continue
      const col = this._qi(f.column)

      if (op === 'IS NULL' || op === 'IS NOT NULL' || op === 'IS TRUE' || op === 'IS FALSE') {
        clauses.push(`${col} ${op}`)
      } else if (op === 'BETWEEN') {
        params.push(f.value)
        const p1 = `$${params.length}`
        params.push(f.value2)
        const p2 = `$${params.length}`
        clauses.push(`${col} BETWEEN ${p1} AND ${p2}`)
      } else {
        params.push(f.value)
        clauses.push(`${col} ${op} $${params.length}`)
      }
    }
    return {
      whereClause: clauses.length ? ' WHERE ' + clauses.join(' AND ') : '',
      params,
    }
  }

  _validateIdent(name) {
    if (typeof name !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_$]{0,62}$/.test(name)) {
      throw new Error(`Invalid identifier: ${name}`)
    }
  }

  _qi(name) {
    return '"' + String(name).replace(/"/g, '""') + '"'
  }

  _friendlyError(err) {
    const msg = err?.message || String(err)
    if (err?.code === 'ENOTFOUND' || /ENOTFOUND/.test(msg)) {
      const host = err?.hostname || (msg.match(/ENOTFOUND (\S+)/) || [])[1] || 'host'
      let hint = `Cannot resolve host "${host}".`
      if (/supabase\.co$/i.test(host) && !/pooler\./i.test(host)) {
        hint +=
          ' Supabase direct hosts are IPv6-only on free tier — use the Session Pooler URL (host: aws-X-<region>.pooler.supabase.com, port 6543, user postgres.<project_ref>).'
      } else {
        hint += ' Check the hostname, your DNS, or your network (IPv6 only?).'
      }
      return hint
    }
    if (err?.code === 'ETIMEDOUT' || /ETIMEDOUT|timeout/i.test(msg)) {
      return 'Connection timed out. The host is unreachable or a firewall is blocking the port.'
    }
    if (err?.code === 'ECONNREFUSED') {
      return 'Connection refused. The server is not accepting connections on this port (container stopped? wrong port?).'
    }
    if (err?.code === 'ECONNRESET' || /ECONNRESET/.test(msg)) {
      return 'Connection reset. The server closed the connection unexpectedly (often an SSL mismatch).'
    }
    if (/self[- ]signed certificate|SELF_SIGNED_CERT_IN_CHAIN|unable to verify the first certificate/i.test(msg)) {
      return 'SSL certificate could not be verified. Try SSL mode "Require" instead of "Verify full".'
    }
    if (/no pg_hba.conf entry|SSL connection is required/i.test(msg)) {
      return 'The server requires SSL. Switch SSL mode to "Require" or "Verify full".'
    }
    if (err?.code === '28P01') {
      return 'Authentication failed. Check your user and password.'
    }
    if (err?.code === '28000') {
      return 'Authentication method not allowed. Check pg_hba or SSL requirements.'
    }
    if (err?.code === '3D000') {
      return `Database does not exist: ${err.message}`
    }
    if (err?.code === '42601') {
      return `SQL syntax error: ${err.message}`
    }
    if (err?.code === '42P01') {
      return `Table not found: ${err.message}`
    }
    return msg
  }
}

module.exports = DbService
