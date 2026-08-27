const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app } = require('./helpers');

test('malformed JSON is turned into the uniform error shape', async () => {
  const res = await request(app)
    .post('/api/postgres/query')
    .set('content-type', 'application/json')
    .send('{"sql": ');

  // Pins current behaviour: the handler ignores body-parser's err.status (400)
  // and treats anything that isn't a MulterError as a 500.
  assert.equal(res.status, 500);
  assert.equal(res.body.ok, false);
  assert.equal(typeof res.body.error, 'string');
  assert.ok(res.body.error.length > 0);
});

test('an unexpected upload field is a 400 via the MulterError branch', async (t) => {
  process.env.AWS_REGION = 'eu-west-1';
  process.env.S3_BUCKET = 'test-bucket';
  t.after(() => {
    delete process.env.AWS_REGION;
    delete process.env.S3_BUCKET;
  });

  const res = await request(app)
    .post('/api/s3/upload')
    .attach('not-the-file-field', Buffer.from('hello'), 'upload.txt');

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /unexpected field/i);
});

test('an unknown route falls through to the 404 handler', async () => {
  const res = await request(app).get('/api/nope');

  assert.equal(res.status, 404);
});
