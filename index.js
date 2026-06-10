require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const logger = require('./lib/logger');
const db = require('./lib/db');
const s3 = require('./lib/s3');
const postgresRouter = require('./routes/postgres');
const s3Router = require('./routes/s3');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Per-request id + structured lifecycle logging. Attaches a child logger as
// req.log (carrying the reqId) for downstream handlers, and logs one line per
// request on completion. /health and static assets are logged at debug to keep
// probe/asset noise out of the default info stream.
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('x-request-id', req.id);
  req.log = logger.child({ reqId: req.id });

  const start = Date.now();
  res.on('finish', () => {
    const fields = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start,
    };
    const quiet = req.path === '/health' || res.statusCode === 304;
    if (res.statusCode >= 500) req.log.error('request', fields);
    else if (res.statusCode >= 400) req.log.warn('request', fields);
    else if (quiet) req.log.debug('request', fields);
    else req.log.info('request', fields);
  });

  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

app.use('/api/postgres', postgresRouter);
app.use('/api/s3', s3Router);

// Centralised error handler — turns multer/upload failures and any other
// thrown errors into the uniform { ok:false, error } shape.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err instanceof multer.MulterError ? 400 : 500;
  (req.log || logger).error('request failed', { status, err });
  res.status(status).json({ ok: false, error: err.message });
});

app.listen(port, () => {
  logger.info('server started', {
    port,
    postgres: db.safeConfig(),
    s3: s3.safeConfig(),
  });
});
