const { Pool } = require('pg');
const logger = require('./logger').child({ module: 'db' });

const LOG_SQL = String(process.env.LOG_SQL).toLowerCase() === 'true';

// Lazily-created singleton pool. We never throw at module load over missing
// config so the app boots and pages load even when Postgres isn't configured.
let pool;

// Non-creating accessor for metrics — returns undefined until getPool() runs.
function peekPool() {
  return pool;
}

function isConfigured() {
  return Boolean(process.env.DATABASE_URL || process.env.PGHOST);
}

function getPool() {
  if (pool) return pool;

  const config = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST,
        port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE,
      };

  if (sslEnabled()) {
    config.ssl = { rejectUnauthorized: false };
  }

  pool = new Pool(config);

  // An error on an idle client would otherwise crash the process.
  pool.on('error', (err) => {
    logger.error('postgres pool error', { err });
  });

  return pool;
}

// Non-sensitive view of the connection target for display. Never exposes
// the password — only whether one is set.
function safeConfig() {
  if (process.env.DATABASE_URL) {
    let parsed = {};
    try {
      const u = new URL(process.env.DATABASE_URL);
      parsed = {
        host: u.hostname || null,
        port: u.port || '5432',
        user: u.username || null,
        database: u.pathname ? u.pathname.replace(/^\//, '') : null,
        passwordSet: u.password !== '',
      };
    } catch (_) {
      parsed = { parseError: true };
    }
    return { configured: true, source: 'DATABASE_URL', ssl: sslEnabled(), ...parsed };
  }

  if (process.env.PGHOST) {
    return {
      configured: true,
      source: 'PG* vars',
      host: process.env.PGHOST,
      port: process.env.PGPORT || '5432',
      user: process.env.PGUSER || null,
      database: process.env.PGDATABASE || null,
      passwordSet: Boolean(process.env.PGPASSWORD),
      ssl: sslEnabled(),
    };
  }

  return { configured: false };
}

function sslEnabled() {
  return String(process.env.PGSSL).toLowerCase() === 'true';
}

async function ping() {
  const start = Date.now();
  try {
    const result = await getPool().query('SELECT now() AS server_time, version() AS version');
    logger.info('postgres ping ok', { durationMs: Date.now() - start });
    return {
      serverTime: result.rows[0].server_time,
      version: result.rows[0].version,
    };
  } catch (err) {
    logger.warn('postgres ping failed', { durationMs: Date.now() - start, err });
    throw err;
  }
}

async function query(text, params) {
  const start = Date.now();
  // SQL is arbitrary user input — only log it (truncated, never param values)
  // when explicitly opted in via LOG_SQL.
  const sqlFields = LOG_SQL
    ? { sql: String(text).slice(0, 500), paramsCount: Array.isArray(params) ? params.length : 0 }
    : {};
  try {
    const result = await getPool().query(text, params);
    logger.info('postgres query ok', {
      rowCount: result.rowCount,
      durationMs: Date.now() - start,
      ...sqlFields,
    });
    return {
      rows: result.rows,
      fields: (result.fields || []).map((f) => ({ name: f.name })),
      rowCount: result.rowCount,
    };
  } catch (err) {
    logger.warn('postgres query failed', { durationMs: Date.now() - start, err, ...sqlFields });
    throw err;
  }
}

module.exports = { isConfigured, safeConfig, ping, query, peekPool };
