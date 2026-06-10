// Dependency-free structured logger. Emits one JSON object per line on stdout
// (stderr for errors), with level gating, secret redaction, child bindings, and
// OpenTelemetry trace correlation when a span is active.

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

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

function emit(level, bindings, msg, fields) {
  if (LEVELS[level] > activeLevel()) return;

  const line = {
    time: new Date().toISOString(),
    level,
    msg,
    ...bindings,
    ...traceContext(),
    ...(fields && typeof fields === 'object' ? redact(fields) : {}),
  };

  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else console.log(text);
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
