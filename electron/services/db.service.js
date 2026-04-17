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

    const pool = new Pool({
      host: config.host || '127.0.0.1',
      port: config.port || 5432,
      user: config.user || 'postgres',
      password: config.password || '',
      database: config.database || 'postgres',
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 60000,
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
    const { rows } = await pool.query(
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
    return rows
  }

  async countTableRows(id, schema, table) {
    const pool = this.pools.get(id)
    if (!pool) throw new Error('No active connection')
    this._validateIdent(schema)
    this._validateIdent(table)
    const sql = `SELECT COUNT(*)::bigint AS count FROM ${this._qi(schema)}.${this._qi(table)}`
    const { rows } = await pool.query(sql)
    return Number(rows[0].count)
  }

  async browseTable(id, schema, table, options = {}) {
    const pool = this.pools.get(id)
    if (!pool) throw new Error('No active connection')
    this._validateIdent(schema)
    this._validateIdent(table)

    const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 1000)
    const offset = Math.max(Number(options.offset) || 0, 0)

    let orderClause = ''
    if (options.orderBy && typeof options.orderBy.column === 'string') {
      this._validateIdent(options.orderBy.column)
      const dir = options.orderBy.direction === 'desc' ? 'DESC' : 'ASC'
      orderClause = ` ORDER BY ${this._qi(options.orderBy.column)} ${dir}`
    }

    const sql = `SELECT * FROM ${this._qi(schema)}.${this._qi(table)}${orderClause} LIMIT ${limit} OFFSET ${offset}`

    const start = Date.now()
    try {
      const result = await pool.query(sql)
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
    if (err?.code === 'ECONNREFUSED') {
      return 'Connection refused. Is the PostgreSQL container running?'
    }
    if (err?.code === '28P01') {
      return 'Authentication failed. Check your user and password.'
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
