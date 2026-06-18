// OpenTelemetry bootstrap. MUST run before any instrumented library (express,
// pg, @aws-sdk/client-s3) is required, so it's loaded via `node --require
// ./tracing.js index.js` (see package.json "start").
//
// All exporter wiring (endpoint, headers, protocol) comes from standard OTEL_*
// env vars. With no OTEL_EXPORTER_OTLP_ENDPOINT set the SDK still starts but the
// exporter has nowhere to send to; set OTEL_SDK_DISABLED=true to skip entirely.

const logger = require('./lib/logger').child({ module: 'otel' });

if (String(process.env.OTEL_SDK_DISABLED).toLowerCase() === 'true') {
  logger.info('OpenTelemetry disabled via OTEL_SDK_DISABLED');
} else {
  try {
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { resourceFromAttributes } = require('@opentelemetry/resources');
    const {
      ATTR_SERVICE_NAME,
      ATTR_SERVICE_VERSION,
    } = require('@opentelemetry/semantic-conventions');
    // Only the instrumentations this app actually exercises (http, express, pg,
    // aws-sdk) — avoids the auto-instrumentations-node meta-package's large
    // bundle and its multi-second cold-start cost.
    const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
    const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
    const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');
    const { AwsInstrumentation } = require('@opentelemetry/instrumentation-aws-sdk');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
    const {
      OTLPMetricExporter,
    } = require('@opentelemetry/exporter-metrics-otlp-proto');
    const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
    const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-proto');
    const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');

    const pkg = require('./package.json');

    // Capture SQL parameter values on pg spans only when SQL logging is opted in,
    // matching the console logger's LOG_SQL behavior. Note: auto-instrumentation
    // may still record the statement *text* as the db.statement span attribute.
    const logSql = String(process.env.LOG_SQL).toLowerCase() === 'true';

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || pkg.name,
        [ATTR_SERVICE_VERSION]: pkg.version,
      }),
      traceExporter: new OTLPTraceExporter(),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
      }),
      // Bridges the console logger (lib/logger.js) to OTLP via the OTEL Logs API.
      // Same OTEL_EXPORTER_OTLP_ENDPOINT/headers as traces and metrics.
      logRecordProcessors: [new BatchLogRecordProcessor(new OTLPLogExporter())],
      instrumentations: [
        new HttpInstrumentation(),
        new ExpressInstrumentation(),
        // enhancedDatabaseReporting captures SQL param values on spans — gate it
        // behind LOG_SQL to match the console logger.
        new PgInstrumentation({ enhancedDatabaseReporting: logSql }),
        new AwsInstrumentation(),
      ],
    });

    sdk.start();
    logger.info('OpenTelemetry started', {
      service: process.env.OTEL_SERVICE_NAME || pkg.name,
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '(default)',
    });

    const shutdown = () =>
      sdk
        .shutdown()
        .then(() => logger.info('OpenTelemetry shut down'))
        .catch((err) => logger.warn('OpenTelemetry shutdown error', { err }))
        .finally(() => process.exit(0));

    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } catch (err) {
    // A misconfigured or missing exporter must never crash app boot.
    logger.warn('OpenTelemetry failed to start; continuing without telemetry', {
      err,
    });
  }
}
