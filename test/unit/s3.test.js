const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app } = require('./helpers');
const s3 = require('../../lib/s3');

// The router builds real command objects and calls s3.getClient().send() at
// request time, so replacing getClient with a fake keyed on the command's
// constructor name keeps the tier offline — no S3Client is ever constructed.
function stubClient(t, handlers) {
  const original = s3.getClient;
  const calls = [];
  s3.getClient = () => ({
    send: async (command) => {
      const name = command.constructor.name;
      calls.push({ name, input: command.input });
      const handler = handlers[name];
      if (!handler) throw new Error(`unexpected S3 command: ${name}`);
      return handler(command);
    },
  });
  t.after(() => { s3.getClient = original; });
  return calls;
}

function configure(t) {
  process.env.AWS_REGION = 'eu-west-1';
  process.env.S3_BUCKET = 'test-bucket';
  t.after(() => {
    delete process.env.AWS_REGION;
    delete process.env.S3_BUCKET;
  });
}

test('GET /config reports unconfigured when no S3 env is set', async () => {
  const res = await request(app).get('/api/s3/config');

  assert.equal(res.status, 200);
  assert.equal(res.body.config.configured, false);
  assert.equal(res.body.config.credentialsSet, false);
});

test('GET /config reports credentials without leaking the secret key', async (t) => {
  configure(t);
  process.env.AWS_ACCESS_KEY_ID = 'AKIAEXAMPLE';
  process.env.AWS_SECRET_ACCESS_KEY = 's3cretpw';
  process.env.S3_ENDPOINT = 'http://localhost:9009';
  t.after(() => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.S3_ENDPOINT;
  });

  const res = await request(app).get('/api/s3/config');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.config, {
    configured: true,
    region: 'eu-west-1',
    bucket: 'test-bucket',
    endpoint: 'http://localhost:9009',
    credentialsSet: true,
  });
  assert.ok(!res.text.includes('s3cretpw'), 'secret key must never reach the response');
});

test('GET /list is 503 while S3 is unconfigured', async () => {
  const res = await request(app).get('/api/s3/list');

  assert.equal(res.status, 503);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /not configured/i);
});

test('GET /list maps the bucket contents', async (t) => {
  configure(t);
  const lastModified = new Date('2026-01-01T00:00:00.000Z');
  const calls = stubClient(t, {
    ListObjectsV2Command: () => ({
      Contents: [{ Key: 'a.txt', Size: 3, LastModified: lastModified }],
      IsTruncated: false,
    }),
  });

  const res = await request(app).get('/api/s3/list').query({ prefix: 'a' });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.objects, [
    { key: 'a.txt', size: 3, lastModified: lastModified.toISOString() },
  ]);
  assert.equal(res.body.isTruncated, false);
  assert.equal(calls[0].input.Bucket, 'test-bucket');
  assert.equal(calls[0].input.Prefix, 'a');
});

test('GET /list surfaces an S3 failure as 500', async (t) => {
  configure(t);
  stubClient(t, {
    ListObjectsV2Command: () => { throw new Error('NoSuchBucket'); },
  });

  const res = await request(app).get('/api/s3/list');

  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { ok: false, error: 'NoSuchBucket' });
});

test('POST /upload sends the file body under the supplied key', async (t) => {
  configure(t);
  const calls = stubClient(t, { PutObjectCommand: () => ({}) });

  const res = await request(app)
    .post('/api/s3/upload')
    .field('key', 'k.txt')
    .attach('file', Buffer.from('hello'), 'upload.txt');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, key: 'k.txt' });
  assert.equal(calls[0].input.Key, 'k.txt');
  assert.equal(calls[0].input.Bucket, 'test-bucket');
  assert.equal(calls[0].input.Body.toString(), 'hello');
});

test('POST /upload falls back to the original filename', async (t) => {
  configure(t);
  const calls = stubClient(t, { PutObjectCommand: () => ({}) });

  const res = await request(app)
    .post('/api/s3/upload')
    .attach('file', Buffer.from('hello'), 'upload.txt');

  assert.equal(res.status, 200);
  assert.equal(res.body.key, 'upload.txt');
  assert.equal(calls[0].input.Key, 'upload.txt');
});

test('POST /upload without a file is 400', async (t) => {
  configure(t);

  const res = await request(app).post('/api/s3/upload').field('key', 'k.txt');

  assert.equal(res.status, 400);
  assert.match(res.body.error, /file is required/i);
});

test('DELETE /object without a key is 400', async (t) => {
  configure(t);

  const res = await request(app).delete('/api/s3/object').send({});

  assert.equal(res.status, 400);
  assert.match(res.body.error, /"key"/);
});

test('DELETE /object removes the key', async (t) => {
  configure(t);
  const calls = stubClient(t, { DeleteObjectCommand: () => ({}) });

  const res = await request(app).delete('/api/s3/object').send({ key: 'k.txt' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, key: 'k.txt' });
  assert.equal(calls[0].input.Key, 'k.txt');
});
