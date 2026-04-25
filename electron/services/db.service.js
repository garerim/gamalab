const { Pool } = require('pg')
const crypto = require('crypto')
const logger = require('./logger.service')

function decodeFkAction(code) {
  switch (code) {
    case 'a': return 'NO ACTION'
    case 'r': return 'RESTRICT'
    case 'c': return 'CASCADE'
    case 'n': return 'SET NULL'
    case 'd': return 'SET DEFAULT'
    default: return 'NO ACTION'
  }
}

class DbService {
  constructor() {
    this.pools = new Map()
    // Sanitized config kept around so we can rebuild a pool transparently
    // when an idle connection drops (auto-reconnect on connection-class errors).
    this.poolConfigs = new Map()
  }

  _connectionId(config) {
    const key = `${config.host}:${config.port}:${config.database}:${config.user}`
    return crypto.createHash('sha1').update(key).digest('hex').substring(0, 16)
  }

  _buildSslConfig(sslMode) {
    const mode = sslMode || 'disable'
    if (mode === 'require') return { rejectUnauthorized: false }
    if (mode === 'verify-full') return { rejectUnauthorized: true }
    // pg lib falls back to non-SSL if SSL fails
    if (mode === 'prefer') return { rejectUnauthorized: false }
    return false
  }

  async connect(config) {
    const id = config.id || this._connectionId(config)

    if (this.pools.has(id)) {
      await this.disconnect(id)
    }

    const sslConfig = this._buildSslConfig(config.sslMode)

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
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    })

    // Without an `error` listener, an idle client error (server restart,
    // network drop, idle timeout from the cloud DB) becomes an UNCAUGHT
    // EXCEPTION and crashes the whole Electron main process.
    pool.on('error', (err) => {
      console.error(`[db pool ${id}] idle client error:`, err?.message || err)
    })

    try {
      const client = await pool.connect()
      const result = await client.query('SELECT version()')
      client.release()

      this.pools.set(id, pool)
      // Stash a copy of the config so we can rebuild this pool on a stale
      // connection drop. The id is forced so reconnects keep the same key.
      this.poolConfigs.set(id, { ...config, id })

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
      this.poolConfigs.delete(id)
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

  async ping(id) {
    const pool = this.pools.get(id)
    if (!pool) return { ok: false, error: 'No active connection.' }
    const start = Date.now()
    try {
      await pool.query('SELECT 1')
      return { ok: true, duration: Date.now() - start }
    } catch (err) {
      return {
        ok: false,
        duration: Date.now() - start,
        error: this._friendlyError(err),
      }
    }
  }

  async testConnection(config) {
    const start = Date.now()
    // Same shape as connect(), but never stored in this.pools.
    const pool = new Pool({
      host: config.host,
      port: Number(config.port),
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: this._buildSslConfig(config.sslMode),
      connectionTimeoutMillis: 10000,
      max: 1,
      idleTimeoutMillis: 1,
    })
    try {
      const { rows } = await pool.query(
        'SELECT version() AS version, current_user AS "user", current_database() AS database'
      )
      return {
        ok: true,
        version: rows[0].version.split(' on ')[0],
        user: rows[0].user,
        database: rows[0].database,
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      return { ok: false, error: this._friendlyError(err), latencyMs: Date.now() - start }
    } finally {
      await pool.end().catch(() => {})
    }
  }

  /**
   * Detect an error class that indicates the underlying TCP connection or
   * server session is dead — these are recoverable by rebuilding the pool,
   * unlike e.g. syntax errors or permission issues.
   */
  _isConnectionError(err) {
    if (!err) return false
    const code = err.code
    if (
      code === '08000' ||
      code === '08001' ||
      code === '08003' ||
      code === '08004' ||
      code === '08006' ||
      code === '57P01' ||
      code === '57P02' ||
      code === '57P03' ||
      code === 'ECONNRESET' ||
      code === 'EPIPE' ||
      code === 'ETIMEDOUT'
    ) {
      return true
    }
    const msg = err.message || String(err)
    return /Connection terminated|Client has encountered a connection error|server closed the connection unexpectedly|read ECONNRESET|write EPIPE|connection has been closed/i.test(
      msg
    )
  }

  /**
   * Tear down the existing pool for `id` and rebuild it from the cached
   * config. Returns the new pool, or null if no config is known.
   */
  async _rebuildPool(id) {
    const config = this.poolConfigs.get(id)
    if (!config) return null
    // Drop the dead pool first; connect() will repopulate both maps.
    const dead = this.pools.get(id)
    if (dead) {
      await dead.end().catch(() => {})
      this.pools.delete(id)
      // Keep poolConfigs around — connect() will overwrite it
    }
    await this.connect(config)
    return this.pools.get(id) || null
  }

  async query(id, sql, params = []) {
    let pool = this.pools.get(id)
    if (!pool) throw new Error('No active connection. Please connect first.')

    const exec = async (p) => {
      const start = Date.now()
      const result = await p.query(sql, params)
      const duration = Date.now() - start
      if (Array.isArray(result)) {
        return {
          multi: true,
          results: result.map((r) => this._mapResult(r, duration)),
          duration,
        }
      }
      return this._mapResult(result, duration)
    }

    try {
      return await exec(pool)
    } catch (err) {
      // Auto-reconnect: only on connection-class errors, single retry.
      // Skip retry for transactional statements — restarting the pool would
      // silently abandon the in-flight transaction state and confuse callers.
      const trimmed = (sql || '').trim().toUpperCase()
      const isTxStmt = /^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/.test(trimmed)
      if (this._isConnectionError(err) && !isTxStmt) {
        try {
          const newPool = await this._rebuildPool(id)
          if (newPool) return await exec(newPool)
        } catch (retryErr) {
          throw new Error(this._friendlyError(retryErr))
        }
      }
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

  /**
   * One-shot schema dump used by the Schema Diagram view.
   * Returns tables + columns + PK/UQ/FK flags + indexes + row counts.
   *
   * @param {string} id - connection id
   * @param {{ exactCounts?: boolean }} opts
   * @returns {Promise<{tables: Array, columns: Array, indexes: Array}>}
   */
  async listFullSchema(id, { exactCounts = false } = {}) {
    const pool = this.pools.get(id)
    if (!pool) throw new Error('No active connection')

    // Run all metadata queries in parallel — they're independent.
    const [tablesRes, columnsRes, pksRes, fksRes, uqsRes, indexesRes, estCountsRes] =
      await Promise.all([
        // 1) Tables (user schemas only)
        pool.query(
          `SELECT schemaname AS schema, tablename AS name
           FROM pg_tables
           WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
             AND schemaname NOT LIKE 'pg_%'
           ORDER BY schemaname, tablename`
        ),
        // 2) Columns with type info
        pool.query(
          `SELECT
             c.table_schema AS schema,
             c.table_name   AS table_name,
             c.column_name  AS name,
             c.data_type    AS data_type,
             c.udt_name     AS udt_name,
             c.is_nullable = 'YES' AS nullable,
             c.column_default AS default_value,
             c.character_maximum_length AS max_length,
             c.ordinal_position AS position
           FROM information_schema.columns c
           JOIN information_schema.tables t
             ON t.table_schema = c.table_schema AND t.table_name = c.table_name
           WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
             AND c.table_schema NOT LIKE 'pg_%'
             AND t.table_type = 'BASE TABLE'
           ORDER BY c.table_schema, c.table_name, c.ordinal_position`
        ),
        // 3) Primary keys
        pool.query(
          `SELECT tns.nspname AS schema, t.relname AS table_name, a.attname AS column_name
           FROM pg_constraint con
           JOIN pg_class t ON t.oid = con.conrelid
           JOIN pg_namespace tns ON tns.oid = t.relnamespace
           JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
           JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
           WHERE con.contype = 'p'
             AND tns.nspname NOT IN ('pg_catalog', 'information_schema')
             AND tns.nspname NOT LIKE 'pg_%'`
        ),
        // 4) Foreign keys (single-column; composite rendered as single edge on 1st col)
        pool.query(
          `SELECT
             tns.nspname AS schema,
             t.relname AS table_name,
             a.attname AS column_name,
             fns.nspname AS target_schema,
             ft.relname AS target_table,
             fa.attname AS target_column,
             con.confdeltype AS on_delete,
             con.confupdtype AS on_update
           FROM pg_constraint con
           JOIN pg_class t ON t.oid = con.conrelid
           JOIN pg_namespace tns ON tns.oid = t.relnamespace
           JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
           JOIN pg_class ft ON ft.oid = con.confrelid
           JOIN pg_namespace fns ON fns.oid = ft.relnamespace
           JOIN pg_attribute fa ON fa.attrelid = con.confrelid AND fa.attnum = con.confkey[1]
           WHERE con.contype = 'f'
             AND tns.nspname NOT IN ('pg_catalog', 'information_schema')
             AND tns.nspname NOT LIKE 'pg_%'`
        ),
        // 5) Unique constraints (single-column)
        pool.query(
          `SELECT tns.nspname AS schema, t.relname AS table_name, a.attname AS column_name
           FROM pg_constraint con
           JOIN pg_class t ON t.oid = con.conrelid
           JOIN pg_namespace tns ON tns.oid = t.relnamespace
           JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
           WHERE con.contype = 'u'
             AND cardinality(con.conkey) = 1
             AND tns.nspname NOT IN ('pg_catalog', 'information_schema')
             AND tns.nspname NOT LIKE 'pg_%'`
        ),
        // 6) Indexes — exclude those backing PK / UQ constraints
        pool.query(
          `SELECT
             ns.nspname AS schema,
             t.relname AS table_name,
             i.relname AS name,
             ix.indisunique AS is_unique,
             ARRAY(
               SELECT a.attname
               FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
               ORDER BY k.ord
             ) AS columns
           FROM pg_index ix
           JOIN pg_class i ON i.oid = ix.indexrelid
           JOIN pg_class t ON t.oid = ix.indrelid
           JOIN pg_namespace ns ON ns.oid = t.relnamespace
           WHERE NOT ix.indisprimary
             AND NOT EXISTS (
               SELECT 1 FROM pg_constraint con
               WHERE con.conindid = ix.indexrelid AND con.contype = 'u'
             )
             AND ns.nspname NOT IN ('pg_catalog', 'information_schema')
             AND ns.nspname NOT LIKE 'pg_%'`
        ),
        // 7) Estimated row counts (always — fast, used as fallback even when exactCounts=true)
        pool.query(
          `SELECT ns.nspname AS schema, c.relname AS name, c.reltuples::bigint AS est
           FROM pg_class c
           JOIN pg_namespace ns ON ns.oid = c.relnamespace
           WHERE c.relkind = 'r'
             AND ns.nspname NOT IN ('pg_catalog', 'information_schema')
             AND ns.nspname NOT LIKE 'pg_%'`
        ),
      ])

    // Build lookup sets for quick membership tests
    const pkSet = new Set(pksRes.rows.map((r) => `${r.schema}.${r.table_name}.${r.column_name}`))
    const uqSet = new Set(uqsRes.rows.map((r) => `${r.schema}.${r.table_name}.${r.column_name}`))
    const fkMap = new Map()
    for (const r of fksRes.rows) {
      const key = `${r.schema}.${r.table_name}.${r.column_name}`
      fkMap.set(key, {
        targetTable: `${r.target_schema}.${r.target_table}`,
        targetColumn: r.target_column,
        onDelete: decodeFkAction(r.on_delete),
        onUpdate: decodeFkAction(r.on_update),
      })
    }

    // Row counts — estimate always available; exact overrides per-table if requested
    const countByKey = new Map()
    for (const r of estCountsRes.rows) {
      countByKey.set(`${r.schema}.${r.name}`, { rowCount: Number(r.est), isEstimate: true })
    }

    if (exactCounts) {
      // One UNION ALL query to get COUNT(*) for every table — single round-trip.
      if (tablesRes.rows.length > 0) {
        const parts = tablesRes.rows.map(
          (t) =>
            `SELECT ${pool.escapeLiteral ? pool.escapeLiteral(t.schema) : `'${t.schema}'`} AS s, ` +
            `${pool.escapeLiteral ? pool.escapeLiteral(t.name) : `'${t.name}'`} AS n, ` +
            `(SELECT COUNT(*)::bigint FROM ${this._qi(t.schema)}.${this._qi(t.name)}) AS c`
        )
        const { rows: exactRows } = await pool.query(parts.join(' UNION ALL '))
        for (const r of exactRows) {
          countByKey.set(`${r.s}.${r.n}`, { rowCount: Number(r.c), isEstimate: false })
        }
      }
    }

    // Shape the final response
    const tables = tablesRes.rows.map((t) => {
      const { rowCount = 0, isEstimate = true } = countByKey.get(`${t.schema}.${t.name}`) || {}
      return { schema: t.schema, name: t.name, rowCount, isEstimate }
    })

    const columns = columnsRes.rows.map((c) => {
      const key = `${c.schema}.${c.table_name}.${c.name}`
      const fk = fkMap.get(key) || null
      // Normalize type string: prefer udt for e.g. int4, varchar; append length when relevant
      let type = c.udt_name || c.data_type
      if (c.max_length && typeof c.max_length === 'number') type += `(${c.max_length})`
      return {
        tableKey: `${c.schema}.${c.table_name}`,
        name: c.name,
        type,
        nullable: !!c.nullable,
        default: c.default_value,
        isPrimary: pkSet.has(key),
        isUnique: uqSet.has(key),
        foreignKey: fk,
        maxLength: c.max_length || null,
      }
    })

    const indexes = indexesRes.rows.map((i) => ({
      tableKey: `${i.schema}.${i.table_name}`,
      name: i.name,
      columns: i.columns,
      isUnique: !!i.is_unique,
    }))

    return { tables, columns, indexes }
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
      return `Database "${err.message?.match(/database "([^"]+)"/)?.[1] || ''}" does not exist. It may have been dropped — try disconnecting and reconnecting.`
    }
    if (err?.code === '42601') {
      return `SQL syntax error: ${err.message}`
    }
    if (err?.code === '42P01') {
      return `Table not found: ${err.message}. The schema may have changed — refresh the tables list.`
    }
    if (err?.code === '42501') {
      return `Permission denied: your user lacks the required privileges. ${err.message}`
    }
    if (err?.code === '53300') {
      return 'Too many connections to the server. Close some clients and retry.'
    }
    if (err?.code === '57014') {
      return 'Query was cancelled (statement timeout exceeded?).'
    }
    if (err?.code === '25P02') {
      return 'Transaction is in a failed state — rolling back. Re-run your statement.'
    }
    // Connection-related errors — server gone away, network dropped, etc.
    if (
      err?.code === '08000' ||
      err?.code === '08003' ||
      err?.code === '08006' ||
      err?.code === '08001' ||
      err?.code === '08004' ||
      err?.code === '57P01' ||
      err?.code === '57P02' ||
      err?.code === '57P03' ||
      /Connection terminated|Client has encountered a connection error|server closed the connection unexpectedly|read ECONNRESET|write EPIPE/i.test(msg)
    ) {
      return 'Connection lost. The server closed or restarted. Reconnect to continue.'
    }
    return msg
  }
}

module.exports = DbService
