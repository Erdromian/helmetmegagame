// The archive packets' side of the backup bucket, in JavaScript.
//
// Why not just shell out to scripts/db/bucket.py, which already signs SigV4 by
// hand? Because the callers are not all shells. The GM's Archive button is a
// Next.js server action, and reaching bucket.py from there would assume three
// things about the web deployment that are not true today: that python3 is in
// the image, that scripts/ ships with it, and that the S3_* credentials — which
// belong to the backup service — are set on it.
//
// So this is the PROGRAMMATIC path, shared by the web action and the export
// script the way db/lib always is. bucket.py keeps its own verbs for the human
// one: `bucket.py archives`, `getkey`, `rm` are what you reach for at a
// terminal, and they need nothing installed.
//
// No SDK. SigV4 is about forty lines of hmac and Node has crypto, which is the
// same argument bucket.py's docstring makes.

const crypto = require("crypto");

function env() {
  const endpoint = process.env.S3_ENDPOINT || "";
  const bucket = process.env.S3_BUCKET || "";
  const ak = process.env.AWS_ACCESS_KEY_ID || "";
  const sk = process.env.AWS_SECRET_ACCESS_KEY || "";
  const region = process.env.AWS_DEFAULT_REGION || "auto";
  return { endpoint, bucket, ak, sk, region, ok: Boolean(endpoint && bucket && ak && sk) };
}

// Whether this process can reach the bucket at all. The web app asks before
// offering to archive, so a GM gets "this deployment has no bucket
// credentials" instead of a signature error five minutes in.
function bucketConfigured() {
  return env().ok;
}

const ARCHIVE_PREFIX = () => process.env.S3_ARCHIVE_PREFIX || "archives";

const hmac = (key, msg) => crypto.createHmac("sha256", key).update(msg).digest();
const sha256hex = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// SigV4 wants the query sorted by key and each part percent-encoded, and
// encodeURIComponent leaves !'()* alone where S3 does not.
function encode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
function canonicalQuery(params) {
  return Object.keys(params)
    .sort()
    .map((k) => `${encode(k)}=${encode(params[k])}`)
    .join("&");
}

async function call(method, key = "", params = null, body = null) {
  const { endpoint, bucket, ak, sk, region, ok } = env();
  if (!ok) throw new Error("archiveBucket: S3_ENDPOINT / S3_BUCKET / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY must all be set");
  const host = `${bucket}.${endpoint.replace(/^https?:\/\//, "")}`;
  const now = new Date();
  const amzdate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const datestamp = amzdate.slice(0, 8);

  // The payload is hashed into BOTH the canonical request and the
  // x-amz-content-sha256 header. A body that is sent but not hashed fails as
  // SignatureDoesNotMatch, which looks exactly like a wrong secret.
  const payload = body ?? Buffer.alloc(0);
  const sha = sha256hex(payload);

  // Each path segment is encoded, but the separators are not.
  const uri = "/" + key.split("/").map(encode).join("/");
  const query = params ? canonicalQuery(params) : "";
  const headers = `host:${host}\nx-amz-content-sha256:${sha}\nx-amz-date:${amzdate}\n`;
  const signed = "host;x-amz-content-sha256;x-amz-date";
  const creq = `${method}\n${key ? uri : "/"}\n${query}\n${headers}\n${signed}\n${sha}`;
  const scope = `${datestamp}/${region}/s3/aws4_request`;
  const sts = `AWS4-HMAC-SHA256\n${amzdate}\n${scope}\n${sha256hex(Buffer.from(creq))}`;
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${sk}`, datestamp), region), "s3"), "aws4_request");
  const sig = crypto.createHmac("sha256", kSigning).update(sts).digest("hex");

  const res = await fetch(`https://${host}${key ? uri : "/"}${query ? `?${query}` : ""}`, {
    method,
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signed}, Signature=${sig}`,
      "x-amz-date": amzdate,
      "x-amz-content-sha256": sha,
      ...(body ? { "Content-Type": "application/octet-stream", "Content-Length": String(body.length) } : {}),
    },
    ...(body ? { body } : {}),
  });
  return res;
}

async function putObject(key, body) {
  const res = await call("PUT", key, null, body);
  if (!res.ok) {
    throw new Error(`archiveBucket: PUT ${key} failed (${res.status}) ${(await res.text()).slice(0, 300)}`);
  }
  // A single-part PUT returns the body's MD5 as the ETag, so the object can be
  // checked against what was sent without downloading it again.
  return (res.headers.get("etag") || "").replace(/"/g, "");
}

async function getObject(key) {
  const res = await call("GET", key);
  if (!res.ok) {
    throw new Error(`archiveBucket: GET ${key} failed (${res.status}) ${(await res.text()).slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function deleteObject(key) {
  const res = await call("DELETE", key);
  if (!res.ok && res.status !== 404) {
    throw new Error(`archiveBucket: DELETE ${key} failed (${res.status})`);
  }
}

// Every object under a prefix, as { key, size, modified }. Paged, because a
// bucket that has been running for a year holds more than one page.
async function listObjects(prefix) {
  const out = [];
  let token = null;
  for (;;) {
    const params = { "list-type": "2", prefix };
    if (token) params["continuation-token"] = token;
    const res = await call("GET", "", params);
    if (!res.ok) throw new Error(`archiveBucket: list failed (${res.status})`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const pick = (tag) => (m[1].match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1] ?? "";
      out.push({ key: pick("Key"), size: Number(pick("Size") || 0), modified: pick("LastModified") });
    }
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
    token = (xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/) || [])[1];
    if (!token) break;
  }
  return out;
}

const finalKey = (gameId) => `${ARCHIVE_PREFIX()}/final/${gameId}.jsonl.gz`;
const liveKey = (gameId, stamp) => `${ARCHIVE_PREFIX()}/live/${gameId}/${stamp}.jsonl.gz`;
const livePrefix = (gameId) => `${ARCHIVE_PREFIX()}/live/${gameId}/`;

module.exports = {
  bucketConfigured,
  putObject,
  getObject,
  deleteObject,
  listObjects,
  finalKey,
  liveKey,
  livePrefix,
  ARCHIVE_PREFIX,
};
