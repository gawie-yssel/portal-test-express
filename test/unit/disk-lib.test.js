const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const disk = require('../../lib/disk');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-lib-'));

test.before(() => {
  process.env.DISK_PATH = base;
});

test.after(() => {
  delete process.env.DISK_PATH;
  fs.rmSync(base, { recursive: true, force: true });
});

test('resolveSafe() resolves a plain key under the base directory', () => {
  assert.equal(disk.resolveSafe('notes.txt'), path.join(base, 'notes.txt'));
  assert.equal(disk.resolveSafe('sub/notes.txt'), path.join(base, 'sub', 'notes.txt'));
});

test("resolveSafe('.') returns the base directory itself", () => {
  assert.equal(disk.resolveSafe('.'), path.resolve(base));
  assert.equal(disk.resolveSafe(''), path.resolve(base));
  assert.equal(disk.resolveSafe(undefined), path.resolve(base));
});

test('resolveSafe() rejects traversal out of the base with a 400', () => {
  assert.throws(
    () => disk.resolveSafe('../evil'),
    (err) => err.status === 400 && /escapes/i.test(err.message)
  );
});

test('resolveSafe() rejects an absolute path outside the base with a 400', () => {
  const outside = path.resolve(os.tmpdir(), 'definitely-not-in-base.txt');

  assert.throws(() => disk.resolveSafe(outside), (err) => err.status === 400);
});

test('resolveSafe() rejects a sibling directory sharing the base prefix', () => {
  // `${base}-evil` starts with the base string but is not inside it.
  assert.throws(() => disk.resolveSafe(`${base}-evil`), (err) => err.status === 400);
});

test('isConfigured()/safeConfig() report the temp directory', () => {
  assert.equal(disk.isConfigured(), true);

  const config = disk.safeConfig();
  assert.equal(config.configured, true);
  assert.equal(config.path, base);
  assert.equal(config.exists, true);
  assert.equal(config.isDirectory, true);
  assert.equal(config.writable, true);
});
