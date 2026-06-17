const fs = require('fs');
const path = require('path');

// The attached disk is just a directory on the server (a mounted volume /
// persistent disk). DISK_PATH is the absolute path we test against.

function isConfigured() {
  return Boolean(process.env.DISK_PATH);
}

function basePath() {
  return process.env.DISK_PATH;
}

// Resolve a user-supplied key/sub-path against the base and confine it to the
// base directory. Rejecting traversal here is the security boundary for the
// page — every file operation routes through this.
function resolveSafe(key) {
  const base = path.resolve(basePath());
  const target = path.resolve(base, key || '.');
  if (target !== base && !target.startsWith(base + path.sep)) {
    const err = new Error('Path escapes the configured disk directory.');
    err.status = 400;
    throw err;
  }
  return target;
}

// Non-sensitive view for display. Reports whether the path exists, is a
// directory, and is writable — all best-effort, never throws (mirrors the
// safeConfig() pattern in lib/s3.js and lib/db.js).
function safeConfig() {
  const config = {
    configured: isConfigured(),
    path: basePath() || null,
    exists: false,
    isDirectory: false,
    writable: false,
  };
  if (!config.configured) return config;
  try {
    const stat = fs.statSync(basePath());
    config.exists = true;
    config.isDirectory = stat.isDirectory();
  } catch {
    return config;
  }
  try {
    fs.accessSync(basePath(), fs.constants.W_OK);
    config.writable = true;
  } catch {
    /* not writable */
  }
  return config;
}

module.exports = { isConfigured, basePath, resolveSafe, safeConfig };
