const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../../index');
const mssql = require('../../lib/mssql');
const { envSkip, skipUnlessListening } = require('./helpers');

// The SQL Server container accepts TCP well before it accepts logins — give it
// 30–60 s after `docker compose up -d` before running this tier.
const HINT =
  'MSSQL not available — run: docker compose -f docker-compose.test.yml up -d, wait ~60s for SQL Server to accept logins, then npm run test:integration';

const skip = envSkip(['MSSQL_HOST', 'MSSQL_CONNECTION_STRING'], HINT);

const host = process.env.MSSQL_HOST || 'localhost';
const port = Number(process.env.MSSQL_PORT || 1433);

test.after(async () => {
  await mssql.peekPool()?.close();
});

test('GET /api/mssql/ping reports the server time', { skip }, async (t) => {
  if (await skipUnlessListening(t, host, port, HINT)) return;

  const res = await request(app).get('/api/mssql/ping');

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.serverTime, 'expected a serverTime');
  assert.match(res.body.version, /Microsoft SQL Server/);
});

test('POST /api/mssql/query binds positional params as @p1..@pN', { skip }, async (t) => {
  if (await skipUnlessListening(t, host, port, HINT)) return;

  const res = await request(app)
    .post('/api/mssql/query')
    .send({ sql: 'SELECT @p1 AS n', params: [1] });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.rows, [{ n: 1 }]);
  assert.deepEqual(res.body.fields, [{ name: 'n' }]);
  assert.equal(res.body.rowCount, 1);
});

test('POST /api/mssql/query surfaces a SQL error as 500', { skip }, async (t) => {
  if (await skipUnlessListening(t, host, port, HINT)) return;

  const res = await request(app)
    .post('/api/mssql/query')
    .send({ sql: 'SELECT * FROM a_table_that_does_not_exist' });

  assert.equal(res.status, 500);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /Invalid object name/i);
});
