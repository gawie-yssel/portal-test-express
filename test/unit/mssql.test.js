const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app } = require('./helpers');
const mssql = require('../../lib/mssql');

const CONNECTION_STRING =
  'Server=sql.example.com,1434;Database=mydb;User Id=sa;Password=s3cretpw;Encrypt=true';

test('GET /config reports unconfigured when no MSSQL env is set', async () => {
  const res = await request(app).get('/api/mssql/config');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, config: { configured: false } });
});

test('GET /config parses a connection string without leaking the password', async (t) => {
  process.env.MSSQL_CONNECTION_STRING = CONNECTION_STRING;
  t.after(() => { delete process.env.MSSQL_CONNECTION_STRING; });

  const res = await request(app).get('/api/mssql/config');

  assert.equal(res.status, 200);
  assert.equal(res.body.config.configured, true);
  assert.equal(res.body.config.source, 'MSSQL_CONNECTION_STRING');
  assert.equal(res.body.config.host, 'sql.example.com');
  assert.equal(res.body.config.port, '1434');
  assert.equal(res.body.config.user, 'sa');
  assert.equal(res.body.config.database, 'mydb');
  assert.equal(res.body.config.passwordSet, true);
  assert.ok(!res.text.includes('s3cretpw'), 'password must never reach the response');
});

test('GET /config flags an unparseable connection string', async (t) => {
  // mssql v12 parses only the ADO Key=Value; form — a URI yields no server.
  process.env.MSSQL_CONNECTION_STRING = 'mssql://sa:s3cretpw@sql.example.com/mydb';
  t.after(() => { delete process.env.MSSQL_CONNECTION_STRING; });

  const res = await request(app).get('/api/mssql/config');

  assert.equal(res.status, 200);
  assert.equal(res.body.config.configured, true);
  assert.equal(res.body.config.parseError, true);
  assert.ok(!res.text.includes('s3cretpw'), 'password must never reach the response');
});

test('GET /ping is 503 while MSSQL is unconfigured', async () => {
  const res = await request(app).get('/api/mssql/ping');

  assert.equal(res.status, 503);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /not configured/i);
});

test('POST /query rejects a missing sql with 400', async (t) => {
  process.env.MSSQL_HOST = 'stub';
  t.after(() => { delete process.env.MSSQL_HOST; });

  const res = await request(app).post('/api/mssql/query').send({});

  assert.equal(res.status, 400);
  assert.match(res.body.error, /"sql"/);
});

test('POST /query rejects an object inside params with 400', async (t) => {
  process.env.MSSQL_HOST = 'stub';
  t.after(() => { delete process.env.MSSQL_HOST; });

  const res = await request(app)
    .post('/api/mssql/query')
    .send({ sql: 'SELECT @p1 AS n', params: [{ nested: true }] });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /strings, numbers, booleans, or null/);
});

test('POST /query accepts null inside params', async (t) => {
  process.env.MSSQL_HOST = 'stub';
  const original = mssql.query;
  let seen;
  mssql.query = async (sql, params) => {
    seen = { sql, params };
    return { rows: [{ n: null }], fields: [{ name: 'n' }], rowCount: 1 };
  };
  t.after(() => {
    mssql.query = original;
    delete process.env.MSSQL_HOST;
  });

  const res = await request(app)
    .post('/api/mssql/query')
    .send({ sql: 'SELECT @p1 AS n', params: [null] });

  assert.equal(res.status, 200);
  assert.deepEqual(seen.params, [null]);
});

test('POST /query returns rows from a stubbed mssql.query', async (t) => {
  process.env.MSSQL_HOST = 'stub';
  const original = mssql.query;
  mssql.query = async () => ({ rows: [{ n: 1 }], fields: [{ name: 'n' }], rowCount: 1 });
  t.after(() => {
    mssql.query = original;
    delete process.env.MSSQL_HOST;
  });

  const res = await request(app)
    .post('/api/mssql/query')
    .send({ sql: 'SELECT @p1 AS n', params: [1] });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.rows, [{ n: 1 }]);
  assert.equal(res.body.rowCount, 1);
});

test('GET /ping returns server info from a stubbed mssql.ping', async (t) => {
  process.env.MSSQL_HOST = 'stub';
  const original = mssql.ping;
  mssql.ping = async () => ({ serverTime: '2026-01-01T00:00:00Z', version: 'Microsoft SQL Server 2022' });
  t.after(() => {
    mssql.ping = original;
    delete process.env.MSSQL_HOST;
  });

  const res = await request(app).get('/api/mssql/ping');

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.match(res.body.version, /SQL Server/);
});

test('GET /ping surfaces a login failure as 500', async (t) => {
  process.env.MSSQL_HOST = 'stub';
  const original = mssql.ping;
  mssql.ping = async () => { throw new Error('Login failed for user'); };
  t.after(() => {
    mssql.ping = original;
    delete process.env.MSSQL_HOST;
  });

  const res = await request(app).get('/api/mssql/ping');

  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { ok: false, error: 'Login failed for user' });
});
