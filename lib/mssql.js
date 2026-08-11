const sql = require('mssql');
const logger = require('./logger').child({ module: 'mssql' });

const LOG_SQL = String(process.env.LOG_SQL).toLowerCase() === 'true';

// Lazily-created singleton pool. We never throw at module load over missing
// config so the app boots and pages load even when MSSQL isn't configured.
//
// Unlike pg, an mssql pool must be *explicitly* connected (an async step) and
// refuses a second connect() on the same instance, so we cache the connect()
// promise — not just the pool — and concurrent first requests share one attempt.
let pool; // ConnectionPool instance, readable synchronously by lib/metrics.js
let poolPromise; // in-flight or settled connect()

// Non-creating accessor for metrics — returns undefined until getPool() runs.
function peekPool() {
  return pool;
}

function isConfigured() {
  return Boolean(process.env.MSSQL_CONNECTION_STRING || process.env.MSSQL_HOST);
}

// "true"/"false" env flag with a real default. The repo's usual
// String(x).toLowerCase() === 'true' one-liner can't express default-true,
// and both MSSQL TLS flags default to true.
function boolEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  return String(raw).toLowerCase() === 'true';
}

const encryptEnabled = () => boolEnv('MSSQL_ENCRYPT', true);
const trustServerCert = () => boolEnv('MSSQL_TRUST_SERVER_CERTIFICATE', true);

function buildConfig() {
  // A connection string goes through verbatim, and mssql parses it. Only the
  // ADO form (Server=host,1433;Database=db;...) is supported by mssql v12 —
  // see safeConfig() for how an unparseable value is surfaced. Encrypt and
  // TrustServerCertificate inside the string win; MSSQL_ENCRYPT and
  // MSSQL_TRUST_SERVER_CERTIFICATE apply to the discrete vars only.
  if (process.env.MSSQL_CONNECTION_STRING) return process.env.MSSQL_CONNECTION_STRING;

  return {
    server: process.env.MSSQL_HOST, // mssql's key is "server", not "host"
    port: process.env.MSSQL_PORT ? Number(process.env.MSSQL_PORT) : 1433,
    user: process.env.MSSQL_USER,
    password: process.env.MSSQL_PASSWORD,
    database: process.env.MSSQL_DATABASE,
    connectionTimeout: 15000,
    requestTimeout: 30000,
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    options: {
      encrypt: encryptEnabled(),
      trustServerCertificate: trustServerCert(),
    },
  };
}

function getPool() {
  if (poolPromise) return poolPromise;

  const instance = new sql.ConnectionPool(buildConfig());

  // An error on an idle/broken connection would otherwise crash the process
  // (same reason as the pg pool handler in lib/db.js). Deliberately does not
  // discard the cached pool: a transient per-connection error would throw away
  // a healthy pool and leak its sockets, and tarn already replaces dead
  // connections. Optional hardening, if a dead pool ever survives a server
  // restart: on a fatal err.code === 'ECONNCLOSED', clear pool/poolPromise and
  // close the instance so the next request rebuilds it.
  instance.on('error', (err) => {
    logger.error('mssql pool error', { err });
  });

  pool = instance;
  poolPromise = instance.connect().catch((err) => {
    // Never cache a pool that failed to connect — mssql won't allow a second
    // connect() on it, so drop it and let the next request build a fresh one.
    // Otherwise one bad first attempt breaks the page until restart.
    if (pool === instance) pool = undefined;
    poolPromise = undefined;
    // Deferred so a synchronous throw from close() on a never-connected pool
    // can't escape this handler.
    Promise.resolve()
      .then(() => instance.close())
      .catch(() => {});
    throw err;
  });

  return poolPromise;
}

