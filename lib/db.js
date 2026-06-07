const { Pool } = require('pg');

// Lazily-created singleton pool. We never throw at module load over missing
// config so the app boots and pages load even when Postgres isn't configured.
let pool;

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
    console.error('Unexpected Postgres pool error:', err.message);
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
  const result = await getPool().query('SELECT now() AS server_time, version() AS version');
  return {
    serverTime: result.rows[0].server_time,
    version: result.rows[0].version,
  };
}

async function query(text, params) {
  const result = await getPool().query(text, params);
  return {
    rows: result.rows,
    fields: (result.fields || []).map((f) => ({ name: f.name })),
    rowCount: result.rowCount,
  };
}

module.exports = { isConfigured, safeConfig, ping, query };
