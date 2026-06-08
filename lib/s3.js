const { S3Client } = require('@aws-sdk/client-s3');

// Long-lived singleton client, reused across requests (recommended for SDK v3).
let client;

function isConfigured() {
  return Boolean(process.env.AWS_REGION && process.env.S3_BUCKET);
}

function getClient() {
  if (client) return client;

  const config = { region: process.env.AWS_REGION };

  // Point at an S3-compatible server (MinIO, LocalStack, etc.) when set.
  // Path-style addressing (bucket in the path, not as a subdomain) is
  // required since those endpoints don't resolve per-bucket hostnames.
  if (process.env.S3_ENDPOINT) {
    config.endpoint = process.env.S3_ENDPOINT;
    config.forcePathStyle = true;
  }

  // Fall back to the default credential chain when explicit keys aren't set.
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    config.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }

  client = new S3Client(config);
  return client;
}

function bucket() {
  return process.env.S3_BUCKET;
}

// Non-sensitive view for display. Never exposes the secret access key —
// only whether credentials are set.
function safeConfig() {
  return {
    configured: isConfigured(),
    region: process.env.AWS_REGION || null,
    bucket: process.env.S3_BUCKET || null,
    endpoint: process.env.S3_ENDPOINT || null,
    credentialsSet: Boolean(
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ),
  };
}

module.exports = { isConfigured, getClient, bucket, safeConfig };
