#!/usr/bin/env python3
"""Talk to the backup bucket with nothing installed.

The dumps live in a Railway bucket, which is S3-compatible, and every S3 client
worth using is a dependency this machine does not have — no aws-cli, no boto3,
no pg_dump. Signing a request by hand is about forty lines of hmac, so that is
what this does. It means `npm run db:backups` works on a fresh checkout.

    bucket.py list              what is in the bucket, and how old the newest is
    bucket.py get <name> [dst]  pull one dump down

    bucket.py archives              the archive packets, newest first
    bucket.py put <src> <key>       upload one file to an exact key
    bucket.py getkey <key> [dst]    pull one object down by its exact key
    bucket.py rm <key>              delete one object

The four below the line take a FULL key (`archives/final/<id>.jsonl.gz`), not a
name under the dumps prefix — they exist for the archive packets
(docs/systemdocs/ARCHIVE.md), which live beside the dumps rather than among
them.

Reads S3_ENDPOINT / S3_BUCKET / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY from
the environment; the npm scripts source the root .env first.
"""
import datetime, hashlib, hmac, os, sys
import urllib.error, urllib.parse, urllib.request

ENDPOINT = os.environ.get("S3_ENDPOINT", "")
BUCKET = os.environ.get("S3_BUCKET", "")
AK = os.environ.get("AWS_ACCESS_KEY_ID", "")
SK = os.environ.get("AWS_SECRET_ACCESS_KEY", "")
REGION = os.environ.get("AWS_DEFAULT_REGION", "auto")
PREFIX = os.environ.get("S3_PREFIX", "dumps")

if not all([ENDPOINT, BUCKET, AK, SK]):
    sys.exit("bucket: S3_ENDPOINT / S3_BUCKET / AWS_ACCESS_KEY_ID / "
             "AWS_SECRET_ACCESS_KEY must all be set (see .env.example)")

HOST = f"{BUCKET}.{ENDPOINT.split('://', 1)[1]}"


def _sign(key, msg):
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def canonical_query(params):
    """SigV4 wants the query sorted by key and each part percent-encoded.
    Missing the encoding on the prefix's slash is a SignatureDoesNotMatch that
    looks exactly like a wrong secret, so it is done in one place."""
    return "&".join(f"{urllib.parse.quote(k, safe='')}={urllib.parse.quote(v, safe='')}"
                    for k, v in sorted(params.items()))


