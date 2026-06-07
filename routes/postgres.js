const express = require('express');
const db = require('../lib/db');

const router = express.Router();

// Reject requests early when Postgres env vars aren't set.
function requireConfigured(req, res, next) {
  if (!db.isConfigured()) {
    return res.status(503).json({
      ok: false,
      error: 'Postgres is not configured. Set DATABASE_URL or PGHOST/PGUSER/PGDATABASE.',
    });
  }
  next();
}

// Sanitized config for display — never gated by requireConfigured so the
// page can show "not configured" too.
router.get('/config', (req, res) => {
  res.json({ ok: true, config: db.safeConfig() });
});

router.get('/ping', requireConfigured, async (req, res) => {
  try {
    const info = await db.ping();
    res.json({ ok: true, ...info });
  } catch (err) {
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

  try {
    const result = await db.query(sql, params);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
