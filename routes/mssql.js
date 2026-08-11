const express = require('express');
const mssql = require('../lib/mssql');

const router = express.Router();

// Reject requests early when MSSQL env vars aren't set.
function requireConfigured(req, res, next) {
  if (!mssql.isConfigured()) {
    return res.status(503).json({
      ok: false,
      error:
        'MSSQL is not configured. Set MSSQL_CONNECTION_STRING or MSSQL_HOST/MSSQL_USER/MSSQL_DATABASE.',
    });
  }
  next();
}

// Sanitized config for display — never gated by requireConfigured so the
// page can show "not configured" too.
router.get('/config', (req, res) => {
  res.json({ ok: true, config: mssql.safeConfig() });
});

router.get('/ping', requireConfigured, async (req, res) => {
  try {
    const info = await mssql.ping();
    res.json({ ok: true, ...info });
  } catch (err) {
    req.log.warn('mssql ping failed', { err });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/query', requireConfigured, async (req, res) => {
  const { sql, params } = req.body || {};

  if (!sql || !String(sql).trim()) {
    return res.status(400).json({ ok: false, error: 'A non-empty "sql" string is required.' });
  }
  if (params !== undefined && !Array.isArray(params)) {
    return res.status(400).json({ ok: false, error: '"params" must be an array if provided.' });
  }
  // mssql infers the SQL type from the JS value, so an object would be silently
  // coerced to NVarChar. Reject it with a clear 400 instead.
  if (Array.isArray(params) && params.some((v) => v !== null && typeof v === 'object')) {
    return res.status(400).json({
      ok: false,
      error: '"params" must contain only strings, numbers, booleans, or null.',
    });
  }

  try {
    const result = await mssql.query(sql, params);
    res.json({ ok: true, ...result });
  } catch (err) {
    req.log.warn('mssql query failed', { err });
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