def call(method, key="", query="", body=None, timeout=120):
    """One signed request. Returns (status, body).

    `body` is signed as well as sent: SigV4 hashes the payload into both the
    canonical request and the x-amz-content-sha256 header, so a PUT whose body
    is not hashed fails with SignatureDoesNotMatch — which, as the note on
    canonical_query says, looks exactly like a wrong secret."""
    t = datetime.datetime.now(datetime.timezone.utc)
    amzdate, datestamp = t.strftime("%Y%m%dT%H%M%SZ"), t.strftime("%Y%m%d")
    payload = body if body is not None else b""
    sha = hashlib.sha256(payload).hexdigest()
    uri = "/" + key if key else "/"
    headers = f"host:{HOST}\nx-amz-content-sha256:{sha}\nx-amz-date:{amzdate}\n"
    signed = "host;x-amz-content-sha256;x-amz-date"
    creq = f"{method}\n{uri}\n{query}\n{headers}\n{signed}\n{sha}"
    scope = f"{datestamp}/{REGION}/s3/aws4_request"
    sts = (f"AWS4-HMAC-SHA256\n{amzdate}\n{scope}\n"
           f"{hashlib.sha256(creq.encode()).hexdigest()}")
    k = _sign(_sign(_sign(_sign(("AWS4" + SK).encode(), datestamp), REGION), "s3"),
              "aws4_request")
    sig = hmac.new(k, sts.encode(), hashlib.sha256).hexdigest()
    hdrs = {
        "Authorization": (f"AWS4-HMAC-SHA256 Credential={AK}/{scope}, "
                          f"SignedHeaders={signed}, Signature={sig}"),
        "x-amz-date": amzdate,
        "x-amz-content-sha256": sha,
    }
    if body is not None:
        hdrs["Content-Length"] = str(len(body))
        hdrs["Content-Type"] = "application/octet-stream"
    req = urllib.request.Request(
        f"https://{HOST}{uri}" + (f"?{query}" if query else ""),
        method=method, data=body, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def listing(prefix=None, suffix=".dump"):
    """Every object under a prefix, oldest first, as (key, size, modified).

    Parameterised rather than hardcoded on the dumps: the archive packets live
    under `archives/` in the same bucket and were invisible to this while it
    filtered on `.dump`."""
    import xml.etree.ElementTree as ET
    prefix = PREFIX if prefix is None else prefix
    out, token = [], None
    while True:
        params = {"list-type": "2", "prefix": f"{prefix}/"}
        if token:
            params["continuation-token"] = token
        q = canonical_query(params)
        status, body = call("GET", "", q)
        if status != 200:
            sys.exit(f"bucket: list failed ({status})\n{body.decode(errors='replace')[:400]}")
        ns = "{http://s3.amazonaws.com/doc/2006-03-01/}"
        root = ET.fromstring(body)
        for c in root.findall(f"{ns}Contents"):
            key = c.findtext(f"{ns}Key", "")
            if key.endswith(suffix):
                out.append((key, int(c.findtext(f"{ns}Size", "0")),
                            c.findtext(f"{ns}LastModified", "")))
        if root.findtext(f"{ns}IsTruncated") != "true":
            break
        token = root.findtext(f"{ns}NextContinuationToken")
    return sorted(out, key=lambda r: r[0])


def parse_s3_time(value):
    """S3 returns LastModified with or without fractional seconds depending on
    the implementation, and Railway's returns both shapes."""
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            return (datetime.datetime.strptime(value, fmt)
                    .replace(tzinfo=datetime.timezone.utc))
        except ValueError:
            continue
    raise ValueError(f"unrecognised S3 timestamp: {value!r}")


def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024


def cmd_list():
    rows = listing()
    if not rows:
        print("bucket: NO DUMPS AT ALL. Nothing has ever been backed up.")
        sys.exit(1)
    for key, size, when in rows:
        print(f"  {key.split('/')[-1]:44} {human(size):>10}  {when}")
    newest = rows[-1]
    age = datetime.datetime.now(datetime.timezone.utc) - parse_s3_time(newest[2])
    hours = age.total_seconds() / 3600
    print(f"\n{len(rows)} dump(s). Newest is {hours:.1f}h old.")
    # A backup system's real failure is going quiet, so say so plainly.
    if hours > 36:
        print("\nWARNING: the newest dump is over 36h old. The nightly run is "
              "not working — check `railway logs --service backup`.")
        sys.exit(1)


def cmd_get(name, dest=None):
    dest = dest or name
    status, body = call("GET", f"{PREFIX}/{name}")
    if status != 200:
        sys.exit(f"bucket: get failed ({status})\n{body.decode(errors='replace')[:400]}")
    with open(dest, "wb") as f:
        f.write(body)
    print(f"bucket: wrote {dest} ({human(len(body))})")


ARCHIVE_PREFIX = os.environ.get("S3_ARCHIVE_PREFIX", "archives")


def cmd_archives():
    """The archive packets. Unlike cmd_list this never exits non-zero on an
    empty bucket: no packets is the correct state before the first game is
    archived, and staleness is `npm run archive:exports`'s question, not this
    one's."""
    rows = listing(ARCHIVE_PREFIX, ".jsonl.gz")
    if not rows:
        print(f"bucket: no archive packets under {ARCHIVE_PREFIX}/.")
        return
    for key, size, when in sorted(rows, key=lambda r: r[2], reverse=True):
        print(f"  {key:60} {human(size):>10}  {when}")
    print(f"\n{len(rows)} packet(s).")


def cmd_put(src, key):
    with open(src, "rb") as f:
        body = f.read()
    # A multi-MB upload over a slow link outlasts the 120s the reads use.
    status, resp = call("PUT", key, body=body, timeout=900)
    if status not in (200, 201):
        sys.exit(f"bucket: put failed ({status})\n{resp.decode(errors='replace')[:400]}")
    print(f"bucket: put {key} ({human(len(body))})")


def cmd_getkey(key, dest=None):
    dest = dest or key.split("/")[-1]
    status, body = call("GET", key, timeout=900)
    if status != 200:
        sys.exit(f"bucket: get failed ({status})\n{body.decode(errors='replace')[:400]}")
    with open(dest, "wb") as f:
        f.write(body)
    print(f"bucket: wrote {dest} ({human(len(body))})")


def cmd_rm(key):
    status, body = call("DELETE", key)
    if status not in (200, 204):
        sys.exit(f"bucket: delete failed ({status})\n{body.decode(errors='replace')[:400]}")
    print(f"bucket: deleted {key}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] == "list":
        cmd_list()
    elif args[0] == "get" and len(args) >= 2:
        cmd_get(args[1], args[2] if len(args) > 2 else None)
    elif args[0] == "archives":
        cmd_archives()
    elif args[0] == "put" and len(args) >= 3:
        cmd_put(args[1], args[2])
    elif args[0] == "getkey" and len(args) >= 2:
        cmd_getkey(args[1], args[2] if len(args) > 2 else None)
    elif args[0] == "rm" and len(args) >= 2:
        cmd_rm(args[1])
    else:
        sys.exit(__doc__)
