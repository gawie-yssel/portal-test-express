require('dotenv').config();

const path = require('path');
const express = require('express');
const multer = require('multer');

const postgresRouter = require('./routes/postgres');
const s3Router = require('./routes/s3');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
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
  res.status(status).json({ ok: false, error: err.message });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
