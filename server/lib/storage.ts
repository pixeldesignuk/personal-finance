import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// S3-compatible object storage (Railway bucket) for original documents —
// receipt photos/PDFs, etc. Configured via the RAILWAY_BUCKET_* env vars
// (read directly so the odd naming/typos don't leak into the typed env schema).
const endpoint = process.env.RAILWAY_BUCKET_ENDPOINT;
const bucket = process.env.RAILWAY_BUCKET_NAME;
const accessKeyId = process.env.RAILWAY_BUCKEY_ACCESS_KEY_ID ?? process.env.RAILWAY_BUCKET_ACCESS_KEY_ID;
const secretAccessKey = process.env.RAILWAY_BUCKEY_ACCESS_SECREY ?? process.env.RAILWAY_BUCKET_ACCESS_SECRET ?? process.env.RAILWAY_BUCKEY_ACCESS_SECRET;

export function storageEnabled(): boolean {
  return Boolean(endpoint && bucket && accessKeyId && secretAccessKey);
}

let cached: S3Client | null = null;
function client(): S3Client {
  if (!cached) {
    cached = new S3Client({
      endpoint,
      region: process.env.RAILWAY_BUCKET_REGION ?? "auto",
      forcePathStyle: true, // S3-compatible (MinIO/R2-style) bucket
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
    });
  }
  return cached;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<string> {
  await client().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  return key;
}

// A short-lived signed URL to view/download a stored object.
export function presignGet(key: string, expiresInSeconds = 3600): Promise<string> {
  return getSignedUrl(client(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: expiresInSeconds });
}
