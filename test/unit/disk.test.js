const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { app } = require('./helpers');

// The disk routes are exercised against a real temporary directory — no stubs.
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-route-'));

function configure(t) {
  process.env.DISK_PATH = base;
  t.after(() => { delete process.env.DISK_PATH; });
}

test.after(() => {
  delete process.env.DISK_PATH;
  fs.rmSync(base, { recursive: true, force: true });
});

test('GET /config reports unconfigured when DISK_PATH is unset', async () => {
  const res = await request(app).get('/api/disk/config');

  assert.equal(res.status, 200);
  assert.equal(res.body.config.configured, false);
  assert.equal(res.body.config.path, null);
});

test('GET /health is 503 while DISK_PATH is unset', async () => {
  const res = await request(app).get('/api/disk/health');

  assert.equal(res.status, 503);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /not configured/i);
});

test('GET /config reports the configured directory', async (t) => {
  configure(t);

  const res = await request(app).get('/api/disk/config');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.config, {
    configured: true,
    path: base,
    exists: true,
    isDirectory: true,
    writable: true,
  });
});

test('GET /health round-trips a file and cleans up after itself', async (t) => {
  configure(t);

  const res = await request(app).get('/api/disk/health');

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.bytes > 0);
  assert.equal(typeof res.body.durationMs, 'number');
  assert.deepEqual(
    fs.readdirSync(base).filter((n) => n.startsWith('.disk-health-')),
    [],
    'the health probe file must be deleted'
  );
});

test('write → read → list → delete round-trips through the routes', async (t) => {
  configure(t);

  const written = await request(app)
    .post('/api/disk/write')
    .field('key', 'round-trip.txt')
    .attach('file', Buffer.from('hello disk'), 'ignored.txt');
  assert.equal(written.status, 200);
  assert.deepEqual(written.body, { ok: true, key: 'round-trip.txt', bytes: 10 });

  const read = await request(app).get('/api/disk/read').query({ key: 'round-trip.txt' });
  assert.equal(read.status, 200);
  assert.equal(read.body.content, 'hello disk');
  assert.equal(read.body.size, 10);
  assert.equal(read.body.truncated, false);

  const listed = await request(app).get('/api/disk/list');
  assert.equal(listed.status, 200);
  const entry = listed.body.entries.find((e) => e.name === 'round-trip.txt');
  assert.ok(entry, 'expected the written file in the listing');
  assert.equal(entry.isDir, false);
  assert.equal(entry.size, 10);

  const deleted = await request(app).delete('/api/disk/object').send({ key: 'round-trip.txt' });
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body, { ok: true, key: 'round-trip.txt' });

  const gone = await request(app).get('/api/disk/read').query({ key: 'round-trip.txt' });
  assert.equal(gone.status, 500, 'reading a deleted file surfaces the ENOENT as 500');
});

test('GET /read rejects a traversal key with 400', async (t) => {
  configure(t);

  const res = await request(app).get('/api/disk/read?key=..%2Fescape');

  assert.equal(res.status, 400);
  assert.match(res.body.error, /escapes/i);
});

test('GET /read rejects a directory with 400', async (t) => {
  configure(t);

  const res = await request(app).get('/api/disk/read').query({ key: '.' });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /directory/i);
});

test('GET /read without a key is 400', async (t) => {
  configure(t);

  const res = await request(app).get('/api/disk/read');

  assert.equal(res.status, 400);
  assert.match(res.body.error, /"key"/);
});

test('POST /write rejects a traversal key with 400', async (t) => {
  configure(t);

  const res = await request(app)
    .post('/api/disk/write')
    .field('key', '../escape.txt')
    .attach('file', Buffer.from('nope'), 'escape.txt');

  assert.equal(res.status, 400);
  assert.match(res.body.error, /escapes/i);
});

test('GET /stats reports capacity for the mount', async (t) => {
  configure(t);

  const res = await request(app).get('/api/disk/stats');

  // Loose on purpose: statfs works everywhere but field fidelity differs
  // across platforms.
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.totalBytes > 0, 'expected a non-zero total size');
});
