// App-specific telemetry layered on top of OpenTelemetry auto-instrumentation
// (which already emits HTTP, pg, and AWS-SDK spans/metrics). This module adds
// host/process metrics plus the few measurements auto-instrumentation can't
// express: S3 upload bytes and live pg pool sizes.
//
// All exports are no-ops when OpenTelemetry isn't available (e.g. tracing.js
// failed to start, or OTEL_SDK_DISABLED=true), so callers never need guards.

const logger = require('./logger').child({ module: 'metrics' });

let uploadBytesCounter = { add() {} };

try {
  const { metrics } = require('@opentelemetry/api');
  const meter = metrics.getMeter('portal-test-express');

  // Host/process metrics: CPU, memory, event-loop lag, etc.
  try {
    const { HostMetrics } = require('@opentelemetry/host-metrics');
    new HostMetrics({ name: 'portal-test-express' }).start();
  } catch (err) {
    logger.warn('host metrics unavailable', { err });
  }

  uploadBytesCounter = meter.createCounter('s3_upload_bytes_total', {
    description: 'Total bytes uploaded to S3',
    unit: 'By',
  });

  // Observable gauges read the live pg pool each collection cycle. The pool is
  // created lazily, so peekPool() returns undefined until the first query —
  // report 0 in that case rather than failing.
  const { peekPool } = require('./db');
  const poolValue = (field) => () => {
    const pool = peekPool();
    return pool ? pool[field] || 0 : 0;
  };

  meter
    .createObservableGauge('pg_pool_total', {
      description: 'Total clients in the Postgres pool',
    })
    .addCallback((r) => r.observe(poolValue('totalCount')()));
  meter
    .createObservableGauge('pg_pool_idle', {
      description: 'Idle clients in the Postgres pool',
    })
    .addCallback((r) => r.observe(poolValue('idleCount')()));
  meter
    .createObservableGauge('pg_pool_waiting', {
      description: 'Requests waiting for a Postgres client',
    })
    .addCallback((r) => r.observe(poolValue('waitingCount')()));
} catch (err) {
  logger.warn('metrics disabled; OpenTelemetry API unavailable', { err });
}

function recordUploadBytes(bytes) {
  if (typeof bytes === 'number' && bytes > 0) uploadBytesCounter.add(bytes);
}

module.exports = { recordUploadBytes };
