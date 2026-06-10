# portal-test-express

A small Express app for testing Postgres and S3 connectivity, with structured
logging and OpenTelemetry (OTLP) traces/metrics.

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
- `GET /api/s3/config` · `GET /api/s3/list` · `POST /api/s3/upload` · `DELETE /api/s3/object`

## Environment variables

All variables are optional. The app boots even when Postgres/S3 are
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

### Observability

| Variable | Description | Sample |
| --- | --- | --- |
| `LOG_LEVEL` | Console log verbosity: `error`, `warn`, `info`, or `debug`. | `info` |
| `LOG_SQL` | When `true`, logs truncated SQL text (never param values) and captures SQL params on Postgres spans. Off by default since SQL is user input. | `false` |
| `OTEL_SERVICE_NAME` | Service name reported on traces and metrics. | `portal-test-express` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP collector endpoint. Leave empty if no collector is running. | `http://localhost:4318` |
| `OTEL_SDK_DISABLED` | Set to `true` to disable OpenTelemetry entirely. | `false` |

> Any standard `OTEL_*` variable (e.g. `OTEL_EXPORTER_OTLP_HEADERS`,
> `OTEL_EXPORTER_OTLP_PROTOCOL`) is also honored by the SDK.
