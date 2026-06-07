const { S3Client } = require('@aws-sdk/client-s3');

// Long-lived singleton client, reused across requests (recommended for SDK v3).
let client;

function isConfigured() {
  return Boolean(process.env.AWS_REGION && process.env.S3_BUCKET);
}

function getClient() {
  if (client) return client;

  const config = { region: process.env.AWS_REGION };

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
    credentialsSet: Boolean(
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ),
  };
}

module.exports = { isConfigured, getClient, bucket, safeConfig };
