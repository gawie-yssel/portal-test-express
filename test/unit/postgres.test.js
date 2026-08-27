const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app } = require('./helpers');
const db = require('../../lib/db');

// Routers call db.query()/db.ping() through the module object at request time,
// so swapping the export is enough to keep every test offline — no pool is ever
// constructed. Each mutation is undone in t.after().

test('GET /config reports unconfigured when no Postgres env is set', async () => {
  const res = await request(app).get('/api/postgres/config');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, config: { configured: false } });
});

test('GET /config parses DATABASE_URL without leaking the password', async (t) => {
  process.env.DATABASE_URL = 'postgres://u:s3cretpw@h.example.com:5433/mydb';
  t.after(() => { delete process.env.DATABASE_URL; });

  const res = await request(app).get('/api/postgres/config');

  assert.equal(res.status, 200);
  assert.equal(res.body.config.configured, true);
  assert.equal(res.body.config.source, 'DATABASE_URL');
  assert.equal(res.body.config.host, 'h.example.com');
  assert.equal(res.body.config.port, '5433');
  assert.equal(res.body.config.user, 'u');
  assert.equal(res.body.config.database, 'mydb');
  assert.equal(res.body.config.passwordSet, true);
  assert.ok(!res.text.includes('s3cretpw'), 'password must never reach the response');
});

test('GET /ping is 503 while Postgres is unconfigured', async () => {
  const res = await request(app).get('/api/postgres/ping');

  assert.equal(res.status, 503);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /not configured/i);
});

test('POST /query is 503 while Postgres is unconfigured', async () => {
  const res = await request(app).post('/api/postgres/query').send({ sql: 'SELECT 1' });

  assert.equal(res.status, 503);
  assert.equal(res.body.ok, false);
});

test('POST /query rejects a missing sql with 400', async (t) => {
  process.env.PGHOST = 'stub';
  t.after(() => { delete process.env.PGHOST; });

  const res = await request(app).post('/api/postgres/query').send({});

  assert.equal(res.status, 400);
  assert.match(res.body.error, /"sql"/);
});

test('POST /query rejects non-array params with 400', async (t) => {
  process.env.PGHOST = 'stub';
  t.after(() => { delete process.env.PGHOST; });

  const res = await request(app)
    .post('/api/postgres/query')
    .send({ sql: 'SELECT 1', params: { id: 1 } });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /"params"/);
});

test('POST /query returns rows from a stubbed db.query', async (t) => {
  process.env.PGHOST = 'stub';
  const original = db.query;
  let seen;
  db.query = async (sql, params) => {
    seen = { sql, params };
    return { rows: [{ n: 1 }], fields: [{ name: 'n' }], rowCount: 1 };
  };
  t.after(() => {
    db.query = original;
    delete process.env.PGHOST;
  });

  const res = await request(app)
    .post('/api/postgres/query')
    .send({ sql: 'SELECT 1 AS n', params: [] });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.rows, [{ n: 1 }]);
  assert.deepEqual(res.body.fields, [{ name: 'n' }]);
  assert.equal(res.body.rowCount, 1);
  assert.deepEqual(seen, { sql: 'SELECT 1 AS n', params: [] });
});

test('POST /query surfaces a db failure as 500', async (t) => {
  process.env.PGHOST = 'stub';
  const original = db.query;
  db.query = async () => { throw new Error('connection refused'); };
  t.after(() => {
    db.query = original;
    delete process.env.PGHOST;
  });

  const res = await request(app).post('/api/postgres/query').send({ sql: 'SELECT 1' });

  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { ok: false, error: 'connection refused' });
});

test('GET /ping returns server info from a stubbed db.ping', async (t) => {
  process.env.PGHOST = 'stub';
  const original = db.ping;
  db.ping = async () => ({ serverTime: '2026-01-01T00:00:00Z', version: 'PostgreSQL 16' });
  t.after(() => {
    db.ping = original;
    delete process.env.PGHOST;
  });

  const res = await request(app).get('/api/postgres/ping');

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.version, 'PostgreSQL 16');
});
