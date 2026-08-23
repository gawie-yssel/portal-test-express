const test = require('node:test');
const assert = require('node:assert/strict');
const { redact } = require('../../lib/logger');

test('redact() masks sensitive keys case-insensitively', () => {
  const out = redact({ password: 'hunter2', PGPASSWORD: 'hunter2', Authorization: 'Bearer x' });

  assert.deepEqual(out, {
    password: '[REDACTED]',
    PGPASSWORD: '[REDACTED]',
    Authorization: '[REDACTED]',
  });
});

test('redact() recurses into nested objects and arrays', () => {
  const out = redact({
    db: { host: 'h', password: 'hunter2' },
    creds: [{ aws_secret_access_key: 'shh' }, { region: 'eu-west-1' }],
  });

  assert.deepEqual(out, {
    db: { host: 'h', password: '[REDACTED]' },
    creds: [{ aws_secret_access_key: '[REDACTED]' }, { region: 'eu-west-1' }],
  });
});

test('redact() turns an Error into { name, message, stack }', () => {
  const out = redact({ err: new TypeError('boom') });

  assert.equal(out.err.name, 'TypeError');
  assert.equal(out.err.message, 'boom');
  assert.equal(typeof out.err.stack, 'string');
});

test('redact() breaks cycles with [Circular]', () => {
  const node = { name: 'root' };
  node.self = node;

  assert.deepEqual(redact(node), { name: 'root', self: '[Circular]' });
});

test('redact() passes primitives through untouched', () => {
  assert.equal(redact('plain'), 'plain');
  assert.equal(redact(42), 42);
  assert.equal(redact(true), true);
  assert.equal(redact(null), null);
  assert.equal(redact(undefined), undefined);
});
