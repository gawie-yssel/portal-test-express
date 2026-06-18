// Structured logger. Emits one JSON object per line on stdout (stderr for
// errors), with level gating, secret redaction, child bindings, and
// OpenTelemetry trace correlation when a span is active. When an OTEL Logs
// provider is registered (see tracing.js) each line is also emitted as an OTLP
// log record; both sinks are best-effort and the logger works without either.

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

// OpenTelemetry severity numbers (logs data model): DEBUG=5, INFO=9, WARN=13,
// ERROR=17. Stable spec values, so map directly rather than pulling the enum.
const SEVERITY = { error: 17, warn: 13, info: 9, debug: 5 };

function activeLevel() {
  const name = String(process.env.LOG_LEVEL || 'info').toLowerCase();
  return name in LEVELS ? LEVELS[name] : LEVELS.info;
}

// Keys whose values must never be logged verbatim, matched case-insensitively.
const SENSITIVE = new Set(
  [
    'password',
    'pgpassword',
    'secretaccesskey',
    'aws_secret_access_key',
    'accesskeyid',
    'aws_access_key_id',
    'authorization',
    'cookie',
    'set-cookie',
    'connectionstring',
    'database_url',
  ].map((k) => k.toLowerCase())
);

// Deep-clone `value`, replacing sensitive keys with '[REDACTED]'. Handles
// cycles, arrays, and Error objects (kept as { name, message, stack }).
function redact(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value;

  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((v) => redact(v, seen));

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SENSITIVE.has(key.toLowerCase()) ? '[REDACTED]' : redact(val, seen);
  }
  return out;
}

// Best-effort trace correlation. Loaded lazily and guarded so the logger works
// even when OpenTelemetry isn't installed or is disabled.
function traceContext() {
  try {
    const { trace } = require('@opentelemetry/api');
    const span = trace.getActiveSpan();
    if (!span) return undefined;
    const ctx = span.spanContext();
    if (!ctx || !ctx.traceId) return undefined;
    return { trace_id: ctx.traceId, span_id: ctx.spanId };
  } catch (_) {
    return undefined;
  }
}

// Best-effort OTEL log bridge. Resolved lazily on first use so the global
// LoggerProvider that tracing.js registers is in place by the time we log, and
// guarded so the logger works when OpenTelemetry isn't installed.
let otelLogger;
let otelResolved = false;
function getOtelLogger() {
  if (otelResolved) return otelLogger;
  otelResolved = true;
  try {
    const { logs } = require('@opentelemetry/api-logs');
    otelLogger = logs.getLogger('portal-test-express');
  } catch (_) {
    otelLogger = undefined;
  }
  return otelLogger;
}

// OTEL log attributes accept scalars (and arrays of scalars); JSON-stringify
// anything richer — nested objects, redacted Errors — so the record stays valid.
function toAttributes(obj) {
  const attrs = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === undefined) continue;
    const t = typeof val;
    attrs[key] =
      t === 'string' || t === 'number' || t === 'boolean' ? val : JSON.stringify(val);
  }
  return attrs;
}

function emit(level, bindings, msg, fields) {
  if (LEVELS[level] > activeLevel()) return;

  const safeFields = fields && typeof fields === 'object' ? redact(fields) : {};

  const line = {
    time: new Date().toISOString(),
    level,
    msg,
    ...bindings,
    ...traceContext(),
    ...safeFields,
  };

  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else console.log(text);

  // Mirror to OTLP. Trace context is attached automatically from the active
  // span, so it isn't duplicated into attributes.
  const otel = getOtelLogger();
  if (otel) {
    otel.emit({
      severityNumber: SEVERITY[level],
      severityText: level.toUpperCase(),
      body: msg,
      attributes: toAttributes({ ...bindings, ...safeFields }),
    });
  }
}

function makeLogger(bindings) {
  const safeBindings = redact(bindings || {});
  return {
    error: (msg, fields) => emit('error', safeBindings, msg, fields),
    warn: (msg, fields) => emit('warn', safeBindings, msg, fields),
    info: (msg, fields) => emit('info', safeBindings, msg, fields),
    debug: (msg, fields) => emit('debug', safeBindings, msg, fields),
    child: (extra) => makeLogger({ ...safeBindings, ...(extra || {}) }),
  };
}

module.exports = makeLogger();
module.exports.redact = redact;