// Non-sensitive view of the connection target for display. Never exposes
// the password — only whether one is set.
function safeConfig() {
  if (process.env.MSSQL_CONNECTION_STRING) {
    let parsed = {};
    try {
      // Reuse mssql's own parser rather than hand-rolling one. This static
      // method does no I/O and needs no pool instance.
      const c = sql.ConnectionPool.parseConnectionString(
        process.env.MSSQL_CONNECTION_STRING
      );
      const options = c.options || {};
      // The parser doesn't throw on an unparseable value — it returns a config
      // with no server — so treat a missing server as the parse failure it is.
      // Note mssql v12 accepts only the ADO Key=Value; form: an "mssql://" URI
      // parses to nothing and lands here.
      if (!c.server) throw new Error('no server in connection string');
      parsed = {
        host: c.server,
        port: c.port ? String(c.port) : '1433',
        user: c.user || null,
        database: c.database || null,
        passwordSet: Boolean(c.password),
        encrypt: Boolean(options.encrypt),
        trustServerCertificate: Boolean(options.trustServerCertificate),
      };
    } catch (_) {
      parsed = { parseError: true };
    }
    return { configured: true, source: 'MSSQL_CONNECTION_STRING', ...parsed };
  }

  if (process.env.MSSQL_HOST) {
    return {
      configured: true,
      source: 'MSSQL_* vars',
      host: process.env.MSSQL_HOST,
      port: process.env.MSSQL_PORT || '1433',
      user: process.env.MSSQL_USER || null,
      database: process.env.MSSQL_DATABASE || null,
      passwordSet: Boolean(process.env.MSSQL_PASSWORD),
      encrypt: encryptEnabled(),
      trustServerCertificate: trustServerCert(),
    };
  }

  return { configured: false };
}

async function ping() {
  const start = Date.now();
  try {
    const p = await getPool();
    // SYSDATETIMEOFFSET(), not SYSDATETIME(): tedious decodes as UTC by
    // default, so an offset-less datetime2 from a non-UTC server would report
    // the wrong instant.
    const result = await p
      .request()
      .query('SELECT SYSDATETIMEOFFSET() AS server_time, @@VERSION AS version');
    logger.info('mssql ping ok', { durationMs: Date.now() - start });
    return {
      serverTime: result.recordset[0].server_time,
      version: result.recordset[0].version,
    };
  } catch (err) {
    logger.warn('mssql ping failed', { durationMs: Date.now() - start, err });
    throw err;
  }
}

// mssql returns { recordset, recordsets, rowsAffected, output }. Column
// metadata is an object *keyed by column name*, each entry carrying its ordinal
// `index` — flatten it back into this app's { rows, fields: [{name}], rowCount }
// contract so renderTable works unchanged. Only the first recordset of a
// multi-statement batch is returned.
function normalize(result) {
  const recordset = result.recordset || (result.recordsets && result.recordsets[0]) || [];
  const columns = recordset.columns || {};
  // Sort by index so the rendered table keeps the SELECT's column order (key
  // order is usually right, but index is the authority). Duplicate column
  // names collapse — both the metadata and the row objects are name-keyed.
  let fields = Object.entries(columns)
    .sort((a, b) => (a[1].index ?? 0) - (b[1].index ?? 0))
    .map(([name]) => ({ name }));
  // Statements that arrive without metadata still render.
  if (!fields.length && recordset.length) {
    fields = Object.keys(recordset[0]).map((name) => ({ name }));
  }
  const affected = Array.isArray(result.rowsAffected)
    ? result.rowsAffected.reduce((sum, n) => sum + n, 0)
    : 0;
  return {
    // Array.from() yields a plain array: drops the non-index `columns` property
    // so res.json() output stays predictable.
    rows: Array.from(recordset),
    fields,
    // Match pg's rowCount semantics: rows returned for SELECT, rows changed for DML.
    rowCount: recordset.length || affected,
  };
}

async function query(text, params) {
  const start = Date.now();
  // SQL is arbitrary user input — only log it (truncated, never param values)
  // when explicitly opted in via LOG_SQL.
  const sqlFields = LOG_SQL
    ? { sql: String(text).slice(0, 500), paramsCount: Array.isArray(params) ? params.length : 0 }
    : {};
  try {
    const p = await getPool();
    const request = p.request();
    // mssql binds *named* parameters. Expose the app's positional array as
    // @p1..@pN so callers write `WHERE id = @p1` (pg's equivalent is `$1`).
    // Types are inferred from the JS value. Note that with params present the
    // statement runs via sp_executesql, so #temp tables and GO batches don't
    // behave as they would in SSMS.
    (Array.isArray(params) ? params : []).forEach((value, i) => {
      request.input(`p${i + 1}`, value === undefined ? null : value);
    });
    const result = await request.query(text);
    const normalized = normalize(result);
    logger.info('mssql query ok', {
      rowCount: normalized.rowCount,
      durationMs: Date.now() - start,
      ...sqlFields,
    });
    return normalized;
  } catch (err) {
    logger.warn('mssql query failed', { durationMs: Date.now() - start, err, ...sqlFields });
    throw err;
  }
}

module.exports = { isConfigured, safeConfig, ping, query, peekPool };
