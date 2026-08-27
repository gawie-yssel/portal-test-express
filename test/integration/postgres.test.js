const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../../index');
const db = require('../../lib/db');
const { envSkip, skipUnlessListening } = require('./helpers');

const HINT =
  'Postgres not available — run: docker compose -f docker-compose.test.yml up -d, then npm run test:integration';

const skip = envSkip(['PGHOST', 'DATABASE_URL'], HINT);

// Only reachable when the compose stack is up; DATABASE_URL users get the
// static gate above plus whatever the driver reports.
const host = process.env.PGHOST || 'localhost';
const port = Number(process.env.PGPORT || 5432);

test.after(async () => {
  await db.peekPool()?.end();
});

test('GET /api/postgres/ping reports the server time', { skip }, async (t) => {
  if (await skipUnlessListening(t, host, port, HINT)) return;

  const res = await request(app).get('/api/postgres/ping');

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.serverTime, 'expected a serverTime');
  assert.match(res.body.version, /PostgreSQL/);
});

test('POST /api/postgres/query runs a parameterised statement', { skip }, async (t) => {
  if (await skipUnlessListening(t, host, port, HINT)) return;

  const res = await request(app)
    .post('/api/postgres/query')
    .send({ sql: 'SELECT $1::int AS n', params: [1] });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.rows, [{ n: 1 }]);
  assert.deepEqual(res.body.fields, [{ name: 'n' }]);
  assert.equal(res.body.rowCount, 1);
});

test('POST /api/postgres/query surfaces a SQL error as 500', { skip }, async (t) => {
  if (await skipUnlessListening(t, host, port, HINT)) return;

  const res = await request(app)
    .post('/api/postgres/query')
    .send({ sql: 'SELECT * FROM a_table_that_does_not_exist' });

  assert.equal(res.status, 500);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /does not exist/i);
});
