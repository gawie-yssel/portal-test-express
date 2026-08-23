const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app } = require('./helpers');

test('GET /health reports ok with an uptime', async () => {
  const res = await request(app).get('/health');

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(typeof res.body.uptime, 'number');
});

test('every response carries an x-request-id header', async () => {
  const res = await request(app).get('/health');

  assert.ok(res.headers['x-request-id'], 'expected an x-request-id header');
});

test('a client-supplied x-request-id is echoed back', async () => {
  const res = await request(app).get('/health').set('x-request-id', 'req-abc-123');

  assert.equal(res.headers['x-request-id'], 'req-abc-123');
});
