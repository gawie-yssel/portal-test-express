// Shared setup for the offline unit tier. node:test runs one process per file,
// so this executes fresh for every test file.
//
// Not named *.test.js, so the runner treats it as a plain module, not a suite.

// Defensive only: tests never load tracing.js (that happens via npm start's
// --require), so no SDK exists to disable — but keep any stray init quiet.
process.env.OTEL_SDK_DISABLED = 'true';
process.env.LOG_LEVEL = 'error';

// Requiring the app runs dotenv, which may populate a developer's local .env...
const app = require('../../index');

// ...so scrub every backend variable afterwards. dotenv never overrides
// already-set vars, so this leaves the tier deterministic: each backend reads
// as "unconfigured" until a test sets what it needs (and restores in t.after).
const SCRUB = [
  'DATABASE_URL',
  'PGHOST',
  'PGPORT',
  'PGUSER',
  'PGPASSWORD',
  'PGDATABASE',
  'PGSSL',
  'MSSQL_CONNECTION_STRING',
  'MSSQL_HOST',
  'MSSQL_PORT',
  'MSSQL_USER',
  'MSSQL_PASSWORD',
  'MSSQL_DATABASE',
  'AWS_REGION',
  'S3_BUCKET',
  'S3_ENDPOINT',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'DISK_PATH',
  'PORT',
];
for (const key of SCRUB) delete process.env[key];

module.exports = { app };
