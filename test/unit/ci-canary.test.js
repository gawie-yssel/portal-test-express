const test = require('node:test');
const assert = require('node:assert/strict');

test('CI canary: intentional failure to verify the pipeline reports failures', () => {
  assert.fail('Intentional failure — verifying CI fails the build. Delete this file after the check.');
});
