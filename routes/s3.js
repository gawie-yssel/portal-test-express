const express = require('express');
const multer = require('multer');
const {
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const s3 = require('../lib/s3');

const router = express.Router();

// Hold uploads in memory (bounded) and hand the buffer straight to S3.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// Reject requests early when S3 env vars aren't set.
function requireConfigured(req, res, next) {
  if (!s3.isConfigured()) {
    return res.status(503).json({
      ok: false,
      error: 'S3 is not configured. Set AWS_REGION and S3_BUCKET (and AWS credentials).',
    });
  }
  next();
}

// Sanitized config for display — never gated by requireConfigured so the
// page can show "not configured" too.
router.get('/config', (req, res) => {
  res.json({ ok: true, config: s3.safeConfig() });
});

router.get('/list', requireConfigured, async (req, res) => {
  try {
    const out = await s3.getClient().send(
      new ListObjectsV2Command({
        Bucket: s3.bucket(),
        Prefix: req.query.prefix || undefined,
      })
    );
    const objects = (out.Contents || []).map((o) => ({
      key: o.Key,
      size: o.Size,
      lastModified: o.LastModified,
    }));
    res.json({ ok: true, objects, isTruncated: Boolean(out.IsTruncated) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/upload', requireConfigured, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'A file is required (form field "file").' });
  }

  const key = (req.body && req.body.key && req.body.key.trim()) || req.file.originalname;

  try {
    await s3.getClient().send(
      new PutObjectCommand({
        Bucket: s3.bucket(),
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
    );
    res.json({ ok: true, key });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/object', requireConfigured, async (req, res) => {
  const key = req.body && req.body.key;
  if (!key || !String(key).trim()) {
    return res.status(400).json({ ok: false, error: 'A non-empty "key" is required.' });
  }

  try {
    await s3.getClient().send(
      new DeleteObjectCommand({ Bucket: s3.bucket(), Key: key })
    );
    res.json({ ok: true, key });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
