const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs/promises');
const path = require('path');
const disk = require('../lib/disk');

const router = express.Router();

// Hold uploads in memory (bounded) and write the buffer straight to disk —
// same approach as the S3 route.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// Cap how much file content we return on read so a huge file can't swamp the
// response or the browser.
const MAX_READ_BYTES = 64 * 1024; // 64 KB

// Reject requests early when DISK_PATH isn't set.
function requireConfigured(req, res, next) {
  if (!disk.isConfigured()) {
    return res.status(503).json({
      ok: false,
      error: 'Disk is not configured. Set DISK_PATH to the mounted volume path.',
    });
  }
  next();
}

// Sanitized config for display — never gated by requireConfigured so the
// page can show "not configured" too.
router.get('/config', (req, res) => {
  res.json({ ok: true, config: disk.safeConfig() });
});

// Round-trip health check: write a temp file, read it back, verify, delete.
router.get('/health', requireConfigured, async (req, res) => {
  const start = Date.now();
  const name = `.disk-health-${crypto.randomUUID()}`;
  const target = disk.resolveSafe(name);
  const payload = `disk-health ${crypto.randomUUID()}`;
  try {
    await fs.writeFile(target, payload);
    const readBack = await fs.readFile(target, 'utf8');
    if (readBack !== payload) {
      throw new Error('Read-back content did not match what was written.');
    }
    await fs.unlink(target);
    const durationMs = Date.now() - start;
    req.log.info('disk health ok', { op: 'health', bytes: Buffer.byteLength(payload), durationMs });
    res.json({ ok: true, bytes: Buffer.byteLength(payload), durationMs });
  } catch (err) {
    // Best-effort cleanup if we wrote but failed afterwards.
    await fs.unlink(target).catch(() => {});
    req.log.warn('disk health failed', { op: 'health', durationMs: Date.now() - start, err });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Capacity for the mount the disk path lives on.
router.get('/stats', requireConfigured, async (req, res) => {
  const start = Date.now();
  try {
    const s = await fs.statfs(disk.basePath());
    const totalBytes = s.blocks * s.bsize;
    const freeBytes = s.bavail * s.bsize;
    const usedBytes = totalBytes - freeBytes;
    req.log.info('disk stats ok', { op: 'stats', durationMs: Date.now() - start });
    res.json({ ok: true, totalBytes, freeBytes, usedBytes });
  } catch (err) {
    req.log.warn('disk stats failed', { op: 'stats', durationMs: Date.now() - start, err });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/list', requireConfigured, async (req, res) => {
  const start = Date.now();
  try {
    const dir = disk.resolveSafe(req.query.prefix || '.');
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    const entries = await Promise.all(
      dirents.map(async (d) => {
        const isDir = d.isDirectory();
        let size = null;
        let mtime = null;
        try {
          const st = await fs.stat(path.join(dir, d.name));
          size = st.size;
          mtime = st.mtime;
        } catch {
          /* entry vanished or unreadable — report what we have */
        }
        return { name: d.name, size, mtime, isDir };
      })
    );
    req.log.info('disk list ok', { op: 'list', count: entries.length, durationMs: Date.now() - start });
    res.json({ ok: true, entries });
  } catch (err) {
    const status = err.status || 500;
    req.log.warn('disk list failed', { op: 'list', durationMs: Date.now() - start, err });
    res.status(status).json({ ok: false, error: err.message });
  }
});

router.post('/write', requireConfigured, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'A file is required (form field "file").' });
  }
  const key = (req.body && req.body.key && req.body.key.trim()) || req.file.originalname;
  const start = Date.now();
  try {
    const target = disk.resolveSafe(key);
    await fs.writeFile(target, req.file.buffer);
    req.log.info('disk write ok', {
      op: 'write',
      key,
      bytes: req.file.size,
      durationMs: Date.now() - start,
    });
    res.json({ ok: true, key, bytes: req.file.size });
  } catch (err) {
    const status = err.status || 500;
    req.log.warn('disk write failed', { op: 'write', key, durationMs: Date.now() - start, err });
    res.status(status).json({ ok: false, error: err.message });
  }
});

router.get('/read', requireConfigured, async (req, res) => {
  const key = req.query.key;
  if (!key || !String(key).trim()) {
    return res.status(400).json({ ok: false, error: 'A non-empty "key" is required.' });
  }
  const start = Date.now();
  try {
    const target = disk.resolveSafe(key);
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      return res.status(400).json({ ok: false, error: 'Path is a directory, not a file.' });
    }
    const fh = await fs.open(target, 'r');
    try {
      const buf = Buffer.alloc(Math.min(stat.size, MAX_READ_BYTES));
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      req.log.info('disk read ok', { op: 'read', key, bytes: bytesRead, durationMs: Date.now() - start });
      res.json({
        ok: true,
        key,
        size: stat.size,
        truncated: stat.size > MAX_READ_BYTES,
        content: buf.slice(0, bytesRead).toString('utf8'),
      });
    } finally {
      await fh.close();
    }
  } catch (err) {
    const status = err.status || 500;
    req.log.warn('disk read failed', { op: 'read', key, durationMs: Date.now() - start, err });
    res.status(status).json({ ok: false, error: err.message });
  }
});

router.delete('/object', requireConfigured, async (req, res) => {
  const key = req.body && req.body.key;
  if (!key || !String(key).trim()) {
    return res.status(400).json({ ok: false, error: 'A non-empty "key" is required.' });
  }
  const start = Date.now();
  try {
    const target = disk.resolveSafe(key);
    await fs.unlink(target);
    req.log.info('disk delete ok', { op: 'delete', key, durationMs: Date.now() - start });
    res.json({ ok: true, key });
  } catch (err) {
    const status = err.status || 500;
    req.log.warn('disk delete failed', { op: 'delete', key, durationMs: Date.now() - start, err });
    res.status(status).json({ ok: false, error: err.message });
  }
});

module.exports = router;
