const test = require('node:test');
const assert = require('node:assert/strict');
const { CreateBucketCommand } = require('@aws-sdk/client-s3');
const request = require('supertest');
const app = require('../../index');
const s3 = require('../../lib/s3');
const { envSkip, reachable, skipUnlessListening } = require('./helpers');

const HINT =
  'S3 not available — run: docker compose -f docker-compose.test.yml up -d, then npm run test:integration';

const skip = envSkip(['S3_BUCKET'], HINT);

// Only a custom endpoint (MinIO from the compose stack) can be probed — real
// AWS is assumed reachable when S3_ENDPOINT is unset.
const endpoint = process.env.S3_ENDPOINT ? new URL(process.env.S3_ENDPOINT) : null;
const host = endpoint ? endpoint.hostname : null;
const port = endpoint ? Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80)) : null;

const KEY = 'integration-round-trip.txt';

// Skip the probe/creation entirely when the static gate already applies.
test.before(async () => {
  if (skip || (host && !(await reachable(host, port)))) return;
  try {
    await s3.getClient().send(new CreateBucketCommand({ Bucket: s3.bucket() }));
  } catch (err) {
    // Already there (any of the three ways a server can say so) is success.
    if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(err.name)) throw err;
  }
});

test.after(() => {
  // Only built if a test actually ran; getClient() would otherwise construct a
  // client just to tear it down.
  if (!skip) s3.getClient().destroy();
});

async function unavailable(t) {
  return host ? skipUnlessListening(t, host, port, HINT) : false;
}

test('upload → list → delete round-trips through the S3 routes', { skip }, async (t) => {
  if (await unavailable(t)) return;

  const uploaded = await request(app)
    .post('/api/s3/upload')
    .field('key', KEY)
    .attach('file', Buffer.from('hello s3'), 'ignored.txt');
  assert.equal(uploaded.status, 200);
  assert.deepEqual(uploaded.body, { ok: true, key: KEY });

  const listed = await request(app).get('/api/s3/list').query({ prefix: KEY });
  assert.equal(listed.status, 200);
  const object = listed.body.objects.find((o) => o.key === KEY);
  assert.ok(object, 'expected the uploaded object in the listing');
  assert.equal(object.size, 8);

  const deleted = await request(app).delete('/api/s3/object').send({ key: KEY });
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body, { ok: true, key: KEY });

  const after = await request(app).get('/api/s3/list').query({ prefix: KEY });
  assert.equal(after.status, 200);
  assert.equal(
    after.body.objects.find((o) => o.key === KEY),
    undefined,
    'expected the object to be gone after delete'
  );
});

test('GET /api/s3/config reports the live bucket', { skip }, async (t) => {
  if (await unavailable(t)) return;

  const res = await request(app).get('/api/s3/config');

  assert.equal(res.status, 200);
  assert.equal(res.body.config.configured, true);
  assert.equal(res.body.config.bucket, process.env.S3_BUCKET);
});
