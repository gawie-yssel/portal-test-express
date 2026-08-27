// Shared gating for the opt-in integration tier.
//
// Not named *.test.js, so the runner treats it as a plain module, not a suite.
//
// Integration files require ../../index directly (no env scrubbing) and talk to
// the real services from docker-compose.test.yml, addressed by .env.test.
// Everything is skipped — never failed — when a service isn't there, so
// `npm run test:integration` is safe to run on a machine without docker.

const net = require('node:net');

// Static gate: no env for this backend at all.
function envSkip(names, hint) {
  return names.some((name) => process.env[name]) ? false : hint;
}

// Runtime gate: env is set (from .env.test) but nothing is listening, i.e. the
// compose stack isn't up. Resolves false rather than rejecting.
function reachable(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

// Marks the current test skipped (with `hint`) and returns true when `host:port`
// isn't accepting connections. Call as: `if (await skipUnlessListening(t, ...)) return;`
async function skipUnlessListening(t, host, port, hint) {
  if (await reachable(host, port)) return false;
  t.skip(hint);
  return true;
}

module.exports = { envSkip, reachable, skipUnlessListening };
