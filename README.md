# portal-test-express

A small Express app for testing Postgres, MSSQL, S3, and disk connectivity, with
structured logging and OpenTelemetry (OTLP) traces/metrics.

## Running

```bash
npm install
cp .env.example .env   # then fill in values
npm start              # serves on http://localhost:3000
```

`npm start` runs `node --require ./tracing.js index.js` so OpenTelemetry
initializes before the app loads.

## Endpoints

- `GET /health` — liveness probe (`{ status, uptime }`)
- `GET /api/postgres/config` · `GET /api/postgres/ping` · `POST /api/postgres/query`
- `GET /api/mssql/config` · `GET /api/mssql/ping` · `POST /api/mssql/query`
- `GET /api/s3/config` · `GET /api/s3/list` · `POST /api/s3/upload` · `DELETE /api/s3/object`
- `GET /api/disk/config` · `GET /api/disk/health` · `GET /api/disk/stats` · `GET /api/disk/list` · `POST /api/disk/write` · `GET /api/disk/read` · `DELETE /api/disk/object`

## Environment variables

All variables are optional. The app boots even when Postgres/MSSQL/S3/disk are
unconfigured — the relevant endpoints just return `503` until set.

### General

| Variable | Description | Sample |
| --- | --- | --- |
| `PORT` | HTTP port the server listens on. | `3000` |

### Postgres

Set **either** `DATABASE_URL` **or** the discrete `PG*` variables. When
`DATABASE_URL` is present it takes precedence.

| Variable | Description | Sample |
| --- | --- | --- |
| `DATABASE_URL` | Full Postgres connection string. | `postgres://user:pass@db.example.com:5432/mydb` |
| `PGHOST` | Database host (used when `DATABASE_URL` is empty). | `db.example.com` |
| `PGPORT` | Database port. | `5432` |
| `PGUSER` | Database user. | `app_user` |
| `PGPASSWORD` | Database password. | `s3cr3t` |
| `PGDATABASE` | Database name. | `mydb` |
| `PGSSL` | Enable SSL (`rejectUnauthorized: false`) for managed/self-signed Postgres. | `true` |

### MSSQL

Set **either** `MSSQL_CONNECTION_STRING` **or** the discrete `MSSQL_*` variables.
When the connection string is present it takes precedence, and its own `Encrypt` /
`TrustServerCertificate` keys govern TLS — `MSSQL_ENCRYPT` and
`MSSQL_TRUST_SERVER_CERTIFICATE` apply to the discrete variables only.

| Variable | Description | Sample |
| --- | --- | --- |
| `MSSQL_CONNECTION_STRING` | Full SQL Server connection string, ADO `Key=Value;` form only. | `Server=db.example.com,1433;Database=mydb;User Id=app_user;Password=s3cr3t;Encrypt=true` |
| `MSSQL_HOST` | Server host (used when `MSSQL_CONNECTION_STRING` is empty). | `db.example.com` |
| `MSSQL_PORT` | Server port. | `1433` |
| `MSSQL_USER` | SQL login. | `app_user` |
| `MSSQL_PASSWORD` | SQL login password. | `s3cr3t` |
| `MSSQL_DATABASE` | Database name. | `mydb` |
| `MSSQL_ENCRYPT` | Encrypt the connection. Defaults to `true`. | `true` |
| `MSSQL_TRUST_SERVER_CERTIFICATE` | Accept the server certificate without validating it. Defaults to `true` so a dev server with a self-signed cert works out of the box — **set to `false` against Azure SQL or any server with a properly trusted certificate**, since `true` accepts any certificate. | `false` |

Notes:

- An `mssql://…` URI is **not** supported — the driver parses only the ADO form.
  An unparseable value shows as a parse error on the page instead of failing silently.
- `POST /api/mssql/query` accepts an optional `params` array of scalars, bound as
  `@p1`, `@p2`, … (the Postgres equivalent is `$1`). With parameters present the
  statement runs via `sp_executesql`, so `#temp` tables and `GO` batches don't
  behave as they would in SSMS. Only the first result set of a batch is returned.
- Windows integrated authentication is not supported. For a named instance, use a
  connection string with `Server=host\instance`.

### S3

`AWS_REGION` and `S3_BUCKET` are required to enable the S3 endpoints. Credentials
are optional — when omitted, the default AWS credential chain (IAM role, etc.) is
used.

| Variable | Description | Sample |
| --- | --- | --- |
| `AWS_REGION` | AWS region of the bucket. | `eu-west-1` |
| `AWS_ACCESS_KEY_ID` | Access key (omit to use the default credential chain). | `AKIAIOSFODNN7EXAMPLE` |
| `AWS_SECRET_ACCESS_KEY` | Secret key (omit to use the default credential chain). | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` |
| `S3_BUCKET` | Target bucket name. | `my-test-bucket` |
| `S3_ENDPOINT` | Custom endpoint for S3-compatible servers (MinIO, LocalStack). When set, path-style addressing is used. Leave empty for real AWS. | `http://localhost:9000` |

### Disk

| Variable | Description | Sample |
| --- | --- | --- |
| `DISK_PATH` | Absolute path to the mounted volume / attached disk to test. | `/mnt/data` |

All keys are resolved against `DISK_PATH` and confined to it, so path traversal
is rejected with a `400`. Uploads are capped at 10 MB and `GET /api/disk/read`
returns at most the first 64 KB of a file (flagged by `truncated` in the response).

### Observability

| Variable | Description | Sample |
| --- | --- | --- |
| `LOG_LEVEL` | Console log verbosity: `error`, `warn`, `info`, or `debug`. | `info` |
| `LOG_SQL` | When `true`, logs truncated SQL text (never param values) and captures SQL params on Postgres spans (tedious/MSSQL spans always record the statement text). Off by default since SQL is user input. | `false` |
| `OTEL_SERVICE_NAME` | Service name reported on traces and metrics. | `portal-test-express` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP collector endpoint. Leave empty if no collector is running. | `http://localhost:4318` |
| `OTEL_SDK_DISABLED` | Set to `true` to disable OpenTelemetry entirely. | `false` |

> Any standard `OTEL_*` variable (e.g. `OTEL_EXPORTER_OTLP_HEADERS`,
> `OTEL_EXPORTER_OTLP_PROTOCOL`) is also honored by the SDK.
