# Test Suite Design

## Context

The project (an Express 5 diagnostics app probing Postgres, MSSQL, S3, and disk connectivity) currently has **no tests, no test framework, no devDependencies, and no `test` script**. The goal is a genuinely minimal but meaningful suite: fast offline unit/route tests that run with `npm test`, plus an opt-in integration tier against real services via docker compose.

**Decisions:** framework is **node:test** (Node's built-in runner, `node:assert/strict`) + **supertest** as the only new devDependency; scope is mocked-backend route tests **plus** opt-in real-service integration tests (skipped when env vars are absent).

**Verified facts driving the design:**
- `index.js` calls `app.listen` unconditionally at line 70 and exports nothing — needs a tiny refactor for supertest.
- All routers call backends through the module object at request time (`db.query(...)`, `s3.getClient().send(...)`), so CommonJS export patching is a safe stub seam. Only load-time capture is the cosmetic `LOG_SQL` flag.
- `isConfigured()`/`safeConfig()` in every lib read `process.env` at call time — env-driven tests work. dotenv never overrides pre-set vars, so scrubbing env **after** requiring the app neutralizes a developer's stray `.env`.
- Teardown seams already exist: `db.peekPool()` (`lib/db.js:126`), `mssql.peekPool()` (`lib/mssql.js:227`), `s3.getClient()` (`lib/s3.js:53`). **No lib changes needed.**
- Tests never load `tracing.js` (only `npm start`'s `--require` does), so no OTel SDK/exporters exist in tests; `lib/metrics.js` binds to the no-op meter and host-metrics v0.39 creates no timers. No `--test-force-exit` needed.
- Dev Node is v24.8.0 — directory args to `node --test` and `--env-file` both available.

## Step 1 — Only production change: export the app

In `index.js`, wrap the listen call and export the app (keeps `npm start` incl. tracing `--require` byte-for-byte identical in behavior; `require.main` is still index.js under `--require`):

```js
if (require.main === module) {
  app.listen(port, () => {
    logger.info('server started', { port, postgres: db.safeConfig(), mssql: mssql.safeConfig(), s3: s3.safeConfig(), disk: disk.safeConfig() });
  });
}

module.exports = app;
```

## Step 2 — package.json

- `npm install --save-dev supertest`
- Scripts + engines:

```json
"scripts": {
  "start": "node --require ./tracing.js index.js",
  "test": "node --test test/unit/",
  "test:integration": "node --env-file=.env.test --test test/integration/"
},
"engines": { "node": ">=20.6" }
```

No cross-env: env is set inside test files (unit) or via native `--env-file` (integration) — identical on Windows and Linux. Directory args avoid Windows glob issues.

## Step 3 — Layout

```
test/
  unit/
    helpers.js            # not *.test.js → runner skips it
    health.test.js
    logger.test.js
    disk-lib.test.js
    postgres.test.js
    mssql.test.js
    s3.test.js
    disk.test.js
    error-handler.test.js
  integration/
    postgres.test.js
    mssql.test.js
    s3.test.js
docker-compose.test.yml
.env.test                 # committed; throwaway compose-only creds (.gitignore permits it)
```

## Step 4 — test/unit/helpers.js (keystone of offline determinism)

Runs fresh per file (node:test = process per file):

```js
process.env.OTEL_SDK_DISABLED = 'true'; // defensive only
process.env.LOG_LEVEL = 'error';
const app = require('../../index');     // dotenv runs here...
// ...then scrub so every backend reads as "unconfigured" regardless of local .env:
const SCRUB = ['DATABASE_URL','PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSL',
  'MSSQL_CONNECTION_STRING','MSSQL_HOST','MSSQL_PORT','MSSQL_USER','MSSQL_PASSWORD','MSSQL_DATABASE',
  'AWS_REGION','S3_BUCKET','S3_ENDPOINT','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','DISK_PATH','PORT'];
for (const k of SCRUB) delete process.env[k];
module.exports = { app };
```

Tests needing a "configured" backend set env inside the test and restore with `t.after()`.

## Step 5 — Stub pattern (CommonJS mutable exports)

```js
const db = require('../../lib/db');
test('query returns rows from stubbed db', async (t) => {
  process.env.PGHOST = 'stub';
  const orig = db.query;
  db.query = async () => ({ rows: [{ n: 1 }], fields: [{ name: 'n' }], rowCount: 1 });
  t.after(() => { db.query = orig; delete process.env.PGHOST; });
  const res = await request(app).post('/api/postgres/query').send({ sql: 'SELECT 1' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.rows, [{ n: 1 }]);
});
```

S3: replace `s3lib.getClient` with `() => ({ send: async (cmd) => ... })` keyed on `cmd.constructor.name`. Stubs intercept before pool/client construction, so no real clients ever exist in the unit tier. Every env/export mutation must be paired with a `t.after()` restore.

## Step 6 — Minimum unit test list

- **health.test.js** — `GET /health` → 200, `status:'ok'`, numeric uptime, `x-request-id` header present (covers request-id middleware).
- **logger.test.js** — `redact()`: sensitive keys (case-insensitive) → `[REDACTED]`; recurses objects/arrays; `Error` → `{name,message,stack}`; circular → `[Circular]`; primitives pass through.
- **disk-lib.test.js** — `resolveSafe()` with temp `DISK_PATH`: valid key resolves under base; `../evil` throws `err.status === 400`; absolute-path escape throws 400; `'.'` returns base.
- **postgres.test.js** — config unconfigured → `configured:false`; with `DATABASE_URL=postgres://u:s3cretpw@h/d` → `passwordSet:true` and response body does **not** contain `s3cretpw`; ping unconfigured → 503; `POST /query` `{}` → 400 and non-array `params` → 400; stubbed success → 200.
- **mssql.test.js** — config with connection string containing a password → `passwordSet:true`, no secret in body (exercises offline `parseConnectionString`); ping unconfigured → 503; object param → 400 (`routes/mssql.js:45`); stubbed success → 200.
- **s3.test.js** — config with `AWS_SECRET_ACCESS_KEY` set → `credentialsSet:true`, no secret in body; list unconfigured → 503; `DELETE /object` `{}` → 400; stubbed `getClient`: list → 200 mapped objects, upload (`.attach('file', ...)` + `.field('key','k.txt')`) → 200 `{key:'k.txt'}`, delete → 200.
- **disk.test.js** — real temp dir (`fs.mkdtempSync`) as `DISK_PATH`, `fs.rmSync(..., {recursive:true, force:true})` in `after()`: unconfigured → 503/`configured:false`; `/health` → 200 (real round trip); write→read→list→delete flow; `read?key=..%2Fescape` → 400; `read?key=.` → 400 (directory); `/stats` → **loose** assertion 200 + `totalBytes > 0` (statfs works on Windows, field fidelity differs).
- **error-handler.test.js** — malformed JSON body → **500** `{ok:false, error:<string>}` (pins current behavior: handler ignores body-parser's `err.status`); multer unexpected-file → 400 via `MulterError` branch (`index.js:65`).

## Step 7 — Integration tier (opt-in)

**docker-compose.test.yml** — postgres:16-alpine (host 54329), mcr.microsoft.com/mssql/server:2022-latest (host 14339, `ACCEPT_EULA`, `MSSQL_SA_PASSWORD=Portal_Test1!`), minio (host 9009). Non-default ports avoid clashes.

**.env.test** — committed throwaway creds matching compose (PG*, MSSQL_*, AWS_*/S3_BUCKET/S3_ENDPOINT=http://localhost:9009, LOG_LEVEL=error).

Integration files require `../../index` directly (no helpers scrub). Skip pattern:

```js
const skip = !(process.env.PGHOST || process.env.DATABASE_URL) &&
  'Postgres env not set — docker compose -f docker-compose.test.yml up -d, then npm run test:integration';
test('postgres round-trip', { skip }, async (t) => { /* ... */ });
```

Per service (one file each, via supertest against the real app):
- **postgres**: ping → 200 with serverTime; `POST /query` `SELECT 1 AS n` → rows. Teardown `db.peekPool()?.end()`.
- **mssql**: ping → 200; `POST /query` `{sql:'SELECT @p1 AS n', params:[1]}` → `rows:[{n:1}]`. Teardown `mssql.peekPool()?.close()`. (Container takes 30–60 s to accept logins after `up`.)
- **s3**: `before()` creates bucket via `s3.getClient()` (swallow `BucketAlreadyOwnedByYou`); upload → list → delete via HTTP routes. Teardown `s3.getClient().destroy()`.

If an integration run ever hangs on lingering sockets, add `--test-force-exit` to `test:integration` only — never to `npm test`.

## Step 8 — README

Add a short "Testing" section: `npm test` (offline), `docker compose -f docker-compose.test.yml up -d` + `npm run test:integration`, mssql startup-latency note.

## Verification

1. `node --check index.js` after the refactor; `npm start` still boots and logs "server started" identically.
2. `npm test` passes green **offline** (no docker, no `.env`), and passes even with a populated developer `.env` present (scrub proof).
3. `npm run test:integration` without compose running → all tests **skip** with the helpful message.
4. `docker compose -f docker-compose.test.yml up -d`, wait for mssql readiness, `npm run test:integration` → all pass; process exits cleanly (pools closed).
5. `docker compose -f docker-compose.test.yml down -v` to clean up.

## Files touched

- Modify: `index.js` (listen guard + export — only production change), `package.json` (supertest devDep, scripts, engines), `README.md` (Testing section)
- New: `test/unit/helpers.js` + 8 unit test files, `test/integration/` × 3, `docker-compose.test.yml`, `.env.test`
